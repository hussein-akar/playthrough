import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '../lib/markdown.mjs';

const doc = JSON.parse(await readFile(new URL('../examples/simple/checkout.json', import.meta.url), 'utf8'));

it('the example becomes a spec with every section', () => {
  const md = toMarkdown(doc);
  const lines = md.split('\n');
  assert.equal(lines[0], '# Checkout');
  assert.ok(md.includes(doc.description));
  for (const h of ['## Inputs', '## State', '## Branches', '## Scenarios']) assert.ok(md.includes(`\n${h}\n`), h);
  assert.ok(md.includes('| `channel` | enum | `Web`, `App`, `Marketplace`, `Phone`, `Kiosk` |'));
  assert.ok(md.includes('| `hasCoupon` | boolean |  |'));
  assert.ok(md.includes('| `discount` | `null` |'));
});

it('decisions list their branches, else last as drawn, a label before its guard', () => {
  const md = toMarkdown(doc);
  assert.ok(md.includes('- **Has a coupon?**\n  - `hasCoupon` → Apply coupon\n  - _else_ → Keep full price'));
  assert.ok(md.includes('- **Channel?**\n  - online · `channel in [Web, App, Marketplace]` → Send confirmation email\n  - in person · _else_ → Print receipt'));
});

it('the scenario table carries inputs, expectations and the verdict', () => {
  const md = toMarkdown(doc);
  assert.ok(md.includes('3 of 4 pass.'));
  assert.ok(md.includes('| Scenario | Tags | `channel` | `hasCoupon` | Expected actions | Lands on | `discount` | Result |'));
  assert.ok(md.includes('| Web order with a coupon | `happy path` | Web | true | Reserve stock, Apply coupon, Take payment, Send confirmation email | Done | * | ✅ pass |'));
  const rows = md.split('\n').filter((l) => l.startsWith('| ') && /(✅|❌)/.test(l));
  assert.equal(rows.length, 4);
  assert.match(rows[3], /❌ fail: expected "Send confirmation email" to happen; it did not; /);
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
