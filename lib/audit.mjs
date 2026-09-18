// The audit: which cases a decision mishandles, found before anyone writes a scenario for them.
// Every combination of the values the guards mention (the same grid Generate… plays) is played
// through the drawing, and wherever a run stops at a decision the case is one of two findings:
//
//   a hole      no branch took it and there is no else: the case nobody drew
//   an overlap  more than one guarded branch took it: two branches claim the same case
//
// The cases are played, not read off the guards, so a case an earlier decision sends elsewhere is
// never held against a decision it cannot reach, and a guard on state some action set is judged on
// the state the run really had. An else swallows holes, never overlaps.
//
// Each finding is one drawing problem on the decision, with one example case. The example names
// only the inputs that matter: each input in it is tried at every other value it may take, and
// dropped from the example when none of them changes the finding.
import { candidates, plan, count } from './generate.mjs';
import { run } from './run.mjs';

export const MAX_CASES = 2000;   // more than this is not played on every edit; the audit is asked for instead

const listWords = (xs, and = 'and') => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`);

/**
 * The findings for `doc`: `problems`, one per finding, each with `node` (the decision), `kind`
 * (`hole` or `overlap`), `edges` (the branches an overlap is between), `cases` (how many of the
 * grid's combinations it stands for) and `example` (the inputs of one of them, and `varied`, the
 * values in it that matter, each as `{ name, label, text }`); `cases`, how many combinations the
 * grid holds; and `skipped`, true when that was more than `cap` and nothing was played, unless
 * `force` says to play them anyway.
 */
export function audit(doc, { cap = MAX_CASES, force = false } = {}) {
  const cands = candidates(doc);
  const cases = count(cands);
  if (cases > cap && !force) return { problems: [], cases, skipped: true };
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]));
  const edges = new Map((doc.edges ?? []).map((e) => [e.id, e]));
  const cache = new Map();
  /** Where a run of `inputs` stops, if it stops at a decision: `hole:<node>` or `overlap:<node>:<edges>`. */
  const stop = (inputs) => {
    const key = JSON.stringify(inputs);
    if (!cache.has(key)) {
      const err = run(doc, { inputs }).error;
      const at = err && nodes.get(err.at);
      cache.set(key, !at || at.kind !== 'decision' ? null : err.kind === 'unmatched' ? `hole:${at.id}` : err.kind === 'ambiguous' ? `overlap:${at.id}:${[...err.edges].sort().join(',')}` : null);
    }
    return cache.get(key);
  };

  const groups = new Map();   // finding key → its combinations, in grid order
  for (const combo of plan(doc, { skipCovered: false, cands }).combos) {
    const k = stop(combo.inputs);
    if (k) (groups.get(k) ?? groups.set(k, []).get(k)).push(combo);
  }

  const problems = [];
  for (const [key, members] of groups) {
    const [kind, nodeId, edgeIds] = key.split(':');
    const node = nodes.get(nodeId);
    // The example: the first combination, with each varied input dropped when no other value of
    // it would change what happens.
    const first = members[0];
    const inputs = { ...first.inputs };
    const varied = first.varied.filter((v) => {
      const c = cands.find((x) => x.name === v.name);
      const matters = c.values.some((other) => other.label !== v.label && stop({ ...inputs, [v.name]: other.value }) !== key);
      return matters;
    });
    const when = varied.length ? ` when ${listWords(varied.map((v) => `${v.name} ${v.text}`))}` : ', whatever the inputs';
    const many = members.length > 1 ? ` (${members.length} cases)` : '';
    const branch = (id) => { const e = edges.get(id); return e?.label?.trim() ? `"${e.label.trim()}"` : e?.when?.trim() ? `"${e.when.trim()}"` : 'an unguarded branch'; };
    const ids = kind === 'overlap' ? edgeIds.split(',') : [];
    const message = kind === 'hole'
      ? `"${node.label}" has no branch${when}${many}`
      : `"${node.label}": ${listWords(ids.map(branch))} ${ids.length > 2 ? 'all' : 'both'} hold${when}${many}`;
    problems.push({ message, node: nodeId, kind, edges: ids, cases: members.length, example: { inputs, varied: varied.map(({ name, label, text }) => ({ name, label, text })) } });
  }
  // In the order the decisions are drawn, holes before overlaps, so the list reads down the flow.
  const order = new Map([...nodes.keys()].map((id, i) => [id, i]));
  problems.sort((a, b) => order.get(a.node) - order.get(b.node) || (a.kind === 'hole' ? -1 : 1) - (b.kind === 'hole' ? -1 : 1));
  return { problems, cases, skipped: false };
}
