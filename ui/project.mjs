// The project sidebar: the flows in the folder the server was started with, and the calls that
// read and write them. Without a folder the server answers 404 and none of this shows; the page
// then works on one flow at a time with Save as a download, as it always did.
import { store, load, setFile, setDirty, emit, subscribe } from './store.mjs';
import { ask, prompt, notice, toast } from './dialog.mjs';

const el = document.getElementById('project');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export const project = { info: null };   // { name, dir, flows: [{ file, name, scenarios, passed, problems, mtime, broken? }], folders: [path] }

// Folders the user folded shut, remembered per project.
const foldKey = () => `playthrough.folded:${project.info?.dir ?? ''}`;
const folded = new Set();
const loadFolded = () => { folded.clear(); try { for (const f of JSON.parse(localStorage.getItem(foldKey()) ?? '[]')) folded.add(f); } catch {} };
const saveFolded = () => { try { localStorage.setItem(foldKey(), JSON.stringify([...folded])); } catch {} };
const folderOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const leaf = (path) => path.split('/').pop();

/** Handlers the app plugs in: how to fit the canvas, how to ask before dropping unsaved work. */
export const hooks = { fit() {}, replaceable: async () => true };

async function call(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, code: data.code, mtime: data.mtime });
  return data;
}

/** Is there a project? Fetches it and shows the sidebar when there is. */
export async function detect() {
  try { project.info = await call('GET', '/api/project'); } catch { project.info = null; return null; }
  document.body.classList.add('has-project');
  loadFolded();
  render();
  return project.info;
}

export async function refresh() {
  if (!project.info) return;
  try { project.info = await call('GET', '/api/project'); } catch {}
  render();
}

/** Open a flow from the folder, replacing what is on the page. */
export async function open(file, { quiet = false } = {}) {
  if (!await hooks.replaceable('open the other flow')) return false;
  try {
    const { doc, mtime } = await call('GET', `/api/flows/${encodeURIComponent(file)}`);
    setFile(file, mtime); load(doc); hooks.fit();
    if (!quiet) toast(`Opened ${file}`);
    return true;
  } catch (e) { notice(`Could not open ${file}`, e.message); return false; }
}

/**
 * Write the current flow to its file. A flow not in the folder yet asks for a name first. A file
 * that changed on disk since it was opened (someone else saved, or a pull came in) is not
 * overwritten without asking.
 */
export async function save() {
  if (!project.info) return false;
  if (!store.file) return saveAs();
  try {
    const { mtime } = await call('PUT', `/api/flows/${encodeURIComponent(store.file)}`, { doc: store.doc, ifMtime: store.mtime });
    return saved(store.file, mtime);
  } catch (e) {
    if (e.code !== 'CONFLICT') { notice(`Could not save ${store.file}`, e.message); return false; }
    const over = await ask({ title: `${store.file} changed on disk`, body: 'Someone else saved it, or a pull brought a newer version, since you opened it. Overwrite it with what is on this page? Cancel to keep the file; you can open it again from the list to see the other version.', ok: 'Overwrite', danger: true });
    if (!over) return false;
    try { const { mtime } = await call('PUT', `/api/flows/${encodeURIComponent(store.file)}`, { doc: store.doc }); return saved(store.file, mtime); }
    catch (e2) { notice(`Could not save ${store.file}`, e2.message); return false; }
  }
}

/** A new file in the folder for the flow on the page. */
export async function saveAs() {
  const name = await prompt({ title: 'Add this flow to the project', body: `Its file goes in ${project.info.dir}. The name is what the list shows.`, value: store.doc.name || '', placeholder: 'Flow name', ok: 'Add' });
  if (name == null) return false;
  try {
    const { file, mtime } = await call('POST', '/api/flows', { name, doc: store.doc });
    if (store.doc.name !== name) store.doc.name = name;
    return saved(file, mtime);
  } catch (e) {
    if (e.code === 'EXISTS') notice('That name is taken', `${e.message}. Pick another name, or open that flow and save over it.`);
    else notice('Could not add the flow', e.message);
    return false;
  }
}

