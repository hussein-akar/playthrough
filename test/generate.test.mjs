import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { candidates, plan, ways, generate, count, picked, wayOf, MAX_COMBINATIONS } from '../lib/generate.mjs';
import { runAll, run, expectationOf } from '../lib/run.mjs';

const checkout = JSON.parse(await readFile(new URL('../examples/simple/checkout.json', import.meta.url), 'utf8'));

/** Start → Q? → A or B → End, with the given inputs, state and the edges leaving Q?. */
const flow = (inputs, edges, state = []) => ({
  inputs, state,
  nodes: [{ id: 's', kind: 'start', label: 'Start' }, { id: 'q', kind: 'decision', label: 'Q?' }, { id: 'a', kind: 'action', label: 'A' }, { id: 'b', kind: 'action', label: 'B' }, { id: 'e', kind: 'end', label: 'End' }],
  edges: [{ id: 'e0', from: 's', to: 'q' }, ...edges.map((e, k) => ({ id: `q${k}`, from: 'q', to: k ? 'b' : 'a', ...e })), { id: 'ea', from: 'a', to: 'e' }, { id: 'eb', from: 'b', to: 'e' }],
  scenarios: [],
});
const labels = (doc, name) => candidates(doc).find((c) => c.name === name).values.map((v) => v.label);

it('an enum takes each value, a boolean yes and no, and only the inputs a guard reads are varied', () => {
  const doc = { ...checkout, inputs: [...checkout.inputs, { name: 'note', type: 'text' }] };
  const cands = candidates(doc);
  assert.deepEqual(cands.map((c) => [c.name, c.mentioned]), [['channel', true], ['hasCoupon', true], ['note', false]]);
  assert.deepEqual(labels(doc, 'channel'), ['Web', 'App', 'Marketplace', 'Phone', 'Kiosk']);
  assert.deepEqual(labels(doc, 'hasCoupon'), ['yes', 'no']);
  assert.equal(cands[1].fallback.value, false);   // an unvaried boolean is no
  assert.equal(count(cands), 10);   // by default every value of every input a guard reads
  assert.equal(count(cands, { channel: ['Web', 'App', 'Marketplace', 'Phone', 'Kiosk'] }), 5);
  assert.deepEqual(picked(cands).map((c) => [c.name, c.picked.length, c.varied]), [['channel', 5, true], ['hasCoupon', 2, true], ['note', 0, false]]);
});

it('a number is tried on each side of every line the guards draw', () => {
  const n = (when) => labels(flow([{ name: 'amount', type: 'number' }], [{ when }, { else: true }]), 'amount');
  assert.deepEqual(n('amount > 100'), ['100', '101']);
  assert.deepEqual(n('amount >= 80'), ['79', '80']);
  assert.deepEqual(n('amount < 10'), ['9', '10']);
  assert.deepEqual(n('100 < amount'), ['100', '101']);   // the constant on the left reads the same
  assert.deepEqual(n('amount in [1, 5]'), ['1', '2', '5', '6']);
  assert.deepEqual(n('amount == null'), ['1', 'blank']);
  assert.deepEqual(n('amount > 100 and amount <= 500'), ['100', '101', '500', '501']);
  assert.deepEqual(n('amount'), ['0', '1']);   // read as a truth
});

it('a text is tried as each constant it is compared with, then blank', () => {
  const doc = flow([{ name: 'code', type: 'text' }], [{ when: 'code == "VIP" or code == "STAFF"' }, { else: true }]);
  assert.deepEqual(labels(doc, 'code'), ['"VIP"', '"STAFF"', 'blank']);
  assert.deepEqual(candidates(doc)[0].values.map((v) => v.value), ['VIP', 'STAFF', '']);
});

it('a number compared with another input varies around that input', () => {
  const doc = flow([{ name: 'balance', type: 'number' }, { name: 'amount', type: 'number' }], [{ when: 'balance >= amount' }, { when: 'amount > 50' }]);
  assert.deepEqual(labels(doc, 'amount'), ['50', '51']);
  assert.deepEqual(labels(doc, 'balance'), ['49', '50', '51']);
});

