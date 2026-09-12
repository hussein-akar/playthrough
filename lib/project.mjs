// A project is a folder of flow files, with subfolders to group them. This is everything the
// server does to one: list the flows with their pass counts and the folders, read one, write one
// back without clobbering an edit that came in from elsewhere (a git pull, a colleague's editor),
// give a new flow a file name, make and remove folders. A flow is named by its path inside the
// project, `billing/refunds/intake.json`. No DOM, no HTTP.
import { readFile, writeFile, readdir, stat, unlink, mkdir, rename, rmdir, rm } from 'node:fs/promises';
import { basename, join, resolve, dirname } from 'node:path';
import { runAll, lint } from './run.mjs';

const SEG = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;   // one path segment: no dot-files, nothing that walks the tree; spaces inside are fine, folders made by hand have them
const MAX_DEPTH = 8;
const segments = (p) => String(p ?? '').split('/');
const goodSegments = (segs) => segs.length >= 1 && segs.length <= MAX_DEPTH && segs.every((x) => SEG.test(x) && x !== '..' && !x.endsWith('.json'));

/** True for a flow path the API will touch: segments that stay inside the project, the last one a .json file. */
export const isFlowFile = (file) => {
  const segs = segments(file);
  if (segs.length < 1 || segs.length > MAX_DEPTH || file === 'project.json') return false;
  const last = segs[segs.length - 1], dirs = segs.slice(0, -1);
  return (dirs.length === 0 || goodSegments(dirs)) && SEG.test(last) && last.endsWith('.json') && last.length > '.json'.length;
};

/** True for a folder path the API will make or remove: one or more good segments. */
export const isFolderPath = (p) => goodSegments(segments(p));

/** The folder part of a flow path, '' at the root. */
export const folderOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

/**
 * A file name for a flow called `name`: lower-case words joined by dashes. A name with slashes
 * names the folders on the way, `Billing / Refund intake` → `billing/refund-intake.json`.
 */
const slug = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function fileFor(name) {
  const parts = String(name || '').split('/').map(slug).filter(Boolean);
  const last = parts.pop() || 'flow';
  return [...parts, `${last}.json`].join('/');
}

/** `folder/file`, or just `file` at the root. */
export const under = (folder, file) => (folder ? `${folder}/${file}` : file);