function saved(file, mtime) {
  setFile(file, mtime); setDirty(false); emit();
  toast(`Saved ${file}`);
  refresh();
  return true;
}

/** Name the project; it is written to project.json in the folder. */
export async function renameProject(name) {
  if (!project.info) return;
  try { const r = await call('PUT', '/api/project', { name }); project.info.name = r.name; render(); }
  catch (e) { notice('Could not name the project', e.message); }
}

/** A fresh, empty flow, in `folder` (the root by default). */
export async function create(folder = '') {
  if (!await hooks.replaceable('start a new flow')) return;
  const name = await prompt({ title: 'New flow', body: `A new file in ${project.info.dir}${folder ? `/${folder}` : ''}. A / in the name puts the flow in a group, made if it is not there yet: billing/refund intake.`, placeholder: 'What the feature is called', ok: 'Create' });
  if (name == null) return;
  try {
    const { file, mtime } = await call('POST', '/api/flows', { name, doc: {}, folder });
    setFile(file, mtime); load({ name: name.split('/').pop().trim() }); hooks.fit();
    toast(`Created ${file}`);
    refresh();
  } catch (e) {
    if (e.code === 'EXISTS') notice('That name is taken', `${e.message}. Pick another name.`);
    else notice('Could not create the flow', e.message);
  }
}

/** Another file name for a flow, made from what is typed the way a new file's name is; slashes move it into folders. */
export async function rename(file) {
  const current = leaf(file).replace(/\.json$/, '');
  const name = await prompt({ title: `Rename ${file}`, body: 'The file name is made from this: lower-case, words joined by dashes, .json at the end. A / puts it in a group, billing/intake, made if it is not there yet. The flow keeps its own name.', value: current, ok: 'Rename' });
  if (name == null) return;
  return move(file, { name });
}

/** Put a flow's file elsewhere: under another name, in another folder, or both. */
async function move(file, { name = leaf(file).replace(/\.json$/, ''), folder = null } = {}) {
  try {
    const { file: to, mtime } = await call('POST', `/api/flows/${encodeURIComponent(file)}/rename`, { name, ...(folder != null && { folder }) });
    if (to === file) return;
    if (store.file === file) { setFile(to, mtime); emit(); }
    toast(folder != null ? `Moved to ${to}` : `Renamed to ${to}`);
    refresh();
  } catch (e) {
    if (e.code === 'EXISTS') notice('That name is taken', `${e.message}. Pick another.`);
    else notice(`Could not move ${file}`, e.message);
  }
}

/** A new group (a folder on disk), under `parent` (the root by default). */
export async function createFolder(parent = '') {
  const name = await prompt({ title: 'New group', body: `A folder in ${project.info.dir}${parent ? `/${parent}` : ''} to keep related flows together. Its name is made lower-case, words joined by dashes; a / nests groups.`, placeholder: 'Group name', ok: 'Create' });
  if (name == null) return;
  const slug = name.split('/').map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('/');
  if (!slug) return;
  const path = parent ? `${parent}/${slug}` : slug;
  try { await call('POST', '/api/folders', { path }); folded.delete(path); saveFolded(); toast(`Created ${path}/`); refresh(); }
  catch (e) { notice('Could not create the folder', e.message); }
}

