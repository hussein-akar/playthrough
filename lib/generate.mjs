// Every combination of the inputs, written out as scenarios. The values come from the drawing:
// an enum's values, yes and no for a boolean, and for a number or a text the constants the guards
// hold it against, one on each side of the line (`amount > 100` gives 100 and 101). A list gets
// no records, one record of each kind its fields allow, and one of each together. What the
// drawing does with a combination becomes the row's expectation, so the table documents the
// drawing branch by branch, and a combination no branch handles comes out stuck: that is the
// case nobody wrote a scenario for.
//
//   candidates(doc)                  what each input may be, and whether a guard mentions it
//   plan(doc, { pick, skipCovered }) the combinations of the picked values, before any is played
//   generate(doc, options)           the scenarios, played, named and described
import { compile, names } from './expr.mjs';
import { run, coerceInputs, initialIsExpression, expectationOf } from './run.mjs';

export const MAX_SCENARIOS = 500;   // more than this in one go is not a table anyone reads; untick an input

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const uniq = (xs) => [...new Set(xs)];
const FLIP = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '==': '==', '!=': '!=' };

/** The two values nearest the line a comparison with `c` draws: one that makes it true, one false. */
function around(op, c) {
  if (!isNum(c)) return [];
  switch (op) {
    case '>': case '<=': return [c, c + 1];
    case '>=': case '<': return [c - 1, c];
    default: return [c, c + 1];   // == and !=
  }
}

const root = (a) => (a?.op === 'where' ? root(a.left) : a?.op === 'name' ? a.name.split('.')[0] : null);

/**
 * What the expressions say about each input and each field of a list: the constants it is
 * compared with, the other names it is compared with, whether it is held against null or used as
 * a truth on its own, whether a guard mentions it (so it decides a branch) and whether anything
 * uses it at all. A state field stands for the inputs its initial value is made of: `attempts >= 3`
 * with `attempts` starting as `attempt` is a fact about `attempt`, and `count(short) == 0` with
 * `short` being `lines where picked < qty` mentions `lines` and its `picked` and `qty`.
 */
