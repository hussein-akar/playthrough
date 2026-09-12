import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listFlows, listFolders, openProject } from '../lib/project.mjs';
import { runAll, lint } from '../lib/run.mjs';

// The presets the Template menu offers are real project folders under examples/, listed in
// examples/presets.json. Each must be a folder the server could open as it is, every flow in it
// must draw cleanly, and its scenarios must pass, except the one checkout row that fails on purpose.
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('examples/presets.json', root), 'utf8'));
const byId = Object.fromEntries(manifest.presets.map((p) => [p.id, p]));

it('there are three presets: empty, simple and advanced, each with a description', () => {
  assert.deepEqual(manifest.presets.map((p) => p.id), ['empty', 'simple', 'advanced']);
  for (const p of manifest.presets) assert.ok(p.name && p.description?.length > 40, p.id);
  assert.deepEqual(byId.empty.flows, []);
});

it('a preset lists exactly the flows its folder holds, and the folder is a named project', async () => {
  for (const p of manifest.presets.filter((x) => x.dir)) {
    const dir = new URL(p.dir, root).pathname;
    assert.deepEqual([...p.flows].sort(), (await listFlows(dir)).map((f) => f.file), p.id);
    assert.equal((await openProject(dir)).name, 'Shop', p.id);
  }
});

it('simple is two flows at the root; advanced is six flows in three groups', async () => {
  assert.equal(byId.simple.flows.length, 2);
  assert.deepEqual(await listFolders(new URL(byId.simple.dir, root).pathname), []);
  assert.equal(byId.advanced.flows.length, 6);
  assert.deepEqual(await listFolders(new URL(byId.advanced.dir, root).pathname), ['after-sale', 'fulfilment', 'orders']);
  assert.deepEqual([...new Set(byId.advanced.flows.map((f) => f.split('/')[0]))].sort(), ['after-sale', 'fulfilment', 'orders']);
});

it('every preset flow draws cleanly, touches every node and edge, and passes, except the one that fails on purpose', async () => {
  for (const p of manifest.presets.filter((x) => x.dir)) {
    for (const file of p.flows) {
      const doc = JSON.parse(await readFile(new URL(`${p.dir}/${file}`, root), 'utf8'));
      assert.ok(doc.name && doc.description, `${p.id}/${file} is named and described`);
      assert.deepEqual(lint(doc), [], `${p.id}/${file} lints clean`);
      const { results, passed, coverage } = runAll(doc);
      assert.ok(results.length >= 4, `${p.id}/${file} has scenarios`);
      assert.deepEqual([...coverage.untouchedNodes, ...coverage.untouchedEdges], [], `${p.id}/${file} is covered`);
      if (p.id === 'simple' && file === 'checkout.json') {
        assert.equal(passed, results.length - 1, 'one checkout scenario fails on purpose');
        assert.deepEqual(results.filter((r) => !r.verdict.pass).map((r) => r.scenario.tags), [['assumption', 'receipt']]);
      } else assert.equal(passed, results.length, `${p.id}/${file} passes`);
    }
  }
});
