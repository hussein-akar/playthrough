// The interpreter. A flow is nodes and edges; a scenario is inputs and an expectation. Playing
// one through the other is a walk: start at the start node, at every node pick the one edge whose
// guard holds, note every action passed, stop at an end. What comes back is the path, the state it
// left behind, and a verdict against what the scenario said should happen.
//
// The document:
//   inputs:    [{ name, type: 'enum'|'boolean'|'number'|'text'|'list', values?: [...], fields?: [{ name, type, values? }] }]
//              a list input is records; a scenario writes them one per line, `status=OPEN, linked=yes`
//   state:     [{ name, initial }]                  fields an action may set; `initial` is a value, or an
//              expression over the inputs (an input's name copies it), when it reads as one
//   nodes:     [{ id, kind: 'start'|'decision'|'action'|'end', label, x, y, set?: {field: expr} }]
//   edges:     [{ id, from, to, when?: expr, else?: true, label? }]
//   scenarios: [{ id, name, inputs: {...}, expect: { actions?: [label], end?: label, state?: {field: value} } }]

import { test, check, compile, evaluate, same, truthy } from './expr.mjs';

export const MAX_STEPS = 500;

export function enumsOf(doc) {
  const s = new Set();
  for (const i of doc.inputs ?? []) {
    if (i.type === 'enum') for (const v of i.values ?? []) s.add(v);
    if (i.type === 'list') for (const f of i.fields ?? []) if (f.type === 'enum') for (const v of f.values ?? []) s.add(v);
  }
  return s;
}

/** Each list input's field names, for the checker: inside `list where …` they are names too. */
export function listsOf(doc) {
  return new Map((doc.inputs ?? []).filter((i) => i.type === 'list').map((i) => [i.name, new Set((i.fields ?? []).map((f) => f.name).filter(Boolean))]));
}

/** One cell's text as its typed value: yes/no words for booleans, numbers as numbers, blank as null. */
function coerceValue(type, v) {
  if (v === undefined || v === null || v === '') return type === 'boolean' ? false : null;
  if (type === 'boolean') return typeof v === 'boolean' ? v : ['true', 'yes', 'y', '1'].includes(String(v).trim().toLowerCase());
  if (type === 'number') return Number(v);
  return v;
}

/**
 * The records of a list input, from the text a scenario holds: one record per line (or `;`),
 * each `field=value, field=value`, or just the values in the order the fields are declared, so
 * `OPEN` alone is a record whose first field is OPEN. JSON is accepted too. Throws on a line it
 * cannot read, naming it.
 */
export function parseRecords(text, fields = []) {
  const coerce = (rec) => { const out = {}; for (const f of fields) out[f.name] = coerceValue(f.type, rec[f.name]); for (const k of Object.keys(rec)) if (!(k in out)) out[k] = rec[k]; return out; };
  if (Array.isArray(text)) return text.map((r) => coerce(r && typeof r === 'object' ? r : {}));
  const src = String(text ?? '').trim();
  if (!src) return [];
  if (src.startsWith('[')) {
    let arr;
    try { arr = JSON.parse(src); } catch (e) { throw new Error(`not valid JSON: ${e.message}`); }
    if (!Array.isArray(arr)) throw new Error('JSON must be a list');
    return parseRecords(arr, fields);
  }
  const unquote = (v) => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v);
  return src.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const rec = {};
    line.split(',').map((p) => p.trim()).filter(Boolean).forEach((part, i) => {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*)$/.exec(part);
      if (m) rec[m[1]] = unquote(m[2].trim());
      else if (fields[i]) rec[fields[i].name] = unquote(part);
      else throw new Error(`"${part}": no field to put it in; write field=value`);
    });
    return coerce(rec);
  });
}

export function knownNames(doc) {
  const s = enumsOf(doc);
  for (const i of doc.inputs ?? []) s.add(i.name);
  for (const f of doc.state ?? []) s.add(f.name);
  return s;
}

