import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTags, tagSummary, normalize } from '../ui/store.mjs';
import { runAll } from '../lib/run.mjs';
import { toMarkdown } from '../lib/markdown.mjs';

const example = async () => JSON.parse(await readFile(new URL('../examples/simple/checkout.json', import.meta.url), 'utf8'));

it('tags are comma-separated, trimmed, deduplicated, in order', () => {
  assert.deepEqual(parseTags(' edge, PROJ-12 ,edge,, '), ['edge', 'PROJ-12']);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(parseTags(null), []);
});

it('a hand-written file may have tags as a list or a string, or none', () => {
  const d = normalize({ scenarios: [{ tags: ['a', ' b '] }, { tags: 'c, d' }, {}] });
  assert.deepEqual(d.scenarios.map((s) => s.tags), [['a', 'b'], ['c', 'd'], []]);
});

it('the tally per tag counts passes among the scenarios that carry it', async () => {
  const doc = normalize(await example());
  const tags = tagSummary(doc, runAll(doc));
  const happy = tags.find((t) => t.tag === 'happy path');
  assert.ok(happy);
  assert.equal(happy.total, 3);
  assert.equal(happy.passed, 3);
  const assumed = tags.find((t) => t.tag === 'assumption');
  assert.deepEqual([assumed.total, assumed.passed], [1, 0]);
});

it('the Markdown carries a Tags column and a By tag tally only when someone tagged', async () => {
  const doc = normalize(await example());
  const md = toMarkdown(doc);
  assert.match(md, /\| Scenario \| Tags \|/);
  assert.match(md, /### By tag\n\n- `happy path` · 3 of 3 pass\n- `receipt` · 1 of 2 pass\n- `assumption` · 0 of 1 pass/);
  for (const s of doc.scenarios) s.tags = [];
  const plain = toMarkdown(doc);
  assert.doesNotMatch(plain, /Tags/);
  assert.doesNotMatch(plain, /By tag/);
});