/** The project in `dir`: its name from project.json, else the folder's own name. Creates the folder. */
export async function openProject(dir) {
  dir = resolve(dir);
  await mkdir(dir, { recursive: true });
  let meta = {};
  try { meta = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')); } catch {}
  return { dir, name: meta.name || basename(dir) };
}

/** Name the project: written to project.json (the rest of that file, if any, is kept). */
export async function setProjectName(dir, name) {
  let meta = {};
  try { meta = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')); } catch {}
  meta.name = String(name ?? '').trim() || basename(dir);
  await writeFile(join(dir, 'project.json'), JSON.stringify(meta, null, 2) + '\n');
  return { name: meta.name };
}

/** Every flow in the folder and its subfolders, with what the sidebar shows: name, scenario counts, drawing problems. */
export async function listFlows(dir) {
  const flows = [];
  for (const file of (await walk(dir)).files) {
    try { flows.push(await summarize(dir, file)); }
    catch (e) { flows.push({ file, name: basename(file), broken: e.message }); }
  }
  return flows;
}

/** Every folder in the project, as paths, so an empty one still shows. */
export async function listFolders(dir) { return (await walk(dir)).folders; }

/** The tree under `dir`: flow files and folders as paths relative to it, sorted, dot-entries and node_modules left out. */
async function walk(dir, rel = '', depth = 1, out = { files: [], folders: [] }) {
  const entries = await readdir(join(dir, rel), { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = under(rel, e.name);
    if (e.isDirectory()) { if (SEG.test(e.name) && !e.name.endsWith('.json') && e.name !== 'node_modules' && depth < MAX_DEPTH) { out.folders.push(path); await walk(dir, path, depth + 1, out); } }
    else if (isFlowFile(path)) out.files.push(path);
  }
  return out;
}

async function summarize(dir, file) {
  const { doc, mtime } = await readFlow(dir, file);
  const results = runAll(doc);
  return { file, mtime, name: doc.name || file.replace(/\.json$/, ''), scenarios: doc.scenarios?.length ?? 0, passed: results.passed, problems: lint(doc).length, nodes: doc.nodes?.length ?? 0 };
}

/** One flow and the time its file was last written, which a later write hands back as `ifMtime`. */
export async function readFlow(dir, file) {
  if (!isFlowFile(file)) throw badName(file);
  const path = join(dir, file);
  const [text, s] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
  return { file, doc: JSON.parse(text), mtime: s.mtimeMs };
}

/**
 * Write a flow. With `ifMtime`, the write is refused when the file on disk has changed since it
 * was read, so two people (or a person and a pull) do not silently overwrite each other; the
 * error carries `code: 'CONFLICT'` and the current mtime. Without it, the file is created or
 * replaced outright. Resolves to the new mtime.
 */
export async function writeFlow(dir, file, doc, { ifMtime = null, mustBeNew = false } = {}) {
  if (!isFlowFile(file)) throw badName(file);
  const path = join(dir, file);
  const current = await stat(path).then((s) => s.mtimeMs).catch(() => null);
  if (mustBeNew && current != null) throw Object.assign(new Error(`${file} already exists`), { code: 'EXISTS' });
  if (ifMtime != null && current != null && Math.abs(current - ifMtime) > 1) throw Object.assign(new Error(`${file} changed on disk since it was opened`), { code: 'CONFLICT', mtime: current });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(doc, null, 2) + '\n');
  return (await stat(path)).mtimeMs;
}

/**
 * Give a flow's file another name, made from `name` the way a new file's is, in the folder it
 * is in, or in `folder` when one is given, or in the folders a name with slashes spells out.
 * Refuses to land on a file that exists (`code: 'EXISTS'`). Resolves to the new path and its
 * mtime, which the rename leaves as it was, so a page holding the old one can still save without
 * a false conflict.
 */
export async function renameFlow(dir, from, name, folder = null) {
  if (!isFlowFile(from)) throw badName(from);
  const to = String(name ?? '').includes('/') ? fileFor(name) : under(folder ?? folderOf(from), fileFor(name));
  if (!isFlowFile(to)) throw badName(to);
  if (to === from) return { file: to, mtime: (await stat(join(dir, from))).mtimeMs };
  if (await stat(join(dir, to)).then(() => true, () => false)) throw Object.assign(new Error(`${to} already exists`), { code: 'EXISTS' });
  await mkdir(dirname(join(dir, to)), { recursive: true });
  await rename(join(dir, from), join(dir, to));
  return { file: to, mtime: (await stat(join(dir, to))).mtimeMs };
}

/**
 * Give a group another name, made from `name` the way a new group's is, in the parent it is in;
 * a name with slashes spells out the groups it moves under instead. Everything in it comes
 * along. Refuses to land on a folder that exists (`code: 'EXISTS'`) or inside itself. Resolves
 * to the new path.
 */
export async function renameFolder(dir, from, name) {
  if (!isFolderPath(from)) throw badName(from);
  const parts = String(name ?? '').split('/').map(slug).filter(Boolean);
  const to = String(name ?? '').includes('/') ? parts.join('/') : under(folderOf(from), parts.join('/'));
  if (!isFolderPath(to)) throw badName(to);
  if (to === from) return { folder: to };
  if (to.startsWith(`${from}/`)) throw Object.assign(new Error(`${from} cannot move inside itself`), { code: 'BADNAME' });
  if (await stat(join(dir, to)).then(() => true, () => false)) throw Object.assign(new Error(`${to} already exists`), { code: 'EXISTS' });
  await mkdir(dirname(join(dir, to)), { recursive: true });
  await rename(join(dir, from), join(dir, to));
  return { folder: to };
}

/** A folder (and the folders on the way to it). Already there is fine. */
export async function createFolder(dir, path) {
  if (!isFolderPath(path)) throw badName(path);
  await mkdir(join(dir, path), { recursive: true });
  return { folder: path };
}

/** Remove a folder: only when nothing is in it (`code: 'NOTEMPTY'` otherwise), or with everything in it when `all` is set. */
export async function deleteFolder(dir, path, { all = false } = {}) {
  if (!isFolderPath(path)) throw badName(path);
  if (all) { await rm(join(dir, path), { recursive: true, force: true }); return { folder: path, all: true }; }
  try { await rmdir(join(dir, path)); }
  catch (e) { if (e.code === 'ENOTEMPTY') throw Object.assign(new Error(`${path} is not empty`), { code: 'NOTEMPTY' }); throw e; }
  return { folder: path };
}

export async function deleteFlow(dir, file) {
  if (!isFlowFile(file)) throw badName(file);
  await unlink(join(dir, file));
}

const badName = (file) => Object.assign(new Error(`not a flow file name: ${file}`), { code: 'BADNAME' });
