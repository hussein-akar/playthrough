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

it('a problem says how much it costs: an error stops a run, a warning only deserves a look', () => {
  const d = clone();
  d.nodes.push({ id: 'orphan', kind: 'action', label: 'Orphan', x: 0, y: 0, set: { nope: '1' } }, { id: 'lonely', kind: 'end', label: 'Lonely', x: 0, y: 0 });
  d.edges.push({ id: 'x1', from: 'done', to: 'orphan' });
  d.edges.find((e) => e.id === 'e3').when = '';
  d.edges.find((e) => e.id === 'e8').when = 'chanel in [Web]';
  const ps = lint(d);
  assert.ok(ps.every((p) => p.severity === 'error' || p.severity === 'warning'), 'every problem is one or the other');
  const sev = (re) => ps.find((p) => re.test(p.message))?.severity;
  assert.equal(sev(/"Orphan" leads nowhere/), 'error', 'a run that reaches it stops');
  assert.equal(sev(/unguarded edge next to guarded ones/), 'error', 'a fork whose branches cannot be told apart');
  assert.equal(sev(/unknown name 'chanel'/), 'error', 'a name nobody declared stops the run on that edge');
  assert.equal(sev(/is an end, but something leaves it/), 'warning', 'the run has ended by then');
  assert.equal(sev(/sets nope, which is not a declared state field/), 'warning', 'written where nothing looks');
  assert.equal(sev(/nothing leads to "Lonely"/), 'warning', 'unreachable, not unplayable');
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
  assert.match(msgs[0], /lines\.filter\(status/);
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

it('a condition belongs on an edge leaving a fork, whatever kind the node is', () => {
  // e2 is the only way out of "Reserve stock": there is nothing for a guard to choose between, so
  // it can only stop the run. That is the trap, and it is the fan-out that makes it one.
  const guarded = clone();
  guarded.edges.find((e) => e.id === 'e2').when = 'hasCoupon';
  assert.deepEqual(lint(guarded).map((p) => p.edge), ['e2']);
  assert.match(lint(guarded)[0].message, /"Reserve stock" has one way out, so the condition on it cannot branch/);

  // "else" is the same mistake wearing a checkbox.
  const otherwise = clone();
  otherwise.edges.find((e) => e.id === 'e2').else = true;
  assert.match(lint(otherwise)[0].message, /"else" on it has no other branch to fall through from/);

  // The start is no different: one way out, nothing to choose.
  const atStart = clone();
  atStart.edges.find((e) => e.id === 'e1').when = 'hasCoupon';
  assert.match(lint(atStart)[0].message, /"Order placed" has one way out/);

  // A lone guarded branch off a decision is the same trap, which the kind of the node hid before.
  const halfFork = clone();
  halfFork.edges = halfFork.edges.filter((e) => e.id !== 'e4');
  assert.match(lint(halfFork).find((p) => p.edge === 'e3').message, /"Has a coupon\?" has one way out/);

  // And a decision that forks nowhere at all is a node that chooses nothing.
  const idle = clone();
  idle.edges = idle.edges.filter((e) => e.id !== 'e4');
  idle.edges.find((e) => e.id === 'e3').when = '';
  assert.match(lint(idle)[0].message, /is a decision with one unguarded way out/);
});

it('an action that branches on what it just did is a fork like any other', () => {
  // The shape the rule used to rule out: "Apply coupon" sets discount, then the run forks on it.
  // A guard leaving an action reads what that action set, because set runs before the edges test.
  const fork = clone();
  fork.edges.find((e) => e.id === 'e5').when = 'discount > 0';
  fork.edges.push({ id: 'e12', from: 'apply', to: 'full', else: true });
  assert.deepEqual(lint(fork), [], 'a fork off an action is a drawing like any other');

  const r = run(fork, doc.scenarios[0]);
  assert.equal(r.error, null);
  assert.equal(r.steps.find((s) => s.via === 'e5') !== undefined, true, 'took the guarded branch, on state the action had just set');
  assert.deepEqual(r.actions, ['Reserve stock', 'Apply coupon', 'Take payment', 'Send confirmation email']);

  // The edges that leave a decision keep their guards, and the example stays clean.
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

// A state field built from another one: `short` narrows the input, `urgent` narrows `short`. This
// used to be kept as the text of its own definition, because an initial value was read over the
// inputs alone — and the run then failed at whichever action first filtered it, saying that a
// filter needs a list, nowhere near the field that was actually wrong.
const chained = (state) => ({
  name: 'Chained',
  inputs: [{ name: 'items', type: 'list', fields: [{ name: 'status', type: 'enum', values: ['OPEN', 'CLOSED'] }, { name: 'qty', type: 'number' }] }],
  state,
  nodes: [
    { id: 's', kind: 'start', label: 'Start' },
    { id: 'a', kind: 'action', label: 'Trim it', set: { urgent: 'urgent.filter(qty > 2)' } },
    { id: 'e', kind: 'end', label: 'Done' },
  ],
  edges: [{ id: 'e1', from: 's', to: 'a' }, { id: 'e2', from: 'a', to: 'e' }],
  scenarios: [{ id: 'x', name: 'Three', inputs: { items: 'status=OPEN, qty=3\nstatus=OPEN, qty=1\nstatus=CLOSED, qty=9' }, expect: { actions: ['Trim it'], end: 'Done', state: {} } }],
});
const ORDERED = [{ name: 'open', initial: 'items.filter(status != CLOSED)' }, { name: 'urgent', initial: 'open' }];

it('a state field starts as the state fields above it, worked out in order', async () => {
  const { initialState, coerceInputs, runAll, lint } = await import('../lib/run.mjs');
  const doc = chained(ORDERED);
  const inputs = coerceInputs(doc, doc.scenarios[0].inputs);
  const s = initialState(doc, inputs);
  assert.equal(s.open.length, 2, 'narrowed from the input');
  assert.deepEqual(s.urgent, s.open, 'and the one below starts as a copy of it, not as the text "open"');
  const r = runAll(doc).results[0];
  assert.equal(r.result.error, null, 'so an action may filter it again');
  assert.deepEqual(r.result.state.urgent, [{ status: 'OPEN', qty: 3 }]);
  assert.deepEqual(lint(doc), []);
});

it('an initial value that cannot be worked out is a drawing problem, not a run that fails elsewhere', async () => {
  const { lint, runAll } = await import('../lib/run.mjs');
  const below = lint(chained([ORDERED[1], ORDERED[0]]));
  assert.equal(below.length, 1);
  assert.match(below[0].message, /"urgent" starts as `open`/);
  assert.match(below[0].message, /"open" is a state field below it.*move "open" above "urgent"/);

  const itself = lint(chained([{ name: 'urgent', initial: 'urgent.filter(qty > 2)' }]));
  assert.match(itself[0].message, /"urgent" starts as itself, which it cannot/);

  const typo = lint(chained([{ name: 'urgent', initial: 'itmes.filter(qty > 2)' }]));
  assert.match(typo[0].message, /kept as text and never worked out: unknown name 'itmes'/);

  // Text is a perfectly good initial value, and none of this may start calling it a mistake.
  assert.deepEqual(lint(chained([{ name: 'urgent', initial: 'items' }, { name: 'note', initial: 'pending' }, { name: 'n', initial: '0' }, { name: 'blank', initial: null }])), []);
  // The run itself still says what went wrong, for a field that is text on purpose and filtered anyway.
  const text = runAll(chained([{ name: 'urgent', initial: 'pending' }])).results[0];
  assert.match(text.result.error.message, /in "Trim it", set urgent: filter needs a list/);
});

it('a name is declared once, and a second one is said out loud', async () => {
  const { lint } = await import('../lib/run.mjs');
  const flow = (inputs, state) => ({
    name: 'Named twice', inputs, state,
    nodes: [{ id: 's', kind: 'start', label: 'S' }, { id: 'e', kind: 'end', label: 'E' }],
    edges: [{ id: '1', from: 's', to: 'e' }], scenarios: [],
  });
  // An input and a state field of one name is not a repeat: the field shadows the input (see the
  // next test), and the panel says so where the name is typed.
  assert.deepEqual(lint(flow([{ name: 'items', type: 'number' }], [{ name: 'items', initial: null }])), []);

  const twice = lint(flow([{ name: 'a', type: 'number' }, { name: 'a', type: 'text' }], []));
  assert.match(twice[0].message, /declared twice as an input/);
  assert.equal(twice[0].severity, 'warning', 'it runs; it just does not mean what it says');
  assert.match(lint(flow([], [{ name: 'a', initial: null }, { name: 'a', initial: '1' }]))[0].message, /declared twice as a state field/);
  assert.deepEqual(lint(flow([{ name: 'a', type: 'number' }], [{ name: 'b', initial: null }])), []);
  // A half-typed row has no name yet, which is the panel's business and not a drawing problem.
  assert.deepEqual(lint(flow([{ name: '', type: 'number' }, { name: '', type: 'text' }], [])), []);
});

it('a state field that shares an input\'s name starts as the input and shadows it from then on', async () => {
  const { initialState, coerceInputs, runAll, lint, shadows } = await import('../lib/run.mjs');
  const doc = {
    name: 'Shadow',
    inputs: [
      { name: 'status', type: 'enum', values: ['NEW', 'PAID', 'SHIPPED'] },
      { name: 'lines', type: 'list', fields: [{ name: 'gift', type: 'boolean' }, { name: 'qty', type: 'number' }] },
    ],
    state: [{ name: 'status', initial: null }, { name: 'lines', initial: 'lines.filter(gift)' }, { name: 'gifts', initial: 'lines.size' }],
    nodes: [
      { id: 's', kind: 'start', label: 'Start' },
      { id: 'pay', kind: 'action', label: 'Take payment', set: { status: 'PAID' } },
      { id: 'q', kind: 'decision', label: 'Paid?' },
      { id: 'ship', kind: 'action', label: 'Ship it', set: { status: 'SHIPPED', lines: 'lines.filter(qty > 1)' } },
      { id: 'hold', kind: 'action', label: 'Hold it' },
      { id: 'e', kind: 'end', label: 'Done' },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'pay' }, { id: 'e2', from: 'pay', to: 'q' },
      { id: 'e3', from: 'q', to: 'ship', when: 'status == PAID' }, { id: 'e4', from: 'q', to: 'hold', else: true },
      { id: 'e5', from: 'ship', to: 'e' }, { id: 'e6', from: 'hold', to: 'e' },
    ],
    scenarios: [{ id: 'x', name: 'A new order', inputs: { status: 'NEW', lines: 'gift=yes, qty=2\ngift=yes, qty=1\ngift=no, qty=5' }, expect: { actions: ['Take payment', 'Ship it'], end: 'Done', state: { status: 'SHIPPED', lines: '1', gifts: '2' } } }],
  };
  assert.deepEqual(lint(doc), [], 'sharing a name is not a drawing problem');
  assert.ok(shadows(doc, 'status') && shadows(doc, 'lines') && !shadows(doc, 'gifts'));
  const inputs = coerceInputs(doc, doc.scenarios[0].inputs);
  const s = initialState(doc, inputs);
  assert.equal(s.status, 'NEW', 'blank: it starts as the input');
  assert.equal(s.lines.length, 2, 'an initial on it reads the input, since the field is not worked out yet');
  assert.equal(s.gifts, 2, 'and the field below reads the field, not the input of three');
  const r = runAll(doc).results[0];
  assert.equal(r.result.error, null);
  assert.deepEqual(r.result.actions, ['Take payment', 'Ship it'], 'the guard read what the action set, not the input');
  assert.deepEqual([r.result.state.status, r.result.state.lines.length], ['SHIPPED', 1]);
  assert.equal(r.verdict.pass, true, 'and the expected-state cells check the fields');
});
