import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProject, listFlows, listFolders, readFlow, writeFlow, deleteFlow, renameFlow, createFolder, deleteFolder, fileFor, isFlowFile, isFolderPath, folderOf } from '../lib/project.mjs';

const fresh = () => mkdtemp(join(tmpdir(), 'playthrough-'));
const example = JSON.parse(await readFile(new URL('../examples/order.json', import.meta.url), 'utf8'));

test('file names: good segments, .json at the end, never a dot-file or a walk up the tree', () => {
  assert.equal(fileFor('Order intake'), 'order-intake.json');
  assert.equal(fileFor('  ??  '), 'flow.json');
  assert.equal(fileFor('Billing / Refund intake'), 'billing/refund-intake.json', 'slashes name the folders on the way');
  assert.ok(isFlowFile('a-b.json'));
  assert.ok(isFlowFile('a/b.json'));
  assert.ok(isFlowFile('a/b/c.json'));
  assert.ok(isFlowFile('Shop Returns Automation/flow-1.json'), 'a folder made by hand may have spaces');
  assert.ok(!isFlowFile(' a/b.json'));
  assert.ok(!isFlowFile('../a.json'));
  assert.ok(!isFlowFile('a/../b.json'));
  assert.ok(!isFlowFile('.hidden.json'));
  assert.ok(!isFlowFile('a/.hidden.json'));
  assert.ok(!isFlowFile('project.json'));
  assert.ok(!isFlowFile('a.txt'));
  assert.ok(!isFlowFile('a/'));
  assert.ok(isFolderPath('billing/refunds') && !isFolderPath('../x') && !isFolderPath('a.json') && !isFolderPath(''));
  assert.equal(folderOf('billing/refunds/intake.json'), 'billing/refunds');
  assert.equal(folderOf('intake.json'), '');
});

test('flows live in folders: listed as a tree, created inside one, moved between them, folders made and removed', async () => {
  const dir = await fresh();
  await writeFlow(dir, 'root.json', { name: 'Root' });
  await writeFlow(dir, 'billing/refunds/intake.json', { name: 'Intake' });   // the folders are made on the way
  await createFolder(dir, 'billing/holds');
  await writeFile(join(dir, 'billing/notes.txt'), 'ignored');
  assert.deepEqual((await listFlows(dir)).map((f) => f.file), ['billing/refunds/intake.json', 'root.json']);
  assert.deepEqual(await listFolders(dir), ['billing', 'billing/holds', 'billing/refunds']);
  // rename keeps the folder; a folder argument moves; slashes in the name spell the folders
  assert.equal((await renameFlow(dir, 'billing/refunds/intake.json', 'Refund intake')).file, 'billing/refunds/refund-intake.json');
  assert.equal((await renameFlow(dir, 'billing/refunds/refund-intake.json', 'refund-intake', 'billing/holds')).file, 'billing/holds/refund-intake.json');
  assert.equal((await renameFlow(dir, 'root.json', 'root', '')).file, 'root.json');
  assert.equal((await renameFlow(dir, 'root.json', 'archive/old/root')).file, 'archive/old/root.json');
  assert.deepEqual((await listFlows(dir)).map((f) => f.file), ['archive/old/root.json', 'billing/holds/refund-intake.json']);
  await assert.rejects(deleteFolder(dir, 'billing/holds'), (e) => e.code === 'NOTEMPTY');
  await deleteFolder(dir, 'billing/refunds');
  assert.deepEqual(await listFolders(dir), ['archive', 'archive/old', 'billing', 'billing/holds']);
  await assert.rejects(createFolder(dir, '../out'), (e) => e.code === 'BADNAME');
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

test('rename makes the file name from the new name, keeps the mtime, and will not land on another file', async () => {
  const dir = await fresh();
  const mtime = await writeFlow(dir, 'old-name.json', { name: 'Old name' });
  await writeFlow(dir, 'taken.json', { name: 'Taken' });
  const r = await renameFlow(dir, 'old-name.json', 'New Name!');
  assert.equal(r.file, 'new-name.json');
  assert.equal(Math.round(r.mtime), Math.round(mtime));
  assert.deepEqual((await listFlows(dir)).map((f) => f.file), ['new-name.json', 'taken.json']);
  assert.equal((await readFlow(dir, 'new-name.json')).doc.name, 'Old name');   // the flow's own name is not the file's
  await assert.rejects(renameFlow(dir, 'new-name.json', 'taken'), (e) => e.code === 'EXISTS');
  assert.deepEqual(await renameFlow(dir, 'new-name.json', 'new name'), { file: 'new-name.json', mtime: r.mtime });   // same name: nothing happens
  await assert.rejects(renameFlow(dir, 'missing.json', 'x'), (e) => e.code === 'ENOENT');
  await assert.rejects(renameFlow(dir, '../x.json', 'x'), (e) => e.code === 'BADNAME');
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
