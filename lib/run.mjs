// The interpreter. A flow is nodes and edges; a scenario is inputs and an expectation. Playing
// one through the other is a walk: start at the start node, at every node pick the one edge whose
// guard holds, note every action passed, stop at an end. What comes back is the path, the state it
// left behind, and a verdict against what the scenario said should happen.
//
// The document:
//   inputs:    [{ name, type: 'enum'|'boolean'|'number'|'text', values?: [...] }]
//   state:     [{ name, initial }]                  fields an action may set
//   nodes:     [{ id, kind: 'start'|'decision'|'action'|'end', label, x, y, set?: {field: expr} }]
//   edges:     [{ id, from, to, when?: expr, else?: true, label? }]
//   scenarios: [{ id, name, inputs: {...}, expect: { actions?: [label], end?: label, state?: {field: value} } }]

import { test, check, compile, evaluate, same } from './expr.mjs';

export const MAX_STEPS = 500;

export function enumsOf(doc) {
  const s = new Set();
  for (const i of doc.inputs ?? []) if (i.type === 'enum') for (const v of i.values ?? []) s.add(v);
  return s;
}

export function knownNames(doc) {
  const s = enumsOf(doc);
  for (const i of doc.inputs ?? []) s.add(i.name);
  for (const f of doc.state ?? []) s.add(f.name);
  return s;
}

/** Spreadsheet cells are strings; the schema says what they mean. */
export function coerceInputs(doc, raw = {}) {
  const out = {};
  for (const i of doc.inputs ?? []) {
    const v = raw[i.name];
    if (v === undefined || v === '') { out[i.name] = i.type === 'boolean' ? false : null; continue; }
    if (i.type === 'boolean') out[i.name] = typeof v === 'boolean' ? v : ['true', 'yes', 'y', '1'].includes(String(v).trim().toLowerCase());
    else if (i.type === 'number') out[i.name] = Number(v);
    else out[i.name] = v;
  }
  return out;
}

export function initialState(doc) {
  const s = {};
  for (const f of doc.state ?? []) s[f.name] = f.initial ?? null;
  return s;
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
  const scope = { inputs: coerceInputs(doc, scenario.inputs), state: initialState(doc), enums: enumsOf(doc) };
  const result = { steps: [], actions: [], end: null, state: scope.state, error: null };
  const fail = (message, at) => { result.error = { message, at }; return result; };

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

/** Expected-state cells: `*` means "anything but null", `null` or empty means null, else compared loosely. */
export function stateMatches(expected, actual) {
  const e = expected == null ? '' : String(expected).trim();
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
    if (!stateMatches(want, got)) issues.push({ kind: 'state', field, message: `${field} is ${fmt(got)}, expected ${fmt(want)}` });
  }
  return { pass: issues.length === 0, issues };
}

function fmt(v) { return v == null ? 'null' : typeof v === 'string' ? `"${v}"` : String(v); }

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
  const known = knownNames(doc);
  const starts = (doc.nodes ?? []).filter((n) => n.kind === 'start');
  if (starts.length === 0) problems.push({ message: 'there is no start node' });
  if (starts.length > 1) problems.push({ message: `there are ${starts.length} start nodes; a flow has one`, node: starts[1].id });

  const out = new Map(), into = new Set();
  for (const e of doc.edges ?? []) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) { problems.push({ message: 'an edge points at a node that does not exist', edge: e.id }); continue; }
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)).push(e);
    into.add(e.to);
    if (nodes.get(e.from).kind === 'end') problems.push({ message: `"${nodes.get(e.from).label}" is an end, but something leaves it`, edge: e.id });
    for (const msg of check(e.when, known)) problems.push({ message: `on "${e.when}": ${msg}`, edge: e.id });
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
      for (const msg of check(String(src ?? ''), known)) problems.push({ message: `"${n.label}" sets ${field}: ${msg}`, node: n.id });
    }
  }
  return problems;
}
