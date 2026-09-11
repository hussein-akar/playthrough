// The project sidebar: the flows in the folder the server was started with, and the calls that
// read and write them. Without a folder the server answers 404 and none of this shows; the page
// then works on one flow at a time with Save as a download, as it always did.
import { store, load, setFile, setDirty, emit, subscribe } from './store.mjs';
import { ask, prompt, notice, toast } from './dialog.mjs';

const el = document.getElementById('project');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export const project = { info: null };   // { name, dir, flows: [{ file, name, scenarios, passed, problems, mtime, broken? }] }

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
  if (!await hooks.replaceable(`Open ${file}`)) return false;
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

/** A fresh, empty flow in the folder. */
export async function create() {
  if (!await hooks.replaceable('Start a new flow')) return;
  const name = await prompt({ title: 'New flow', body: `A new file in ${project.info.dir}.`, placeholder: 'What the feature is called', ok: 'Create' });
  if (name == null) return;
  try {
    const { file, mtime } = await call('POST', '/api/flows', { name, doc: {} });
    setFile(file, mtime); load({ name }); hooks.fit();
    toast(`Created ${file}`);
    refresh();
  } catch (e) {
    if (e.code === 'EXISTS') notice('That name is taken', `${e.message}. Pick another name.`);
    else notice('Could not create the flow', e.message);
  }
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
  const row = (f) => {
    const active = f.file === cur;
    const n = active ? store.doc.scenarios.length : f.scenarios;
    const p = active ? (live?.passed ?? 0) : f.passed;
    const problems = active ? store.problems.length : f.problems;
    const name = active ? (store.doc.name || f.name) : f.name;
    const status = f.broken ? `<span class="bad" title="${esc(f.broken)}">cannot be read</span>`
      : !n ? `<span class="muted">${problems ? `${problems} problem${problems === 1 ? '' : 's'}` : 'no scenarios'}</span>`
      : `<span class="${p === n ? 'ok' : 'bad'}">${p}/${n}</span>${problems ? ` <span class="bad" title="drawing problems">⚠</span>` : ''}`;
    return `<li class="${active ? 'active' : ''}${f.broken ? ' broken' : ''}" data-file="${esc(f.file)}" title="${esc(f.file)}">
      <span class="name">${esc(name)}${active && store.dirty ? '<i class="dot" title="Changed since the last save"></i>' : ''}</span>
      <span class="status">${status}</span>
      <button class="link rm" data-rm="${esc(f.file)}" title="Delete ${esc(f.file)}" aria-label="Delete">×</button>
    </li>`;
  };
  const unfiled = !cur && (store.doc.nodes.length || store.doc.scenarios.length)
    ? `<li class="active unfiled" title="Not in the folder yet: Save adds it"><span class="name">${esc(store.doc.name || 'Untitled flow')}<i class="dot"></i></span><span class="status muted">not in the folder</span></li>` : '';
  el.innerHTML = `
    <div class="head"><span class="pname" title="${esc(info.dir)}">${esc(info.name)}</span><button class="small primary" id="newFlow" title="A new flow file in ${esc(info.dir)}">+ Flow</button></div>
    <ul>${unfiled}${info.flows.map(row).join('')}</ul>
    ${!info.flows.length && !unfiled ? `<p class="muted empty">No flows in ${esc(info.dir)} yet. Draw one and Save, or press + Flow.</p>` : ''}
    <p class="muted foot" title="${esc(info.dir)}">${esc(info.dir.split('/').filter(Boolean).pop() ?? info.dir)}/ · ${info.flows.length} flow${info.flows.length === 1 ? '' : 's'}</p>`;
}

el.addEventListener('click', async (ev) => {
  const rm = ev.target.closest('[data-rm]');
  if (rm) return remove(rm.dataset.rm);
  if (ev.target.closest('#newFlow')) return create();
  const li = ev.target.closest('li[data-file]');
  if (!li || li.classList.contains('broken')) return;
  if (li.dataset.file === store.file) return;
  open(li.dataset.file);
});

subscribe(render);
