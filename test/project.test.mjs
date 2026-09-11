import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProject, listFlows, readFlow, writeFlow, deleteFlow, fileFor, isFlowFile } from '../lib/project.mjs';

const fresh = () => mkdtemp(join(tmpdir(), 'playthrough-'));
const example = JSON.parse(await readFile(new URL('../examples/order.json', import.meta.url), 'utf8'));

test('file names: one segment, .json, never a dot-file or a walk up the tree', () => {
  assert.equal(fileFor('Order intake'), 'order-intake.json');
  assert.equal(fileFor('  ??  '), 'flow.json');
  assert.ok(isFlowFile('a-b.json'));
  assert.ok(!isFlowFile('../a.json'));
  assert.ok(!isFlowFile('a/b.json'));
  assert.ok(!isFlowFile('.hidden.json'));
  assert.ok(!isFlowFile('project.json'));
  assert.ok(!isFlowFile('a.txt'));
});

test('a project is named by project.json, else by its folder', async () => {
  const dir = await fresh();
  assert.equal((await openProject(dir)).name, dir.split('/').pop());
  await writeFile(join(dir, 'project.json'), '{ "name": "Billing" }');
  assert.equal((await openProject(dir)).name, 'Billing');
});

test('list shows each flow with its counts, and a broken file as broken', async () => {
  const dir = await fresh();
  await writeFlow(dir, 'order.json', example);
  await writeFlow(dir, 'empty.json', { name: 'Empty' });
  await writeFile(join(dir, 'bad.json'), '{ not json');
  await writeFile(join(dir, 'notes.txt'), 'ignored');
  const flows = await listFlows(dir);
  assert.deepEqual(flows.map((f) => f.file), ['bad.json', 'empty.json', 'order.json']);
  const g = flows[2];
  assert.equal(g.name, 'Order intake');
  assert.equal(g.scenarios, 4);
  assert.equal(g.passed, 3);          // one fails on purpose
  assert.equal(flows[1].scenarios, 0);
  assert.match(flows[0].broken, /JSON/);
});

test('write refuses to clobber a file that changed since it was read', async () => {
  const dir = await fresh();
  const mtime = await writeFlow(dir, 'x.json', { name: 'X' });
  const { mtime: read } = await readFlow(dir, 'x.json');
  assert.equal(read, mtime);
  // someone else writes (a pull, an editor): bump the mtime well past ours
  await utimes(join(dir, 'x.json'), new Date(), new Date(mtime + 5000));
  await assert.rejects(writeFlow(dir, 'x.json', { name: 'X2' }, { ifMtime: mtime }), (e) => e.code === 'CONFLICT' && e.mtime > mtime);
  // without a precondition it goes through, and a new file must not already exist
  await writeFlow(dir, 'x.json', { name: 'X3' });
  assert.equal((await readFlow(dir, 'x.json')).doc.name, 'X3');
  await assert.rejects(writeFlow(dir, 'x.json', {}, { mustBeNew: true }), (e) => e.code === 'EXISTS');
  await deleteFlow(dir, 'x.json');
  await assert.rejects(readFlow(dir, 'x.json'), (e) => e.code === 'ENOENT');
  await assert.rejects(readFlow(dir, '../x.json'), (e) => e.code === 'BADNAME');
});
