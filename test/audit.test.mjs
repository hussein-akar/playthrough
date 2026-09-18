import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { audit, MAX_CASES } from '../lib/audit.mjs';
import { run } from '../lib/run.mjs';

const checkout = JSON.parse(await readFile(new URL('../examples/simple/checkout.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(checkout));
const edge = (doc, id) => doc.edges.find((e) => e.id === id);
const messages = (doc) => audit(doc).problems.map((p) => p.message);

it('the examples are clean, and the audit is cheap enough to run on every edit', async () => {
  for (const f of ['simple/checkout', 'simple/returns', 'advanced/orders/checkout', 'advanced/orders/payment', 'advanced/fulfilment/delivery', 'advanced/fulfilment/pick-and-pack', 'advanced/after-sale/returns', 'advanced/after-sale/refunds']) {
    const doc = JSON.parse(await readFile(new URL(`../examples/${f}.json`, import.meta.url), 'utf8'));
    const a = audit(doc);
    assert.deepEqual(a.problems, [], f);
    assert.equal(a.skipped, false);
    assert.ok(a.cases <= 100, `${f}: ${a.cases} cases`);
  }
});

it('a case no branch takes is a hole on the decision, and an else swallows it', () => {
  const doc = clone();
  Object.assign(edge(doc, 'e9'), { else: false, when: 'channel == Kiosk' });   // Phone is now handled by nobody
  const [p, ...rest] = audit(doc).problems;
  assert.deepEqual(rest, []);
  assert.equal(p.message, '"Channel?" has no branch when channel is Phone (2 cases)');
  assert.deepEqual([p.node, p.kind, p.edges, p.cases], ['channel', 'hole', [], 2]);
  assert.deepEqual(p.example.varied, [{ name: 'channel', label: 'Phone', text: 'is Phone' }]);   // hasCoupon does not matter, so it is not named
  assert.equal(p.example.inputs.channel, 'Phone');
  assert.equal(run(doc, { inputs: p.example.inputs }).error.kind, 'unmatched', 'the example really is stuck there');
  assert.deepEqual(messages(checkout), [], 'with the else back, nothing is missing');
});

it('a case two branches take is an overlap naming both, by label where there is one', () => {
  const doc = clone();
  doc.edges.push({ id: 'x', from: 'channel', to: 'receipt', when: 'channel in [Web, Kiosk]' });
  const ps = audit(doc).problems;
  assert.deepEqual(ps.map((p) => p.message), ['"Channel?": "online" and "channel in [Web, Kiosk]" both hold when channel is Web (2 cases)']);
  assert.deepEqual([ps[0].kind, ps[0].edges], ['overlap', ['e8', 'x']]);
  assert.equal(run(doc, { inputs: ps[0].example.inputs }).error.kind, 'ambiguous');
  // Kiosk is not an overlap: the else only takes what nothing else did.
  assert.equal(run(doc, { inputs: { channel: 'Kiosk', hasCoupon: false } }).error, null);
});

it('a case an earlier decision sends elsewhere is not held against a decision it never reaches', () => {
  // Only coupon orders reach a second decision, whose branches cover Web alone: Phone-with-coupon
  // is the hole, and Phone-without never gets there, so it is not one.
  const doc = clone();
  doc.nodes.push({ id: 'q2', kind: 'decision', label: 'Where from?' });
  edge(doc, 'e5').to = 'q2';
  doc.edges.push({ id: 'q2a', from: 'q2', to: 'pay', when: 'channel == Web' });
  const ps = audit(doc).problems;
  assert.deepEqual(ps.map((p) => p.message), ['"Where from?" has no branch when channel is App and hasCoupon is yes (4 cases)']);
  assert.deepEqual(ps[0].example.varied.map((v) => v.name), ['channel', 'hasCoupon'], 'both matter: the coupon is what brings the case here');
  assert.equal(ps[0].example.inputs.hasCoupon, true);
});

it('a guard on state an action set is judged on the state the run had', () => {
  // `discount` is 10 after Apply coupon and null otherwise; a decision after payment reads it.
  const doc = clone();
  doc.nodes.push({ id: 'q2', kind: 'decision', label: 'Discounted?' });
  edge(doc, 'e7').to = 'q2';
  doc.edges.push({ id: 'q2a', from: 'q2', to: 'channel', when: 'discount == 10' });
  const ps = audit(doc).problems;
  assert.deepEqual(ps.map((p) => p.message), ['"Discounted?" has no branch when hasCoupon is no (5 cases)']);
  doc.edges.push({ id: 'q2b', from: 'q2', to: 'channel', when: 'discount == null' });
  assert.deepEqual(messages(doc), []);
});

it('a stop that is not at a decision is lint\'s, not the audit\'s', () => {
  const doc = clone();
  edge(doc, 'e5').when = 'channel == Web';   // a guard leaving an action can only stop the run
  assert.deepEqual(messages(doc), []);
});

it('findings read down the flow, holes before overlaps at one decision', () => {
  const doc = clone();
  Object.assign(edge(doc, 'e9'), { else: false, when: 'channel == Kiosk' });
  doc.edges.push({ id: 'x', from: 'channel', to: 'receipt', when: 'channel in [Web, Kiosk]' });
  doc.edges = doc.edges.filter((e) => e.id !== 'e4');   // and the earlier decision loses its else, so only coupon orders get past it
  assert.deepEqual(messages(doc), [
    '"Has a coupon?" has no branch when hasCoupon is no (5 cases)',
    '"Channel?" has no branch when channel is Phone and hasCoupon is yes',
    '"Channel?": "online" and "channel in [Web, Kiosk]" both hold when channel is Web and hasCoupon is yes',
    '"Channel?": "in person" and "channel in [Web, Kiosk]" both hold when channel is Kiosk and hasCoupon is yes',
  ]);
});

it('past the cap nothing is played unless forced', () => {
  const doc = clone();
  doc.inputs.push({ name: 'country', type: 'enum', values: Array.from({ length: 300 }, (_, i) => `C${i}`) });
  edge(doc, 'e8').when = 'channel in [Web, App, Marketplace] and country != C1';
  assert.equal(MAX_CASES, 2000);
  const a = audit(doc);
  assert.deepEqual([a.skipped, a.cases, a.problems], [true, 3000, []]);
  const forced = audit(doc, { force: true });
  assert.equal(forced.skipped, false);
  assert.deepEqual(forced.problems, []);
  assert.equal(audit(doc, { cap: 5000 }).skipped, false);
});
