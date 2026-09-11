import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '../lib/markdown.mjs';

const doc = JSON.parse(await readFile(new URL('../examples/order.json', import.meta.url), 'utf8'));

it('the example becomes a spec with every section', () => {
  const md = toMarkdown(doc);
  const lines = md.split('\n');
  assert.equal(lines[0], '# Order intake');
  assert.ok(md.includes(doc.description));
  for (const h of ['## Inputs', '## State', '## Decisions', '## Scenarios']) assert.ok(md.includes(`\n${h}\n`), h);
  assert.ok(md.includes('| `type` | enum | `Subscription`, `Preorder`, `Wholesale`, `Refund`, `Standard` |'));
  assert.ok(md.includes('| `isExpress` | boolean |  |'));
  assert.ok(md.includes('| `deliveryDate` | `null` |'));
});

it('decisions list their branches, else last as drawn', () => {
  const md = toMarkdown(doc);
  assert.ok(md.includes('- **Express shipping?**\n  - `isExpress` → Set express delivery date\n  - _else_ → Keep delivery date null'));
  assert.ok(md.includes('- **Order type?**\n  - `type in [Subscription, Preorder, Wholesale]` → Publish Subscription/Preorder received event\n  - _else_ → Trigger Post Processing'));
});

it('the scenario table carries inputs, expectations and the verdict', () => {
  const md = toMarkdown(doc);
  assert.ok(md.includes('3 of 4 pass.'));
  assert.ok(md.includes('| Scenario | Tags | `type` | `isExpress` | Expected actions | Lands on | `deliveryDate` | Result |'));
  assert.ok(md.includes('| Subscription with express shipping | `happy path` | Subscription | true | Create Shipment, Set express delivery date, Create Invoice, Publish Subscription/Preorder received event | Done | * | ✅ pass |'));
  const rows = md.split('\n').filter((l) => l.startsWith('| ') && /(✅|❌)/.test(l));
  assert.equal(rows.length, 4);
  assert.match(rows[3], /❌ fail: expected "Trigger Post Processing" to happen; it did not; /);
});

it('an empty flow and stray pipes do not break the tables', () => {
  const md = toMarkdown({ name: '', nodes: [], edges: [], scenarios: [] });
  assert.ok(md.startsWith('# Untitled flow\n'));
  assert.equal((md.match(/_None\._/g) ?? []).length, 4);
  const piped = { name: 'a|b', inputs: [{ name: 'x', type: 'text' }], nodes: [{ id: 's', kind: 'start', label: 'S' }, { id: 'e', kind: 'end', label: 'E' }], edges: [{ id: 'e1', from: 's', to: 'e' }],
    scenarios: [{ id: '1', name: 'one | two', inputs: { x: 'p|q' }, expect: { actions: [], end: 'E', state: {} } }] };
  const md2 = toMarkdown(piped);
  assert.ok(md2.startsWith('# a\\|b\n'));
  assert.ok(md2.includes('| one \\| two | p\\|q |  | E | ✅ pass |'));
});