/** Spreadsheet cells are strings; the schema says what they mean. Throws when a list cell cannot be read. */
export function coerceInputs(doc, raw = {}) {
  const out = {};
  for (const i of doc.inputs ?? []) {
    const v = raw[i.name];
    if (i.type === 'list') {
      try { out[i.name] = parseRecords(v, i.fields ?? []); }
      catch (e) { throw new Error(`in ${i.name}: ${e.message}`); }
    } else out[i.name] = coerceValue(i.type, v);
  }
  return out;
}

/**
 * The state before any action runs. An initial value that reads as an expression over the
 * inputs (an input's name, `amount * 2`, an enum value) starts as that value, so a list can be
 * copied from an input and narrowed from there; anything else is taken as it is written.
 */
export function initialState(doc, inputs = null) {
  const s = {};
  for (const f of doc.state ?? []) {
    let v = f.initial ?? null;
    if (inputs && initialIsExpression(doc, v)) {
      try { v = evaluate(compile(v), { inputs, state: {}, enums: enumsOf(doc) }); }
      catch { /* it read as one but did not run: the text itself is the value */ }
    }
    s[f.name] = v;
  }
  return s;
}

/**
 * Whether an initial value would be read as an expression rather than taken as it is written: it
 * parses, and every name in it is an input, an enum value, or a field of a list inside `where`
 * (`items where inStock` starts as the in-stock lines). State fields are not known here: the state
 * does not exist yet.
 */
export function initialIsExpression(doc, src) {
  if (typeof src !== 'string' || !src.trim()) return false;
  const known = enumsOf(doc);
  for (const i of doc.inputs ?? []) known.add(i.name);
  return check(src, known, listsOf(doc)).length === 0;
}

const byId = (list) => new Map((list ?? []).map((x) => [x.id, x]));

/**
 * Walk one scenario. Never throws: an impossible situation ends the walk with `error` set and the
 * path up to that point intact, because "it got stuck here" is a finding, not a crash.
 */
export function run(doc, scenario) {
  const nodes = byId(doc.nodes);
  const outgoing = new Map();
  for (const e of doc.edges ?? []) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from).push(e);
  }
  const result = { steps: [], actions: [], end: null, state: {}, error: null };
  const fail = (message, at) => { result.error = { message, at }; return result; };
  let inputs;
  try { inputs = coerceInputs(doc, scenario.inputs); } catch (e) { return fail(e.message, null); }
  result.state = initialState(doc, inputs);
  const scope = { inputs, state: result.state, enums: enumsOf(doc) };
  result.inputs = inputs; result.enums = scope.enums;

  const starts = (doc.nodes ?? []).filter((n) => n.kind === 'start');
  if (starts.length !== 1) return fail(starts.length ? 'more than one start node' : 'no start node', null);

  let node = starts[0], via = null;
  for (let i = 0; i < MAX_STEPS; i++) {
    result.steps.push({ node: node.id, via: via?.id ?? null });
    if (node.kind === 'action') result.actions.push(node.label);
    if (node.set) {
      for (const [field, src] of Object.entries(node.set)) {
        if (src == null || String(src).trim() === '') continue;
        try { scope.state[field] = evaluate(compile(String(src)), scope); }
        catch (e) { return fail(`in "${node.label}", set ${field}: ${e.message}`, node.id); }
      }
    }
    if (node.kind === 'end') { result.end = node.label; return result; }

    const edges = outgoing.get(node.id) ?? [];
    if (!edges.length) return fail(`"${node.label}" leads nowhere`, node.id);
    const matched = [], elses = [];
    for (const e of edges) {
      if (e.else) { elses.push(e); continue; }
      try { if (test(e.when, scope)) matched.push(e); }
      catch (err) { return fail(`on the edge "${e.when}": ${err.message}`, node.id); }
    }
    let chosen;
    if (matched.length === 1) chosen = matched[0];
    else if (matched.length === 0 && elses.length === 1) chosen = elses[0];
    else if (matched.length === 0) return fail(`nothing matched leaving "${node.label}"`, node.id);
    else return fail(`ambiguous: ${matched.length} branches match leaving "${node.label}"`, node.id);

    via = chosen;
    node = nodes.get(chosen.to);
    if (!node) return fail(`edge ${chosen.id} points at a node that does not exist`, chosen.from);
  }
  return fail(`still going after ${MAX_STEPS} steps; this is a loop`, node.id);
}