it('a state field that starts as an input stands for it in the guards', () => {
  const doc = flow([{ name: 'attempt', type: 'number' }], [{ when: 'attempts >= 3' }, { else: true }], [{ name: 'attempts', initial: 'attempt' }]);
  const [c] = candidates(doc);
  assert.equal(c.mentioned, true);
  assert.deepEqual(c.values.map((v) => v.label), ['2', '3']);
});

it('a list gets no records, one record of each kind its read fields allow, and one of each', () => {
  const lines = { name: 'lines', type: 'list', fields: [{ name: 'sku', type: 'text' }, { name: 'qty', type: 'number' }, { name: 'picked', type: 'number' }, { name: 'fragile', type: 'boolean' }] };
  const doc = flow([lines], [{ when: 'count(short) == 0' }, { else: true }], [{ name: 'short', initial: 'lines where picked < qty' }]);
  const [c] = candidates(doc);
  assert.equal(c.mentioned, true);   // through `short`
  assert.deepEqual(c.values.map((v) => v.label), ['none', '[picked 0]', '[picked 1]', 'one of each']);
  assert.equal(c.values[1].value, 'sku=, qty=1, picked=0, fragile=no');
  assert.equal(c.values[3].value, 'sku=, qty=1, picked=0, fragile=no\nsku=, qty=1, picked=1, fragile=no');
  // A boolean field varies once something reads it, an action's `where` included.
  const read = { ...doc, nodes: doc.nodes.map((n) => (n.id === 'a' ? { ...n, set: { short: 'short where fragile' } } : n)) };
  assert.deepEqual(labels(read, 'lines'), ['none', '[picked 0, fragile yes]', '[picked 0, fragile no]', '[picked 1, fragile yes]', '[picked 1, fragile no]', 'one of each']);
});

it('every combination of the checkout is a scenario; the four it already holds are left out', () => {
  const { scenarios, skipped } = generate(checkout, { mode: 'all', uid: (p) => p });
  assert.equal(skipped, 4);
  assert.equal(scenarios.length, 6);
  assert.equal(scenarios[0].name, 'channel=Web, hasCoupon=no');
  assert.deepEqual(scenarios[0].inputs, { channel: 'Web', hasCoupon: false });
  assert.deepEqual(scenarios[0].tags, ['generated']);
  assert.match(scenarios[0].description, /^Generated: one scenario for every combination of channel and hasCoupon\.\nchannel is Web; hasCoupon is no\.\nBranches: Has a coupon\? → else · Channel\? → online\.$/);
  // What the drawing did is the expectation, so each new row passes; the old rows are as they were.
  const all = runAll({ ...checkout, scenarios: [...checkout.scenarios, ...scenarios] });
  assert.equal(all.passed, 3 + 6);
  assert.deepEqual(scenarios[0].expect, { actions: ['Reserve stock', 'Keep full price', 'Take payment', 'Send confirmation email'], end: 'Done', state: { discount: 'null' } });
  // Pressing it again adds nothing.
  assert.equal(generate({ ...checkout, scenarios: [...checkout.scenarios, ...scenarios] }, { mode: 'all' }).scenarios.length, 0);
  // Without the skip, every combination comes, and only the ticked inputs are combined.
  assert.equal(plan(checkout, { skipCovered: false }).combos.length, 10);
  assert.equal(plan(checkout, { pick: { channel: ['Web', 'App', 'Marketplace', 'Phone', 'Kiosk'] } }).combos.length, 5 - 4);   // Web, App, Kiosk and Phone are held already, with hasCoupon at its fallback
});