function facts(doc) {
  const inputs = new Map((doc.inputs ?? []).map((i) => [i.name, i]));
  const blank = () => ({ literals: [], refs: [], nullable: false, truth: false, mentioned: false, used: false, fields: new Map() });
  const about = new Map([...inputs.keys()].map((n) => [n, blank()]));
  const fieldsOf = (list) => new Set((inputs.get(list)?.fields ?? []).map((f) => f.name));
  const fieldFacts = (list, field) => { const f = about.get(list); if (!f.fields.has(field)) f.fields.set(field, blank()); return f.fields.get(field); };

  // A state field as a stand-in: the one input it copies, the list input it narrows, and every fact it touched.
  const state = new Map();

  /** What a name stands for: a field of the list in scope, an input, the input a state copies, or a state. */
  function target(name, ctx) {
    const head = name.split('.')[0];
    if (ctx && fieldsOf(ctx).has(head)) return { list: ctx, field: head };
    if (inputs.has(head)) return { input: head };
    const st = state.get(head);
    if (st?.alias) return { input: st.alias };
    return st ? { state: head } : null;
  }
  const factsOf = (t) => (t?.field ? fieldFacts(t.list, t.field) : t?.input ? about.get(t.input) : null);
  /** The list input whose fields are in scope inside `x where …`; a state list stands for the list it narrows. */
  const listCtx = (left) => { const r = root(left); return inputs.get(r)?.type === 'list' ? r : state.get(r)?.list ?? null; };

  function mention(name, ctx, touch) {
    const t = target(name, ctx);
    if (t?.state) { for (const f of state.get(t.state).touched) touch(f); return null; }
    const f = factsOf(t);
    if (f) { f.used = true; touch(f); }
    return f;
  }
  function note(f, op, value) {
    if (!f) return;
    if (value === null) f.nullable = true;
    else if (isNum(value)) f.literals.push(...around(op, value));
    else if (typeof value === 'string') f.literals.push(value);
  }
  /** `bool` is true where the expression is read as a truth (a guard, the sides of and/or/not, a where's filter). */
  function walk(a, ctx, bool, touch) {
    if (!a || typeof a !== 'object') return;
    switch (a.op) {
      case 'lit': return;
      case 'name': { const f = mention(a.name, ctx, touch); if (f && bool) f.truth = true; return; }
      case '==': case '!=': case '<': case '<=': case '>': case '>=': {
        const { left: l, right: r } = a;
        const fl = l.op === 'name' ? factsOf(target(l.name, ctx)) : null, fr = r.op === 'name' ? factsOf(target(r.name, ctx)) : null;
        if (fl && r.op === 'lit') note(fl, a.op, r.value);
        else if (fr && l.op === 'lit') note(fr, FLIP[a.op], l.value);
        else if (fl && fr) fl.refs.push([a.op, fr]);   // the left side is the one that varies around the right
        for (const side of [l, r]) if (side.op === 'name') mention(side.name, ctx, touch); else walk(side, ctx, false, touch);
        return;
      }
      case 'in': {
        const f = a.left.op === 'name' ? factsOf(target(a.left.name, ctx)) : null;
        for (const it of a.right.items ?? []) if (it.op === 'lit') note(f, '==', it.value);
        walk(a.left, ctx, false, touch); walk(a.right, ctx, false, touch);
        return;
      }
      case 'where': { const lc = listCtx(a.left); walk(a.left, ctx, false, touch); walk(a.right, lc ?? ctx, true, touch); return; }
      case '??': { if (a.left.op === 'name') { const f = factsOf(target(a.left.name, ctx)); if (f) f.nullable = true; } walk(a.left, ctx, false, touch); walk(a.right, ctx, false, touch); return; }
      case 'and': case 'or': walk(a.left, ctx, true, touch); walk(a.right, ctx, true, touch); return;
      case 'not': walk(a.value, ctx, true, touch); return;
      case 'list': for (const it of a.items) walk(it, ctx, false, touch); return;
      default: for (const k of ['left', 'right', 'value']) if (a[k]) walk(a[k], ctx, false, touch);
    }
  }

  for (const s of doc.state ?? []) {
    const st = { alias: null, list: null, touched: [] };
    state.set(s.name, st);
    if (!initialIsExpression(doc, s.initial)) continue;
    const ast = compile(s.initial);
    if (ast.op === 'name' && inputs.has(ast.name)) st.alias = ast.name;
    const r = root(ast);
    if (r && inputs.get(r)?.type === 'list') st.list = r;
    walk(ast, null, false, (f) => st.touched.push(f));
  }
  const safe = (src) => { try { return src && src.trim() ? compile(src) : null; } catch { return null; } };
  for (const e of doc.edges ?? []) { const ast = safe(e.when); if (ast) walk(ast, null, true, (f) => { f.mentioned = true; }); }
  for (const n of doc.nodes ?? []) for (const src of Object.values(n.set ?? {})) { const ast = safe(String(src ?? '')); if (ast) walk(ast, null, false, () => {}); }
  return about;
}

/** The numbers a fact allows: its constants, 0 and 1 when it is read as a truth, the neighbours of whatever it is compared with, and 1 when nothing is said. */
function numbers(f) {
  const own = (g) => { const s = g.literals.filter(isNum); if (g.truth) s.push(0, 1); return uniq(s); };
  const out = own(f);
  for (const [op, other] of f.refs) for (const c of own(other).length ? own(other) : [1]) out.push(...around(op, c));
  return (out.length ? uniq(out) : [1]).sort((a, b) => a - b);
}
/** The texts a fact allows: what it is compared with, then blank as "anything else". */
const texts = (f) => uniq(f.literals.filter((v) => typeof v === 'string')).concat(['']);

