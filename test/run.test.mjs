import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { run, verdict, runAll, lint, coerceInputs } from '../lib/run.mjs';

const doc = JSON.parse(await readFile(new URL('../examples/simple/checkout.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(doc);

it('walks the web-order scenario end to end', () => {
  const r = run(doc, doc.scenarios[0]);
  assert.equal(r.error, null);
  assert.deepEqual(r.steps.map((s) => s.node), ['start', 'reserve', 'coupon', 'apply', 'pay', 'channel', 'email', 'done']);
  assert.deepEqual(r.actions, ['Reserve stock', 'Apply coupon', 'Take payment', 'Send confirmation email']);
  assert.equal(r.end, 'Done');
  assert.equal(r.state.discount, 10);
  assert.equal(verdict(r, doc.scenarios[0].expect).pass, true);
});

it('the else branch and the null state hold', () => {
  const r = run(doc, doc.scenarios[1]);
  assert.deepEqual(r.steps.map((s) => s.node).slice(2, 4), ['coupon', 'full']);
  assert.equal(r.state.discount, null);
  assert.equal(verdict(r, doc.scenarios[1].expect).pass, true);
});

it('a wrong expectation is reported as missing and extra actions', () => {
  const { results } = runAll(doc);
  const s4 = results[3];
  assert.equal(s4.verdict.pass, false);
  assert.deepEqual(s4.verdict.issues.map((i) => i.kind), ['missing-action', 'extra-action']);
  assert.match(s4.verdict.issues[0].message, /Send confirmation email/);
});

it('spreadsheet strings are coerced by the schema', () => {
  assert.deepEqual(coerceInputs(doc, { channel: 'Kiosk', hasCoupon: 'yes' }), { channel: 'Kiosk', hasCoupon: true });
  assert.deepEqual(coerceInputs(doc, { channel: 'Kiosk' }), { channel: 'Kiosk', hasCoupon: false });
});

it('coverage names what no scenario touched', () => {
  const d = clone();
  d.scenarios = d.scenarios.slice(0, 1);
  const { coverage } = runAll(d);
  assert.deepEqual(coverage.untouchedNodes, ['full', 'receipt']);
  assert.deepEqual(coverage.untouchedEdges, ['e4', 'e6', 'e9', 'e11']);
});

it('nothing matched, ambiguous, dead end and loops are findings, not crashes', () => {
  const noElse = clone();
  noElse.edges = noElse.edges.filter((e) => e.id !== 'e9');
  assert.match(run(noElse, doc.scenarios[3]).error.message, /nothing matched leaving "Channel\?"/);

  const ambiguous = clone();
  ambiguous.edges.find((e) => e.id === 'e9').else = false;
  ambiguous.edges.find((e) => e.id === 'e9').when = 'channel in [Kiosk, Web]';
  assert.match(run(ambiguous, doc.scenarios[0]).error.message, /ambiguous: 2 branches/);

  const dead = clone();
  dead.edges = dead.edges.filter((e) => e.id !== 'e10');
  const r = run(dead, doc.scenarios[0]);
  assert.match(r.error.message, /leads nowhere/);
  assert.equal(r.steps.at(-1).node, 'email', 'the path up to the dead end is kept');

  const loop = clone();
  loop.edges.find((e) => e.id === 'e10').to = 'reserve';
  assert.match(run(loop, doc.scenarios[0]).error.message, /loop/);
});

it('a broken guard names the edge and the name', () => {
  const d = clone();
  d.edges.find((e) => e.id === 'e8').when = 'chanel in [Web]';
  assert.match(run(d, doc.scenarios[0]).error.message, /unknown name 'chanel'/);
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
  const fields = [{ name: 'status', type: 'enum', values: ['PICKED', 'SHORT'] }, { name: 'gift', type: 'boolean' }, { name: 'qty', type: 'number' }];
  assert.deepEqual(parseRecords('status=PICKED, gift=yes, qty=3\nSHORT', fields), [{ status: 'PICKED', gift: true, qty: 3 }, { status: 'SHORT', gift: false, qty: null }]);
  assert.deepEqual(parseRecords('PICKED, no; SHORT, yes', fields).map((r) => r.gift), [false, true], '; separates records too');
  assert.deepEqual(parseRecords('[{"status":"PICKED","qty":"2"}]', fields), [{ status: 'PICKED', gift: false, qty: 2 }]);
  assert.deepEqual(parseRecords('', fields), []);
  assert.throws(() => parseRecords('PICKED, yes, 1, extra', fields), /no field to put it in/);
  assert.throws(() => parseRecords('[not json', fields), /not valid JSON/);
});

it('a flow filters a list and its scenarios count what is left', () => {
  const flow = {
    inputs: [{ name: 'lines', type: 'list', fields: [{ name: 'status', type: 'enum', values: ['PICKED', 'SHORT', 'CANCELLED'] }] }],
    state: [{ name: 'kept', initial: null }],
    nodes: [
      { id: 's', kind: 'start', label: 'Start', x: 0, y: 0, set: { kept: 'lines' } },
      { id: 'a', kind: 'action', label: 'Drop cancelled', x: 0, y: 0, set: { kept: 'kept where status != CANCELLED' } },
      { id: 'b', kind: 'action', label: 'Drop short', x: 0, y: 0, set: { kept: 'kept where status != SHORT' } },
      { id: 'd', kind: 'decision', label: 'Any left?', x: 0, y: 0 },
      { id: 'y', kind: 'end', label: 'Ship', x: 0, y: 0 },
      { id: 'n', kind: 'end', label: 'Hold', x: 0, y: 0 },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'a' }, { id: 'e2', from: 'a', to: 'b' }, { id: 'e3', from: 'b', to: 'd' },
      { id: 'e4', from: 'd', to: 'y', when: 'count(kept) == 1' }, { id: 'e5', from: 'd', to: 'n', else: true },
    ],
    scenarios: [
      { id: '1', name: 'one picked', inputs: { lines: 'CANCELLED\nSHORT\nPICKED' }, expect: { end: 'Ship', state: { kept: '1' } } },
      { id: '2', name: 'none picked', inputs: { lines: 'CANCELLED; SHORT' }, expect: { end: 'Hold', state: { kept: 'null' } } },
      { id: '3', name: 'two picked', inputs: { lines: 'PICKED; PICKED' }, expect: { end: 'Hold', state: { kept: '*' } } },
      { id: '4', name: 'unreadable', inputs: { lines: 'PICKED, what, is, this' }, expect: {} },
    ],
  };
  assert.deepEqual(lint(flow), [], 'fields are names inside where, also on a list held in state');
  const { results } = runAll(flow);
  assert.deepEqual(results.map((r) => r.result.end), ['Ship', 'Hold', 'Hold', null]);
  assert.deepEqual(results.map((r) => r.verdict.pass), [true, true, true, false]);
  assert.equal(results[0].result.state.kept.length, 1);
  assert.match(results[3].result.error.message, /in lines: "what"/);
});

it('an initial value that reads as an expression over the inputs starts as its value; other text is taken as written', async () => {
  const { initialState, initialIsExpression } = await import('../lib/run.mjs');
  const flow = { inputs: [{ name: 'lines', type: 'list', fields: [{ name: 'status', type: 'text' }, { name: 'gift', type: 'boolean' }] }, { name: 'amount', type: 'number' }, { name: 'kind', type: 'enum', values: ['Gift'] }],
    state: [{ name: 'kept', initial: 'lines' }, { name: 'gifts', initial: 'lines where gift' }, { name: 'twice', initial: 'amount * 2' }, { name: 'label', initial: 'pending' }, { name: 'phrase', initial: 'in review' }, { name: 'k', initial: 'Gift' }, { name: 'n', initial: '0' }] };
  const s = initialState(flow, coerceInputs(flow, { lines: 'PICKED, yes; SHORT, no', amount: '21' }));
  assert.equal(s.kept.length, 2);
  assert.equal(s.gifts.length, 1, 'a field of the list is a name inside where, so the copy may already be narrowed');
  assert.equal(s.twice, 42);
  assert.equal(s.label, 'pending', 'an unknown bare word is not an expression');
  assert.equal(s.phrase, 'in review');
  assert.equal(s.k, 'Gift');
  assert.equal(s.n, 0);
  assert.equal(initialState(flow).kept, 'lines', 'without inputs, as written');
  assert.ok(initialIsExpression(flow, 'lines where gift') && !initialIsExpression(flow, 'pending') && !initialIsExpression(flow, 'kept where gift'), 'state is not known yet when the state is initialised');
});

it('a field used outside where gets told how a list is narrowed', async () => {
  const { check } = await import('../lib/expr.mjs');
  const msgs = check('status != CANCELLED', new Set(['lines', 'CANCELLED']), new Map([['lines', new Set(['status'])]]));
  assert.match(msgs[0], /field of a lines record/);
  assert.match(msgs[0], /lines where status/);
});

it('an expected-state cell may be a check on the value or the count', async () => {
  const { stateMatches } = await import('../lib/run.mjs');
  const scope = { inputs: { allLines: [{ status: 'PICKED' }, { status: 'SHORT' }] }, state: { lines: [{ status: 'PICKED' }], amount: 250 }, enums: new Set(['PICKED', 'SHORT']) };
  const list = scope.state.lines;
  assert.equal(stateMatches('1', list, scope), true, 'a number is still the count');
  assert.equal(stateMatches('== 1', list, scope), true);
  assert.equal(stateMatches('> 1', list, scope), false);
  assert.equal(stateMatches('size == 1', list, scope), true);
  assert.equal(stateMatches('count(lines where status == PICKED) == 1', list, scope), true);
  assert.equal(stateMatches('lines where status == SHORT', list, scope), false, 'no record matches');
  assert.equal(stateMatches('allLines', list, scope), false, 'not the same as the input any more');
  assert.equal(stateMatches('allLines', scope.inputs.allLines, scope), true);
  assert.equal(stateMatches('> 100', 250, scope), true);
  assert.equal(stateMatches('value > 300', 250, scope), false);
  assert.equal(stateMatches('pending', 'pending', scope), true, 'a plain word is a value');
  assert.equal(stateMatches('*', list, scope), true);
});

it('a condition belongs on an edge leaving a decision, and nowhere else', () => {
  // e2 leaves "Reserve stock", an action: there is nothing for a guard to choose between.
  const guarded = clone();
  guarded.edges.find((e) => e.id === 'e2').when = 'hasCoupon';
  assert.deepEqual(lint(guarded).map((p) => p.edge), ['e2']);
  assert.match(lint(guarded)[0].message, /"Reserve stock" is an action, not a decision; a condition here cannot branch/);

  // "else" is the same mistake wearing a checkbox.
  const otherwise = clone();
  otherwise.edges.find((e) => e.id === 'e2').else = true;
  assert.match(lint(otherwise)[0].message, /"else" here has no other branch to fall through from/);

  // e1 leaves the start, which is named as itself rather than as an action.
  const atStart = clone();
  atStart.edges.find((e) => e.id === 'e1').when = 'hasCoupon';
  assert.match(lint(atStart)[0].message, /"Order placed" is the start, not a decision/);

  // A fork drawn straight from an action runs, but the shape is the thing being ruled out: a
  // branch is a decision, so both of its ways out are named.
  const fork = clone();
  fork.edges.find((e) => e.id === 'e5').when = 'hasCoupon';
  fork.edges.push({ id: 'e12', from: 'apply', to: 'pay', else: true });
  assert.deepEqual(lint(fork).map((p) => p.edge).sort(), ['e12', 'e5']);
  assert.equal(run(fork, doc.scenarios[0]).error, null, 'and it still runs; the drawing is the complaint');

  // The edges that do leave a decision keep their guards, and the flow stays clean.
  assert.deepEqual(lint(doc), []);
});

it('a stray space around a label does not make an action or an end a different one', async () => {
  const { nodeName } = await import('../lib/run.mjs');
  assert.equal(nodeName({ label: '  Apply coupon ' }), 'Apply coupon');
  assert.equal(nodeName({}), '', 'a node with no label is not named "undefined"');

  // Someone typed a space after the label. It shows nowhere: not on the canvas, not in the panel,
  // not in the expectation the scenario already holds.
  const d = clone();
  d.nodes.find((n) => n.id === 'apply').label = 'Apply coupon ';
  d.nodes.find((n) => n.id === 'done').label = ' Done';
  const r = run(d, d.scenarios[0]);
  assert.deepEqual(r.actions, ['Reserve stock', 'Apply coupon', 'Take payment', 'Send confirmation email']);
  assert.equal(r.end, 'Done');
  assert.deepEqual(verdict(r, d.scenarios[0].expect).issues, [], 'the scenario still passes');

  // The same space typed into the expectation instead.
  const s = structuredClone(doc.scenarios[0]);
  s.expect.actions = ['Reserve stock', 'Apply coupon ', 'Take payment', ' Send confirmation email'];
  s.expect.end = 'Done ';
  assert.equal(verdict(run(doc, s), s.expect).pass, true);

  // The whole set is unmoved: the same scenarios pass as before the spaces were typed, including
  // the one the example fails on purpose.
  assert.equal(runAll(d).passed, runAll(doc).passed);
});
