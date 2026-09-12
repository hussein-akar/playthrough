import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renameName, rewrite } from '../ui/store.mjs';
import { run, lint } from '../lib/run.mjs';

const doc = JSON.parse(await readFile(new URL('../examples/simple/checkout.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(doc);

it('rewrites whole identifiers only', () => {
  assert.equal(rewrite('channel in [Web] and subchannel == channel', 'channel', 'route'), 'route in [Web] and subchannel == route');
  assert.equal(rewrite('type_2 + type', 'type', 'kind'), 'type_2 + kind');
  assert.equal(rewrite("who.role == 'who' and \"type\" != type", 'who', 'actor'), "actor.role == 'who' and \"type\" != type");
  assert.equal(rewrite('a.type == 1e5', 'type', 'kind'), 'a.type == 1e5', 'the tail of a dotted name is not the name');
  assert.equal(rewrite('', 'a', 'b'), '');
});

it('renaming an input follows it into guards and scenario inputs, and the flow still runs', () => {
  const d = renameName(clone(), 'channel', 'salesChannel');
  assert.equal(d.edges.find((e) => e.id === 'e8').when, 'salesChannel in [Web, App, Marketplace]');
  assert.deepEqual(Object.keys(d.scenarios[0].inputs), ['salesChannel', 'hasCoupon']);
  assert.equal(d.scenarios[0].inputs.salesChannel, 'Web');
  d.inputs[0].name = 'salesChannel';
  assert.deepEqual(lint(d), []);
  assert.equal(run(d, d.scenarios[0]).end, 'Done');
});

it('renaming a state field follows it into sets and expected state', () => {
  const d = clone();
  d.edges.find((e) => e.id === 'e7').when = 'discount == null or not discount';
  renameName(d, 'discount', 'discountPct');
  assert.deepEqual(d.nodes.find((n) => n.id === 'apply').set, { discountPct: '10' });
  assert.deepEqual(d.scenarios[0].expect.state, { discountPct: '*' });
  assert.equal(d.edges.find((e) => e.id === 'e7').when, 'discountPct == null or not discountPct');
  assert.equal(d.scenarios[3].expect.state, undefined, 'a scenario without expected state is left as it was');
});

it('a half-typed or empty name changes nothing', () => {
  for (const to of ['', '1x', 'a b', 'channel']) assert.deepEqual(renameName(clone(), 'channel', to), doc);
});