const NONE = { literals: [], refs: [], nullable: false, truth: false, used: false };   // the facts about a field nothing mentions
const yes = (v) => (v ? 'yes' : 'no');
const word = (v) => (v == null || v === '' ? 'blank' : typeof v === 'boolean' ? yes(v) : typeof v === 'string' ? `"${v}"` : String(v));

/** One value of a scalar input or field: the cell it is written as, the short label for a name, the words for a sentence. */
function scalar(type, f, values) {
  const v = (value, label = String(value), text = `is ${label}`) => ({ value, label, text });
  if (type === 'enum') return (values?.length ? values : ['']).map((x) => v(x, x || 'blank'));
  if (type === 'boolean') return [v(true, 'yes'), v(false, 'no')];
  const out = type === 'number' ? numbers(f) : texts(f);
  const each = out.map((x) => v(x === '' ? '' : x, word(x), `is ${word(x)}`));
  if (f.nullable && type === 'number') each.push(v('', 'blank', 'is blank'));
  return each;
}

/** The values a list may take: no records, one record of each kind its fields allow, and one of each together. */
function records(i, f) {
  const fields = (i.fields ?? []).filter((x) => x.name);
  // A field nothing reads does not vary: it holds one value, the same one an unvaried input would.
  const per = fields.map((x) => { const ff = f.fields.get(x.name); const vs = scalar(x.type, ff ?? NONE, x.values); return ff?.used ? vs : [x.type === 'boolean' ? vs[1] : vs[0]]; });
  let kinds = [[]];
  for (const vs of per) kinds = kinds.flatMap((k) => vs.map((x) => [...k, x]));
  const varying = fields.map((x, k) => per[k].length > 1);
  const line = (kind) => fields.map((x, k) => `${x.name}=${kind[k].value === '' ? '' : typeof kind[k].value === 'boolean' ? yes(kind[k].value) : /[,;"\n]/.test(String(kind[k].value)) ? JSON.stringify(String(kind[k].value)) : kind[k].value}`).join(', ');
  const describe = (kind) => fields.map((x, k) => (varying[k] ? `${x.name} ${kind[k].label}` : null)).filter(Boolean).join(', ');
  const out = [{ value: '', label: 'none', text: 'has no records' }];
  for (const kind of kinds) { const d = describe(kind); out.push({ value: line(kind), label: d ? `[${d}]` : '[one record]', text: d ? `has one record, ${d}` : 'has one record' }); }
  if (kinds.length > 1) out.push({ value: kinds.map(line).join('\n'), label: 'one of each', text: `has ${kinds.length} records, one of each kind` });
  return out;
}

/**
 * For each input, in declaration order: the values it may take, each as the cell it is written
 * as, a short label and the words for a sentence; `fallback`, the one value it holds when it is
 * not varied; and `mentioned`, true when a guard reads it, so varying it can change the path.
 */
export function candidates(doc) {
  const about = facts(doc);
  return (doc.inputs ?? []).map((i) => {
    const f = about.get(i.name);
    const values = i.type === 'list' ? records(i, f) : scalar(i.type, f, i.values);
    const fallback = i.type === 'boolean' ? values[1] : values[0];
    return { name: i.name, type: i.type, mentioned: f.mentioned, values, fallback };
  });
}

/**
 * The values each input takes, from `pick`: a map of input name to the labels picked for it. An
 * input with nothing picked, or left out of the map, holds its fallback and is not varied. With no
 * `pick` at all, every value of every input a guard reads is picked.
 */
export function picked(cands, pick) {
  const chosen = (c) => {
    if (!pick) return c.mentioned ? c.values : [];
    const want = new Set(pick instanceof Map ? pick.get(c.name) ?? [] : pick[c.name] ?? []);
    return c.values.filter((v) => want.has(v.label));
  };
  return cands.map((c) => { const vs = chosen(c); return { ...c, picked: vs, varied: vs.length > 0, all: vs.length === c.values.length }; });
}

