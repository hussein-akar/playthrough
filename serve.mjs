// A static file server for the app, and, when started with a folder, the project API over it:
// `node serve.mjs ./specs` (or `npm start -- ./specs`, or PLAYTHROUGH_DIR=./specs). ES modules
// refuse to load over file://, so the static part is the smallest thing that lets `index.html`
// import `ui/*.mjs`. The API is four routes over the folder; everything else about a project
// (history, review, merging) is the job of git.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative } from 'node:path';
import { openProject, setProjectName, listFlows, listFolders, readFlow, writeFlow, deleteFlow, renameFlow, createFolder, renameFolder, deleteFolder, fileFor, under } from './lib/project.mjs';

const root = new URL('.', import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8095);
const dirArg = process.argv[2] ?? process.env.PLAYTHROUGH_DIR;
const project = dirArg ? await openProject(dirArg) : null;   // its name is updated in place when renamed
// The folder as the page names it: relative when it is inside the working directory, else in full.
const shownDir = project ? (() => { const r = relative(process.cwd(), project.dir); return r && !r.startsWith('..') ? r : project.dir; })() : null;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', (c) => { s += c; }).on('end', () => resolve(s)).on('error', reject); });

/**
 * GET /api/project · GET|PUT|DELETE /api/flows/:file · POST /api/flows (a new file for a name, in a
 * folder) · POST /api/flows/:file/rename (a name, and maybe a folder to move to) · POST /api/folders ·
 * POST /api/folders/:path/rename (a name) · DELETE /api/folders/:path (?all=1 takes everything in it). A path inside the project travels URL-encoded, slashes included.
 */
async function api(req, res, url) {
  if (!project) return send(res, 404, { error: 'no project folder: start the server with one, e.g. npm start -- ./specs' });
  const m = /^\/api\/(project|flows|folders)(?:\/([^/]+))?(?:\/(rename))?$/.exec(url.pathname);
  if (!m) return send(res, 404, { error: 'no such route' });
  const [, what, raw, verb] = m;
  const file = raw == null ? null : decodeURIComponent(raw);
  try {
    if (what === 'project' && req.method === 'PUT') { const { name } = JSON.parse(await readBody(req) || '{}'); const r = await setProjectName(project.dir, name); project.name = r.name; return send(res, 200, r); }
    if (what === 'project' && req.method === 'GET') return send(res, 200, { name: project.name, dir: shownDir, flows: await listFlows(project.dir), folders: await listFolders(project.dir) });
    if (what === 'folders' && !file && req.method === 'POST') { const { path } = JSON.parse(await readBody(req) || '{}'); return send(res, 201, await createFolder(project.dir, path)); }
    if (what === 'folders' && file && verb === 'rename' && req.method === 'POST') { const { name } = JSON.parse(await readBody(req) || '{}'); return send(res, 200, await renameFolder(project.dir, file, name)); }
    if (what === 'folders' && file && !verb && req.method === 'DELETE') return send(res, 200, await deleteFolder(project.dir, file, { all: url.searchParams.get('all') === '1' }));
    if (what === 'folders') return send(res, 405, { error: `${req.method} is not something ${url.pathname} does` });
    if (what === 'flows' && !file && req.method === 'POST') {
      const { name, doc, folder } = JSON.parse(await readBody(req) || '{}');
      const f = String(name ?? '').includes('/') ? fileFor(name) : under(folder ?? '', fileFor(name));
      const shown = String(name ?? '').split('/').pop().trim();
      const mtime = await writeFlow(project.dir, f, { ...(doc ?? {}), name: shown || doc?.name || '' }, { mustBeNew: true });
      return send(res, 201, { file: f, mtime });
    }
    if (what === 'flows' && file && verb === 'rename' && req.method === 'POST') {
      const { name, folder } = JSON.parse(await readBody(req) || '{}');
      return send(res, 200, await renameFlow(project.dir, file, name, folder ?? null));
    }
    if (verb) return send(res, 404, { error: 'no such route' });
    if (what === 'flows' && file && req.method === 'GET') return send(res, 200, await readFlow(project.dir, file));
    if (what === 'flows' && file && req.method === 'PUT') {
      const { doc, ifMtime } = JSON.parse(await readBody(req) || '{}');
      const mtime = await writeFlow(project.dir, file, doc ?? {}, { ifMtime: ifMtime ?? null });
      return send(res, 200, { file, mtime });
    }
    if (what === 'flows' && file && req.method === 'DELETE') { await deleteFlow(project.dir, file); return send(res, 200, { file }); }
    return send(res, 405, { error: `${req.method} is not something ${url.pathname} does` });
  } catch (e) {
    const status = { CONFLICT: 409, EXISTS: 409, NOTEMPTY: 409, BADNAME: 400, ENOENT: 404 }[e.code] ?? 500;
    return send(res, status, { error: e.message, code: e.code ?? null, mtime: e.mtime ?? null });
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  let path = normalize(decodeURIComponent(url.pathname));
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`playthrough · port ${port} is already in use; stop what is on it, or pick another: PORT=${port + 1} npm start`);
  process.exit(1);
}).listen(port, () => console.log(`playthrough · http://localhost:${port}/${project ? `  · project "${project.name}" in ${project.dir}` : '  · no project folder (npm start -- ./specs to open one)'}`));
