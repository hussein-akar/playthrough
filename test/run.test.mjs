import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { run, verdict, runAll, lint, coerceInputs } from '../lib/run.mjs';

const doc = JSON.parse(await readFile(new URL('../examples/order.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(doc);

it('walks the subscription scenario end to end', () => {
  const r = run(doc, doc.scenarios[0]);
  assert.equal(r.error, null);
  assert.deepEqual(r.steps.map((s) => s.node), ['start', 'ship', 'express', 'setdate', 'invoice', 'type', 'publish', 'done']);
  assert.deepEqual(r.actions, ['Create Shipment', 'Set express delivery date', 'Create Invoice', 'Publish Subscription/Preorder received event']);
  assert.equal(r.end, 'Done');
  assert.equal(r.state.deliveryDate, 'today');
  assert.equal(verdict(r, doc.scenarios[0].expect).pass, true);
});

it('the else branch and the null state hold', () => {
  const r = run(doc, doc.scenarios[1]);
  assert.deepEqual(r.steps.map((s) => s.node).slice(2, 4), ['express', 'keepnull']);
  assert.equal(r.state.deliveryDate, null);
  assert.equal(verdict(r, doc.scenarios[1].expect).pass, true);
});

it('a wrong expectation is reported as missing and extra actions', () => {
  const { results } = runAll(doc);
  const s4 = results[3];
  assert.equal(s4.verdict.pass, false);
  assert.deepEqual(s4.verdict.issues.map((i) => i.kind), ['missing-action', 'extra-action']);
  assert.match(s4.verdict.issues[0].message, /Trigger Post Processing/);
});

it('spreadsheet strings are coerced by the schema', () => {
  assert.deepEqual(coerceInputs(doc, { type: 'Refund', isExpress: 'yes' }), { type: 'Refund', isExpress: true });
  assert.deepEqual(coerceInputs(doc, { type: 'Refund' }), { type: 'Refund', isExpress: false });
});

it('coverage names what no scenario touched', () => {
  const d = clone();
  d.scenarios = d.scenarios.slice(0, 1);
  const { coverage } = runAll(d);
  assert.deepEqual(coverage.untouchedNodes, ['keepnull', 'post']);
  assert.deepEqual(coverage.untouchedEdges, ['e4', 'e6', 'e9', 'e11']);
});

it('nothing matched, ambiguous, dead end and loops are findings, not crashes', () => {
  const noElse = clone();
  noElse.edges = noElse.edges.filter((e) => e.id !== 'e9');
  assert.match(run(noElse, doc.scenarios[2]).error.message, /nothing matched leaving "Task type\?"/);

  const ambiguous = clone();
  ambiguous.edges.find((e) => e.id === 'e9').else = false;
  ambiguous.edges.find((e) => e.id === 'e9').when = 'type in [Refund, Subscription]';
  assert.match(run(ambiguous, doc.scenarios[0]).error.message, /ambiguous: 2 branches/);

  const dead = clone();
  dead.edges = dead.edges.filter((e) => e.id !== 'e10');
  const r = run(dead, doc.scenarios[0]);
  assert.match(r.error.message, /leads nowhere/);
  assert.equal(r.steps.at(-1).node, 'publish', 'the path up to the dead end is kept');

  const loop = clone();
  loop.edges.find((e) => e.id === 'e10').to = 'ship';
  assert.match(run(loop, doc.scenarios[0]).error.message, /loop/);
});

it('a broken guard names the edge and the name', () => {
  const d = clone();
  d.edges.find((e) => e.id === 'e8').when = 'typ in [Subscription]';
  assert.match(run(d, doc.scenarios[0]).error.message, /unknown name 'typ'/);
  assert.deepEqual(lint(d).map((p) => p.edge), ['e8']);
});

it('the example flow lints clean, and a bad one does not', () => {
  assert.deepEqual(lint(doc), []);
  const d = clone();
  d.nodes.push({ id: 'orphan', kind: 'action', label: 'Orphan', x: 0, y: 0, set: { nope: '1' } });
  d.edges.push({ id: 'x1', from: 'done', to: 'orphan' });
  d.edges.find((e) => e.id === 'e3').when = '';
  const msgs = lint(d).map((p) => p.message);
  assert.ok(msgs.some((m) => /is an end, but something leaves it/.test(m)));
  assert.ok(msgs.some((m) => /"Orphan" leads nowhere/.test(m)));
  assert.ok(msgs.some((m) => /sets nope, which is not a declared state field/.test(m)));
  assert.ok(msgs.some((m) => /unguarded edge next to guarded ones/.test(m)));
  assert.ok(msgs.some((m) => /decision with no condition/.test(m)));
});