/** Delete a group. One with flows or groups in it goes with all of them, after saying how many. */
export async function removeFolder(path) {
  const flows = project.info.flows.filter((f) => f.file.startsWith(`${path}/`)).length;
  const groups = (project.info.folders ?? []).filter((p) => p.startsWith(`${path}/`)).length;
  const inside = [flows && `${flows} flow${flows === 1 ? '' : 's'}`, groups && `${groups} group${groups === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
  const ok = await ask({ title: `Delete the group ${path}/?`, body: inside ? `It holds ${inside}; all of them are deleted with it. If the folder is in git, the history still has them.` : 'The empty folder is removed.', ok: inside ? 'Delete all' : 'Delete', danger: true });
  if (!ok) return;
  try {
    await call('DELETE', `/api/folders/${encodeURIComponent(path)}${inside ? '?all=1' : ''}`);
    if (store.file?.startsWith(`${path}/`)) { setFile(null, null); setDirty(store.doc.nodes.length > 0); emit(); }
    toast(`Deleted ${path}/`); refresh();
  } catch (e) { notice(`Could not delete ${path}/`, e.message); }
}

export async function remove(file) {
  const ok = await ask({ title: `Delete ${file}?`, body: 'The file is removed from the folder. If the folder is in git, the history still has it.', ok: 'Delete', danger: true });
  if (!ok) return;
  try {
    await call('DELETE', `/api/flows/${encodeURIComponent(file)}`);
    if (store.file === file) { setFile(null, null); setDirty(store.doc.nodes.length > 0); emit(); }
    toast(`Deleted ${file}`);
    refresh();
  } catch (e) { notice(`Could not delete ${file}`, e.message); }
}

// ---- render -----------------------------------------------------------------------------------

export function render() {
  const info = project.info;
  if (!info) return;
  const cur = store.file;
  const live = store.results;
  const row = (f, depth) => {
    const active = f.file === cur;
    const n = active ? store.doc.scenarios.length : f.scenarios;
    const p = active ? (live?.passed ?? 0) : f.passed;
    const problems = active ? store.problems.length : f.problems;
    const name = active ? (store.doc.name || f.name) : f.name;
    const status = f.broken ? `<span class="bad" title="${esc(f.broken)}">cannot be read</span>`
      : !n ? `<span class="muted">${problems ? `${problems} problem${problems === 1 ? '' : 's'}` : 'no scenarios'}</span>`
      : `<span class="${p === n ? 'ok' : 'bad'}">${p}/${n}</span>${problems ? ` <span class="bad" title="drawing problems">⚠</span>` : ''}`;
    return `<li class="flow ${active ? 'active' : ''}${f.broken ? ' broken' : ''}" style="--depth: ${depth}" data-file="${esc(f.file)}" title="${esc(f.file)}" draggable="true">
      <span class="name">${esc(name)}${active && store.dirty ? '<i class="dot" title="Changed since the last save"></i>' : ''}</span>
      <span class="status">${status}</span>
      <span class="tools"><button class="link rn" data-rn="${esc(f.file)}" title="Rename or move ${esc(f.file)}" aria-label="Rename">✎</button><button class="link rm" data-rm="${esc(f.file)}" title="Delete ${esc(f.file)}" aria-label="Delete">×</button></span>
    </li>`;
  };
  // The tree: every folder the server saw, plus any a flow's path implies; flows sit in theirs.
  const folders = new Set(info.folders ?? []);
  for (const f of info.flows) { let p = folderOf(f.file); while (p) { folders.add(p); p = folderOf(p); } }
  const kids = (parent) => [...folders].filter((p) => folderOf(p) === parent).sort();
  const flowsIn = (folder) => info.flows.filter((f) => folderOf(f.file) === folder);
  const countIn = (folder) => info.flows.filter((f) => f.file.startsWith(`${folder}/`)).length;
  const tree = (parent, depth) => kids(parent).map((path) => {
    const shut = folded.has(path), n = countIn(path);
    return `<li class="folder${shut ? ' shut' : ''}" style="--depth: ${depth}" data-folder="${esc(path)}" title="${esc(path)}/">
      <button class="caret" data-fold="${esc(path)}" title="${shut ? 'Expand' : 'Collapse'}" aria-label="${shut ? 'Expand' : 'Collapse'}">${shut ? '+' : '−'}</button>
      <span class="name">${esc(leaf(path))}</span>
      <span class="status"><span class="muted">${n || ''}</span></span>
      <span class="tools"><button class="link" data-newin="${esc(path)}" title="New flow in ${esc(path)}/" aria-label="New flow here">+</button><button class="link rm" data-rmdir="${esc(path)}" title="Delete the group ${esc(path)}/ (when empty)" aria-label="Delete group">×</button></span>
    </li>${shut ? '' : tree(path, depth + 1) + flowsIn(path).map((f) => row(f, depth + 1)).join('')}`;
  }).join('');
  const unfiled = !cur && (store.doc.nodes.length || store.doc.scenarios.length)
    ? `<li class="active unfiled" style="--depth: 0" title="Not in the folder yet: Save adds it"><span class="name">${esc(store.doc.name || 'Untitled flow')}<i class="dot"></i></span><span class="status muted">not in the folder</span></li>` : '';
  const empty = !info.flows.length && !folders.size && !unfiled;
  el.innerHTML = `
    <div class="head"><span class="pname" title="${esc(info.dir)}">${esc(info.name)}</span><span class="grow"></span><button class="small" id="newFolder" title="A new group (a folder in ${esc(info.dir)})">+ Group</button><button class="small primary" id="newFlow" title="A new flow file in ${esc(info.dir)}">+ Flow</button></div>
    <ul data-folder="">${unfiled}${tree('', 0)}${flowsIn('').map((f) => row(f, 0)).join('')}</ul>
    ${empty ? `<p class="muted empty">No flows in ${esc(info.dir)} yet. Draw one and Save, or press + Flow.</p>` : ''}
    <p class="muted foot" title="${esc(info.dir)}">${esc(info.dir.split('/').filter(Boolean).pop() ?? info.dir)}/ · ${info.flows.length} flow${info.flows.length === 1 ? '' : 's'}${folders.size ? ` · ${folders.size} group${folders.size === 1 ? '' : 's'}` : ''}</p>`;
}

el.addEventListener('click', async (ev) => {
  const fold = ev.target.closest('[data-fold]');
  if (fold) { const p = fold.dataset.fold; if (folded.has(p)) folded.delete(p); else folded.add(p); saveFolded(); return render(); }
  const rm = ev.target.closest('[data-rm]');
  if (rm) return remove(rm.dataset.rm);
  const rn = ev.target.closest('[data-rn]');
  if (rn) return rename(rn.dataset.rn);
  const rmdir = ev.target.closest('[data-rmdir]');
  if (rmdir) return removeFolder(rmdir.dataset.rmdir);
  const newin = ev.target.closest('[data-newin]');
  if (newin) return create(newin.dataset.newin);
  const newfolder = ev.target.closest('[data-newfolder]');
  if (newfolder) return createFolder(newfolder.dataset.newfolder);
  if (ev.target.closest('#newFlow')) return create();
  if (ev.target.closest('#newFolder')) return createFolder();
  const folderLi = ev.target.closest('li[data-folder]');
  if (folderLi) { const p = folderLi.dataset.folder; if (folded.has(p)) folded.delete(p); else folded.add(p); saveFolded(); return render(); }
  const li = ev.target.closest('li[data-file]');
  if (!li || li.classList.contains('broken')) return;
  if (li.dataset.file === store.file) return;
  open(li.dataset.file);
});

// A flow dragged onto a folder (or onto the list's empty space, for the root) moves there.
let dragging = null;
el.addEventListener('dragstart', (ev) => { const li = ev.target.closest('li[data-file]'); if (!li) return ev.preventDefault(); dragging = li.dataset.file; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', dragging); });
el.addEventListener('dragend', () => { dragging = null; for (const x of el.querySelectorAll('.over')) x.classList.remove('over'); });
const dropTarget = (ev) => ev.target.closest('li[data-folder]') ?? ev.target.closest('ul[data-folder]');
el.addEventListener('dragover', (ev) => {
  if (!dragging) return;
  const t = dropTarget(ev);
  if (!t) return;
  ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
  for (const x of el.querySelectorAll('.over')) if (x !== t) x.classList.remove('over');
  t.classList.add('over');
});
el.addEventListener('drop', (ev) => {
  const t = dropTarget(ev);
  if (!t || !dragging) return;
  ev.preventDefault();
  const to = t.dataset.folder, file = dragging;
  dragging = null;
  if (folderOf(file) !== to) move(file, { folder: to });
});

subscribe(render);