it('a combination no branch handles comes out stuck, with a blank expectation and a description saying so', () => {
  const doc = flow([{ name: 'channel', type: 'enum', values: ['Web', 'Phone'] }], [{ when: 'channel == Web' }]);
  const { scenarios } = generate(doc);
  assert.equal(scenarios.length, 2);
  assert.deepEqual(scenarios[0].expect, { actions: ['A'], end: 'End', state: {} });
  assert.deepEqual(scenarios[1].expect, { actions: [], end: '', state: {} });
  assert.match(scenarios[1].description, /Stuck: nothing matched leaving "Q\?"\./);
  assert.equal(run(doc, scenarios[1]).error.message, 'nothing matched leaving "Q?"');
});

it('the expectation can be left blank, and the tags chosen or left off', () => {
  const { scenarios } = generate(checkout, { mode: 'all', expect: 'blank', tags: [] });
  assert.deepEqual(scenarios[0].expect, { actions: [], end: '', state: {} });
  assert.deepEqual(scenarios[0].tags, []);
  const tagged = generate(checkout, { mode: 'all', tags: ['combos', 'PROJ-12'] }).scenarios;
  assert.deepEqual(tagged[0].tags, ['combos', 'PROJ-12']);
  tagged[0].tags.push('x');
  assert.deepEqual(tagged[1].tags, ['combos', 'PROJ-12']);   // each row has its own list
});

it('what a run did, as an expectation: actions once each, the end, and a list state as its count', () => {
  const doc = { ...checkout, state: [...checkout.state, { name: 'kept', initial: 'lines' }], inputs: [...checkout.inputs, { name: 'lines', type: 'list', fields: [{ name: 'gift', type: 'boolean' }] }] };
  const r = run(doc, { inputs: { channel: 'Web', hasCoupon: true, lines: 'gift=yes\ngift=no' } });
  assert.deepEqual(expectationOf(doc, r), { actions: ['Reserve stock', 'Apply coupon', 'Take payment', 'Send confirmation email'], end: 'Done', state: { discount: '10', kept: '2' } });
});

it('only the picked values are combined; an input with none picked holds its usual value', () => {
  const all = { channel: ['Web', 'App', 'Marketplace', 'Phone', 'Kiosk'], hasCoupon: ['yes', 'no'] };
  assert.equal(count(candidates(checkout), { ...all, channel: ['Web', 'Phone'] }), 4);
  assert.equal(count(candidates(checkout), { channel: ['Web', 'Phone'], hasCoupon: [] }), 2);
  assert.equal(count(candidates(checkout), new Map([['channel', ['Web']]])), 1);   // a Map will do too

  const { scenarios } = generate(checkout, { pick: { channel: ['Marketplace', 'Phone'], hasCoupon: ['yes', 'no'] }, mode: 'all', skipCovered: false, uid: (p) => p });
  assert.deepEqual(scenarios.map((s) => s.name), ['channel=Marketplace, hasCoupon=yes', 'channel=Marketplace, hasCoupon=no', 'channel=Phone, hasCoupon=yes', 'channel=Phone, hasCoupon=no']);
  assert.match(scenarios[0].description, /^Generated: one scenario for every combination of channel \(Marketplace, Phone\) and hasCoupon\.\n/);

  // One value picked is held, not varied: it is in the description, not in the name.
  const one = generate(checkout, { pick: { channel: ['Marketplace', 'Phone'], hasCoupon: ['yes'] }, mode: 'all', skipCovered: false }).scenarios;
  assert.deepEqual(one.map((s) => [s.name, s.inputs.hasCoupon]), [['channel=Marketplace', true], ['channel=Phone', true]]);
  assert.match(one[0].description, /^Generated: one scenario for every combination of channel \(Marketplace, Phone\)\.\nchannel is Marketplace; hasCoupon is yes\./);

  // Nothing picked for hasCoupon: it holds no, and a scenario with other coupons does not cover these.
  const held = plan(checkout, { pick: { channel: ['Web', 'Marketplace'] } });
  assert.deepEqual(held.combos.map((c) => c.inputs), [{ channel: 'Marketplace', hasCoupon: false }]);
  assert.equal(held.skipped, 1);   // Web is held already, whatever its coupon

  // A single value everywhere still gets a name.
  const lone = generate(checkout, { mode: 'all', pick: { channel: ['Marketplace'], hasCoupon: ['no'] } }).scenarios;
  assert.deepEqual(lone.map((s) => s.name), ['channel=Marketplace, hasCoupon=no']);
  assert.match(lone[0].description, /^Generated: the one combination the picked values make\./);
});