/** How many combinations `pick` makes, without listing them. */
export function count(cands, pick) {
  return picked(cands, pick).reduce((n, c) => n * Math.max(1, c.picked.length), 1);
}

/**
 * The combinations, each with the inputs a scenario would hold and every picked value, before any
 * is played. With `skipCovered` a combination some scenario already holds (the same values for
 * the inputs something was picked for) is left out and counted in `skipped`, so generating twice,
 * or after a value was added to an enum, only adds what is new.
 */
export function plan(doc, { pick, skipCovered = true, cands = candidates(doc) } = {}) {
  const ps = picked(cands, pick);
  const varying = ps.filter((c) => c.varied);
  const keyOf = (inputs) => { try { const c = coerceInputs(doc, inputs); return JSON.stringify(varying.map((v) => c[v.name])); } catch { return null; } };
  const have = new Set(skipCovered ? (doc.scenarios ?? []).map((s) => keyOf(s.inputs ?? {})).filter(Boolean) : []);
  let combos = [[]];
  for (const c of ps) { const vs = c.varied ? c.picked : [c.fallback]; combos = combos.flatMap((k) => vs.map((v) => [...k, v])); }
  const out = [];
  let skipped = 0;
  for (const combo of combos) {
    const inputs = Object.fromEntries(ps.map((c, k) => [c.name, combo[k].value]));
    const key = keyOf(inputs);
    if (have.has(key)) { skipped++; continue; }
    have.add(key);
    out.push({ inputs, varied: varying.map((c) => ({ name: c.name, many: c.picked.length > 1, ...combo[ps.indexOf(c)] })) });
  }
  return { combos: out, skipped, inputs: varying };
}

const listWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The scenarios: one per combination, played through the drawing. `expect` is 'drawing' (what
 * the drawing did becomes the expectation; a stuck run leaves it blank) or 'blank'. Each is named
 * from the inputs that take more than one value, `channel=Web, hasCoupon=yes`, given `tags` (none
 * when the list is empty), and described for the panel: which inputs were combined and over which values,
 * what this one holds, and the branches it took, or where it got stuck.
 */
export function generate(doc, { pick, expect = 'drawing', tags = ['generated'], skipCovered = true, uid = (p) => p + Math.random().toString(36).slice(2, 8) } = {}) {
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n])), edges = new Map((doc.edges ?? []).map((e) => [e.id, e]));
  const p = plan(doc, { pick, skipCovered });
  const many = p.inputs.filter((c) => c.picked.length > 1);
  const over = many.map((c) => (c.all ? c.name : `${c.name} (${c.picked.map((v) => v.label).join(', ')})`));
  const intro = many.length ? `Generated: one scenario for every combination of ${listWords(over)}.` : 'Generated: the one combination the picked values make.';
  const scenarios = p.combos.map(({ inputs, varied }) => {
    const result = run(doc, { inputs });
    const named = varied.some((v) => v.many) ? varied.filter((v) => v.many) : varied;
    const name = named.length ? named.map((v) => `${v.name}=${v.label}`).join(', ') : 'Every input at its usual value';
    const lines = [intro];
    if (varied.length) lines.push(`${varied.map((v) => `${v.name} ${v.text}`).join('; ')}.`);
    const taken = result.steps.map((st) => edges.get(st.via)).filter((e) => e && (e.else || e.when?.trim()))
      .map((e) => `${nodes.get(e.from)?.label || e.from} → ${e.label?.trim() ? e.label.trim() : e.else ? 'else' : e.when.trim()}`);
    if (taken.length) lines.push(`Branches: ${taken.join(' · ')}.`);
    if (result.error) lines.push(`Stuck: ${result.error.message}.`);
    return {
      id: uid('s'), name, description: lines.join('\n'), tags: [...tags], inputs,
      expect: expect === 'drawing' && !result.error ? expectationOf(doc, result) : { actions: [], end: '', state: {} },
    };
  });
  return { scenarios, skipped: p.skipped };
}
