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

it('records of a list input are read from lines, positions or JSON', async () => {
  const { parseRecords } = await import('../lib/run.mjs');
  const fields = [{ name: 'status', type: 'enum', values: ['OPEN', 'CLOSED'] }, { name: 'linked', type: 'boolean' }, { name: 'amount', type: 'number' }];
  assert.deepEqual(parseRecords('status=OPEN, linked=yes, amount=3\nCLOSED', fields), [{ status: 'OPEN', linked: true, amount: 3 }, { status: 'CLOSED', linked: false, amount: null }]);
  assert.deepEqual(parseRecords('OPEN, no; CLOSED, yes', fields).map((r) => r.linked), [false, true], '; separates records too');
  assert.deepEqual(parseRecords('[{"status":"OPEN","amount":"2"}]', fields), [{ status: 'OPEN', linked: false, amount: 2 }]);
  assert.deepEqual(parseRecords('', fields), []);
  assert.throws(() => parseRecords('OPEN, yes, 1, extra', fields), /no field to put it in/);
  assert.throws(() => parseRecords('[not json', fields), /not valid JSON/);
});

it('a flow filters a list and its scenarios count what is left', () => {
  const flow = {
    inputs: [{ name: 'notices', type: 'list', fields: [{ name: 'status', type: 'enum', values: ['OPEN', 'CLOSED', 'CANCELLED'] }] }],
    state: [{ name: 'kept', initial: null }],
    nodes: [
      { id: 's', kind: 'start', label: 'Start', x: 0, y: 0, set: { kept: 'notices' } },
      { id: 'a', kind: 'action', label: 'Drop cancelled', x: 0, y: 0, set: { kept: 'kept where status != CANCELLED' } },
      { id: 'b', kind: 'action', label: 'Drop closed', x: 0, y: 0, set: { kept: 'kept where status != CLOSED' } },
      { id: 'd', kind: 'decision', label: 'Any left?', x: 0, y: 0 },
      { id: 'y', kind: 'end', label: 'Link', x: 0, y: 0 },
      { id: 'n', kind: 'end', label: 'Flag', x: 0, y: 0 },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'a' }, { id: 'e2', from: 'a', to: 'b' }, { id: 'e3', from: 'b', to: 'd' },
      { id: 'e4', from: 'd', to: 'y', when: 'count(kept) == 1' }, { id: 'e5', from: 'd', to: 'n', else: true },
    ],
    scenarios: [
      { id: '1', name: 'one open', inputs: { notices: 'CANCELLED\nCLOSED\nOPEN' }, expect: { end: 'Link', state: { kept: '1' } } },
      { id: '2', name: 'none open', inputs: { notices: 'CANCELLED; CLOSED' }, expect: { end: 'Flag', state: { kept: 'null' } } },
      { id: '3', name: 'two open', inputs: { notices: 'OPEN; OPEN' }, expect: { end: 'Flag', state: { kept: '*' } } },
      { id: '4', name: 'unreadable', inputs: { notices: 'OPEN, what, is, this' }, expect: {} },
    ],
  };
  assert.deepEqual(lint(flow), [], 'fields are names inside where, also on a list held in state');
  const { results } = runAll(flow);
  assert.deepEqual(results.map((r) => r.result.end), ['Link', 'Flag', 'Flag', null]);
  assert.deepEqual(results.map((r) => r.verdict.pass), [true, true, true, false]);
  assert.equal(results[0].result.state.kept.length, 1);
  assert.match(results[3].result.error.message, /in notices: "what"/);
});

it('an initial value that names an input starts as a copy of it; other text is taken as written', async () => {
  const { initialState } = await import('../lib/run.mjs');
  const flow = { inputs: [{ name: 'notices', type: 'list', fields: [{ name: 'status', type: 'text' }] }, { name: 'amount', type: 'number' }, { name: 'kind', type: 'enum', values: ['Subscription'] }],
    state: [{ name: 'kept', initial: 'notices' }, { name: 'twice', initial: 'amount * 2' }, { name: 'label', initial: 'pending' }, { name: 'phrase', initial: 'in review' }, { name: 'k', initial: 'Subscription' }, { name: 'n', initial: '0' }] };
  const s = initialState(flow, coerceInputs(flow, { notices: 'OPEN; CLOSED', amount: '21' }));
  assert.equal(s.kept.length, 2);
  assert.equal(s.twice, 42);
  assert.equal(s.label, 'pending', 'an unknown bare word is not an expression');
  assert.equal(s.phrase, 'in review');
  assert.equal(s.k, 'Subscription');
  assert.equal(s.n, 0);
  assert.equal(initialState(flow).kept, 'notices', 'without inputs, as written');
});

it('a field used outside where gets told how a list is narrowed', async () => {
  const { check } = await import('../lib/expr.mjs');
  const msgs = check('status != CANCELLED', new Set(['notices', 'CANCELLED']), new Map([['notices', new Set(['status'])]]));
  assert.match(msgs[0], /field of a notices record/);
  assert.match(msgs[0], /notices where status/);
});

it('an expected-state cell may be a check on the value or the count', async () => {
  const { stateMatches } = await import('../lib/run.mjs');
  const scope = { inputs: { pendingOrders: [{ status: 'OPEN' }, { status: 'CLOSED' }] }, state: { notices: [{ status: 'OPEN' }], amount: 250 }, enums: new Set(['OPEN', 'CLOSED']) };
  const list = scope.state.notices;
  assert.equal(stateMatches('1', list, scope), true, 'a number is still the count');
  assert.equal(stateMatches('== 1', list, scope), true);
  assert.equal(stateMatches('> 1', list, scope), false);
  assert.equal(stateMatches('size == 1', list, scope), true);
  assert.equal(stateMatches('count(notices where status == OPEN) == 1', list, scope), true);
  assert.equal(stateMatches('notices where status == CLOSED', list, scope), false, 'no record matches');
  assert.equal(stateMatches('pendingOrders', list, scope), false, 'not the same as the input any more');
  assert.equal(stateMatches('pendingOrders', scope.inputs.pendingOrders, scope), true);
  assert.equal(stateMatches('> 100', 250, scope), true);
  assert.equal(stateMatches('value > 300', 250, scope), false);
  assert.equal(stateMatches('pending', 'pending', scope), true, 'a plain word is a value');
  assert.equal(stateMatches('*', list, scope), true);
});