// ---- one scenario for each way through the drawing ----------------------------------------------

/** Start → Where? (UK, or else) → Coupon? (hasCoupon, or else) → End: only UK is treated differently. */
const shop = () => ({
  inputs: [{ name: 'country', type: 'enum', values: ['UK', 'DE', 'FR', 'US'] }, { name: 'hasCoupon', type: 'boolean' }, { name: 'note', type: 'text' }],
  state: [],
  nodes: [{ id: 's', kind: 'start', label: 'Start' }, { id: 'where', kind: 'decision', label: 'Where?' }, { id: 'home', kind: 'action', label: 'Domestic' }, { id: 'abroad', kind: 'action', label: 'International' },
    { id: 'coupon', kind: 'decision', label: 'Coupon?' }, { id: 'off', kind: 'action', label: 'Take 10% off' }, { id: 'full', kind: 'action', label: 'Full price' }, { id: 'e', kind: 'end', label: 'Done' }],
  edges: [{ id: 'e0', from: 's', to: 'where' }, { id: 'e1', from: 'where', to: 'home', when: 'country == UK' }, { id: 'e2', from: 'where', to: 'abroad', else: true, label: 'abroad' },
    { id: 'e3', from: 'home', to: 'coupon' }, { id: 'e4', from: 'abroad', to: 'coupon' }, { id: 'e5', from: 'coupon', to: 'off', when: 'hasCoupon' }, { id: 'e6', from: 'coupon', to: 'full', else: true },
    { id: 'e7', from: 'off', to: 'e' }, { id: 'e8', from: 'full', to: 'e' }],
  scenarios: [],
});

it('combinations that go the same way are one scenario; the values the drawing treats alike take turns', () => {
  const doc = shop();
  const w = ways(doc);
  assert.deepEqual([w.explored, w.found, w.combos.length, w.skipped], [8, 4, 4, 0]);
  const { scenarios } = generate(doc, { uid: (p) => p });
  assert.deepEqual(scenarios.map((s) => s.name), ['country=UK, hasCoupon=yes', 'country=UK, hasCoupon=no', 'country=DE, hasCoupon=yes', 'country=FR, hasCoupon=no']);
  assert.equal(scenarios[2].description, [
    'Generated: one scenario for each way through the drawing, 4 found among the 8 combinations of country and hasCoupon.',
    'country is DE; hasCoupon is yes.',
    'Would go the same way with country FR or US.',
    'Branches: Where? → abroad · Coupon? → hasCoupon.',
  ].join('\n'));
  assert.doesNotMatch(scenarios[0].description, /same way|no difference/);   // UK stands alone
  assert.equal(runAll({ ...doc, scenarios }).passed, 4);
});

it('an input that makes no difference to a way is left out of its name, and said so', () => {
  const doc = shop();
  doc.edges = doc.edges.filter((e) => e.id !== 'e1').map((e) => (e.id === 'e2' ? { id: 'e2', from: 'where', to: 'abroad' } : e));   // everyone goes abroad
  const all = { country: ['UK', 'DE', 'FR', 'US'], hasCoupon: ['yes', 'no'], note: ['blank'] };
  const { scenarios } = generate(doc, { pick: all });
  assert.deepEqual(scenarios.map((s) => s.name), ['hasCoupon=yes', 'hasCoupon=no']);
  assert.deepEqual(scenarios.map((s) => s.inputs.country), ['UK', 'DE']);   // still spread
  assert.match(scenarios[0].description, /\nMakes no difference on this way: country\.\n/);
  // When nothing makes a difference, the name says which inputs were free.
  doc.edges = doc.edges.filter((e) => !['e5', 'e6', 'e8'].includes(e.id)).concat({ id: 'x', from: 'coupon', to: 'off' });
  const one = generate(doc, { pick: all }).scenarios;
  assert.deepEqual(one.map((s) => s.name), ['Any country and hasCoupon']);
  assert.match(one[0].description, /Makes no difference on this way: country and hasCoupon\./);
});

