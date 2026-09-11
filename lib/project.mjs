// A project is a folder of flow files. This is everything the server does to one: list the flows
// with their pass counts, read one, write one back without clobbering an edit that came in from
// elsewhere (a git pull, a colleague's editor), and give a new flow a file name. No DOM, no HTTP.
import { readFile, writeFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { runAll, lint } from './run.mjs';

const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;   // one path segment, ends in .json, no dot-files

/** True for a file name the API will touch: a single segment, nothing that walks the tree. */
export const isFlowFile = (file) => FILE.test(file) && file !== 'project.json';

/** A file name for a flow called `name`: lower-case words joined by dashes. */
export function fileFor(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'flow'}.json`;
}

/** The project in `dir`: its name from project.json, else the folder's own name. Creates the folder. */
export async function openProject(dir) {
  dir = resolve(dir);
  await mkdir(dir, { recursive: true });
  let meta = {};
  try { meta = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')); } catch {}
  return { dir, name: meta.name || basename(dir) };
}

/** Every flow in the folder, with what the sidebar shows: name, scenario counts, drawing problems. */
export async function listFlows(dir) {
  const files = (await readdir(dir)).filter(isFlowFile).sort();
  const flows = [];
  for (const file of files) {
    try { flows.push(await summarize(dir, file)); }
    catch (e) { flows.push({ file, name: file, broken: e.message }); }
  }
  return flows;
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
  await writeFile(path, JSON.stringify(doc, null, 2) + '\n');
  return (await stat(path)).mtimeMs;
}

export async function deleteFlow(dir, file) {
  if (!isFlowFile(file)) throw badName(file);
  await unlink(join(dir, file));
}

const badName = (file) => Object.assign(new Error(`not a flow file name: ${file}`), { code: 'BADNAME' });