/**
 * An expected-state cell read as a check rather than a value: one that starts with a comparison
 * (`== 1`, `> 0`, applied to the value, or to the count of a list), or an expression with an
 * operator in it (`size == 1`, `count(notices where linked) == 1`, `notices where status == OPEN`),
 * or the name of an input or state field (compared to its value). `it`, `value`, `size` and
 * `count` name the field's value and count inside. Anything else is a plain value: null.
 */
export function expectation(cell, known = new Set()) {
  const e = String(cell ?? '').trim();
  if (/^(==|!=|<=|>=|<|>|=)\s*\S/.test(e)) return { src: `it ${e}`, kind: 'test' };
  let ast;
  try { ast = compile(e); } catch { return null; }
  if (ast.op === 'lit') return null;
  if (ast.op === 'name') return ['it', 'value', 'size', 'count'].includes(ast.name) || known.has(ast.name.split('.')[0]) ? { src: e, kind: 'value' } : null;
  return { src: e, kind: ['==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'not', 'in', 'where'].includes(ast.op) ? 'test' : 'value' };
}

const deepSame = (a, b) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : same(a, b));

/**
 * Expected-state cells: `*` means "anything but null", `null` or empty means null, else compared
 * loosely. For a list, `*` means "some records", null means none, and a number is how many.
 * With a scope (`{ inputs, state, enums }`), a cell that reads as a check is evaluated instead.
 */
export function stateMatches(expected, actual, scope = null) {
  const e = expected == null ? '' : String(expected).trim();
  const ex = scope && e !== '*' && expectation(e, new Set([...Object.keys(scope.inputs ?? {}), ...Object.keys(scope.state ?? {})]));
  if (ex) {
    const n = Array.isArray(actual) ? actual.length : actual;
    try {
      const v = evaluate(compile(ex.src), { ...scope, record: { it: n, value: actual, size: n, count: n } });
      return ex.kind === 'test' ? truthy(v) : deepSame(v, actual);
    } catch { return false; }
  }
  if (Array.isArray(actual)) {
    if (e === '*') return actual.length > 0;
    if (e === '' || e.toLowerCase() === 'null') return actual.length === 0;
    return /^\d+$/.test(e) && actual.length === Number(e);
  }
  if (e === '*') return actual != null && actual !== '';
  if (e === '' || e.toLowerCase() === 'null') return actual == null || actual === '';
  return same(expected, actual);
}

/** Judge a result against a scenario's expectation. */
export function verdict(result, expect = {}) {
  const issues = [];
  if (result.error) issues.push({ kind: 'error', message: result.error.message, at: result.error.at });
  if (Array.isArray(expect.actions)) {
    const want = new Set(expect.actions.map((s) => String(s).trim()).filter(Boolean));
    const got = new Set(result.actions);
    for (const a of want) if (!got.has(a)) issues.push({ kind: 'missing-action', action: a, message: `expected "${a}" to happen; it did not` });
    for (const a of got) if (!want.has(a)) issues.push({ kind: 'extra-action', action: a, message: `"${a}" happened; it was not expected` });
  }
  if (expect.end != null && String(expect.end).trim() !== '' && !result.error) {
    if (result.end !== expect.end) issues.push({ kind: 'wrong-end', message: `landed on "${result.end}", expected "${expect.end}"` });
  }
  for (const [field, want] of Object.entries(expect.state ?? {})) {
    if (want == null || String(want).trim() === '') continue;
    const got = result.state[field];
    if (!stateMatches(want, got, { inputs: result.inputs ?? {}, state: result.state, enums: result.enums ?? new Set() })) issues.push({ kind: 'state', field, message: `${field} is ${fmt(got)}, expected ${fmt(want)}` });
  }
  return { pass: issues.length === 0, issues };
}

function fmt(v) { return v == null ? 'null' : Array.isArray(v) ? `${v.length} record${v.length === 1 ? '' : 's'}` : typeof v === 'string' ? `"${v}"` : String(v); }

/**
 * What a run did, as the expectation a scenario would write: its actions once each, its end, and
 * each state field's value as a cell; a list becomes how many records it holds.
 */
export function expectationOf(doc, result) {
  const cell = (v) => (v == null || v === '' ? 'null' : Array.isArray(v) ? String(v.length) : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return { actions: [...new Set(result.actions)], end: result.end ?? '', state: Object.fromEntries((doc.state ?? []).map((f) => [f.name, cell(result.state[f.name])])) };
}

/** Every scenario, plus what the whole set never touched. */
export function runAll(doc) {
  const nodeHits = new Map((doc.nodes ?? []).map((n) => [n.id, 0]));
  const edgeHits = new Map((doc.edges ?? []).map((e) => [e.id, 0]));
  const results = (doc.scenarios ?? []).map((s) => {
    const result = run(doc, s);
    for (const st of result.steps) {
      nodeHits.set(st.node, (nodeHits.get(st.node) ?? 0) + 1);
      if (st.via) edgeHits.set(st.via, (edgeHits.get(st.via) ?? 0) + 1);
    }
    return { scenario: s, result, verdict: verdict(result, s.expect) };
  });
  return {
    results,
    passed: results.filter((r) => r.verdict.pass).length,
    coverage: {
      nodes: nodeHits, edges: edgeHits,
      untouchedNodes: [...nodeHits].filter(([, n]) => n === 0).map(([id]) => id),
      untouchedEdges: [...edgeHits].filter(([, n]) => n === 0).map(([id]) => id),
    },
  };
}

/**
 * What is wrong with the drawing itself, before any scenario runs. Each problem names the node or
 * edge so the editor can point at it.
 */
export function lint(doc) {
  const problems = [];
  const nodes = byId(doc.nodes);
  const known = knownNames(doc), lists = listsOf(doc);
  const starts = (doc.nodes ?? []).filter((n) => n.kind === 'start');
  if (starts.length === 0) problems.push({ message: 'there is no start node' });
  if (starts.length > 1) problems.push({ message: `there are ${starts.length} start nodes; a flow has one`, node: starts[1].id });

  const out = new Map(), into = new Set();
  for (const e of doc.edges ?? []) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) { problems.push({ message: 'an edge points at a node that does not exist', edge: e.id }); continue; }
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)).push(e);
    into.add(e.to);
    if (nodes.get(e.from).kind === 'end') problems.push({ message: `"${nodes.get(e.from).label}" is an end, but something leaves it`, edge: e.id });
    for (const msg of check(e.when, known, lists)) problems.push({ message: `on "${e.when}": ${msg}`, edge: e.id });
    if (e.else && e.when && e.when.trim()) problems.push({ message: 'an edge is both "else" and guarded; pick one', edge: e.id });
  }
  for (const n of doc.nodes ?? []) {
    const edges = out.get(n.id) ?? [];
    if (n.kind !== 'end' && edges.length === 0) problems.push({ message: `"${n.label}" leads nowhere`, node: n.id });
    if (n.kind !== 'start' && !into.has(n.id)) problems.push({ message: `nothing leads to "${n.label}"`, node: n.id });
    const open = edges.filter((e) => !e.else && !(e.when && e.when.trim()));
    const guarded = edges.filter((e) => e.when && e.when.trim());
    const elses = edges.filter((e) => e.else);
    if (open.length > 1) problems.push({ message: `"${n.label}" has ${open.length} unguarded ways out; every run will be ambiguous`, node: n.id });
    if (open.length >= 1 && (guarded.length || elses.length)) problems.push({ message: `"${n.label}" has an unguarded edge next to guarded ones; the unguarded one always matches`, node: n.id });
    if (elses.length > 1) problems.push({ message: `"${n.label}" has ${elses.length} "else" edges`, node: n.id });
    if (n.kind === 'decision' && guarded.length === 0) problems.push({ message: `"${n.label}" is a decision with no condition on any branch`, node: n.id });
    for (const [field, src] of Object.entries(n.set ?? {})) {
      if (!(doc.state ?? []).some((f) => f.name === field)) problems.push({ message: `"${n.label}" sets ${field}, which is not a declared state field`, node: n.id });
      for (const msg of check(String(src ?? ''), known, lists)) problems.push({ message: `"${n.label}" sets ${field}: ${msg}`, node: n.id });
    }
  }
  return problems;
}