it('a way some scenario already goes is left out, whatever values that scenario holds', () => {
  const doc = shop();
  doc.scenarios = [{ id: 'x', name: 'US with a coupon', inputs: { country: 'US', hasCoupon: true }, expect: {} }];
  const w = ways(doc);
  assert.equal(w.skipped, 1);
  assert.deepEqual(w.combos.map((c) => [c.inputs.country, c.inputs.hasCoupon]), [['UK', true], ['UK', false], ['DE', false]]);
  assert.equal(ways(doc, { skipCovered: false }).combos.length, 4);
});

it('each place a run gets stuck is a way of its own', () => {
  const doc = flow([{ name: 'channel', type: 'enum', values: ['Web', 'App', 'Phone', 'Kiosk'] }], [{ when: 'channel == Web' }, { when: 'channel in [Web, App]' }]);
  const w = ways(doc);
  assert.equal(w.found, 3);   // Web is ambiguous, App goes to B, Phone and Kiosk match nothing
  const { scenarios } = generate(doc);
  assert.deepEqual(scenarios.map((s) => s.name), ['channel=Web', 'channel=App', 'channel=Phone']);
  assert.match(scenarios[0].description, /Stuck: ambiguous/);
  assert.match(scenarios[2].description, /Would go the same way with channel Kiosk\.\nStuck: nothing matched/);
  assert.notEqual(wayOf(run(doc, { inputs: { channel: 'Web' } })), wayOf(run(doc, { inputs: { channel: 'Phone' } })));
});

it('the runs are kept between calls, and too many combinations are refused', () => {
  const doc = shop(), cache = new Map();
  ways(doc, { cache });
  assert.equal(cache.size, 8);
  const again = ways(doc, { cache, pick: { country: ['UK', 'DE'], hasCoupon: ['yes', 'no'] } });
  assert.equal(cache.size, 8);   // every one of these was played already
  assert.equal(again.found, 4);
  const big = { inputs: Array.from({ length: 15 }, (_, k) => ({ name: `b${k}`, type: 'boolean' })), nodes: [], edges: [], state: [], scenarios: [] };
  const pick = Object.fromEntries(big.inputs.map((i) => [i.name, ['yes', 'no']]));
  assert.ok(count(candidates(big), pick) > MAX_COMBINATIONS);
  assert.throws(() => ways(big, { pick }), /more than 20000 combinations/);
});

it('every example flow: each way passes, and the ways cover every edge the combinations reach', async () => {
  for (const f of ['simple/checkout', 'advanced/orders/checkout', 'advanced/orders/payment', 'advanced/fulfilment/delivery', 'advanced/fulfilment/pick-and-pack', 'advanced/after-sale/returns', 'advanced/after-sale/refunds']) {
    const doc = JSON.parse(await readFile(new URL(`../examples/${f}.json`, import.meta.url), 'utf8'));
    const byWay = generate(doc, { skipCovered: false }).scenarios, every = generate(doc, { mode: 'all', skipCovered: false }).scenarios;
    assert.ok(byWay.length < every.length, f);
    const a = runAll({ ...doc, scenarios: byWay }), b = runAll({ ...doc, scenarios: every });
    assert.equal(a.passed, byWay.length, f);
    assert.deepEqual(a.coverage.untouchedEdges, b.coverage.untouchedEdges, f);
    assert.deepEqual(a.coverage.untouchedNodes, b.coverage.untouchedNodes, f);
  }
});
