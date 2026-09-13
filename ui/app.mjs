import { store, subscribe, commit, load, restore, restoreDirty, restoreFile, setDirty, setFile, undo, redo, select, selectNodes, panelOpen, emit } from './store.mjs';
import { toMarkdown } from '../lib/markdown.mjs';
import { ask, notice, toast, promptText, dialogOpen } from './dialog.mjs';
import * as canvas from './canvas.mjs';
import * as inspector from './inspector.mjs';
import * as table from './table.mjs';
import * as project from './project.mjs';
import * as presets from './presets.mjs';
import * as generate from './generate.mjs';

const $ = (id) => document.getElementById(id);

subscribe(() => {
  // The panel is for what is selected; with nothing selected the drawing has the width.
  document.body.classList.toggle('panel-hidden', !panelOpen());
  canvas.render();
  inspector.render();
  table.render();
  renderHeader();
  renderLint();
});

function renderHeader() {
  const { doc, results } = store;
  // In a project the header names the project; the flow's own name lives in its panel and the sidebar.
  const info = project.project.info;
  $('docName').hidden = !!info; $('projectName').hidden = !info;
  if (document.activeElement !== $('docName')) $('docName').value = doc.name;
  if (info && document.activeElement !== $('projectName')) $('projectName').value = info.name;
  // How the flow stands, a pill each: whether the scenarios pass, and whether the drawing has problems (a click goes to the first).
  const n = doc.scenarios.length;
  const p = results?.passed ?? 0;
  const problems = store.problems.length;
  const verdict = !n ? '<span class="pill">no scenarios</span>' : p === n ? `<span class="pill ok">${n === 1 ? 'the scenario passes' : `all ${n} pass`}</span>` : `<span class="pill bad">${n - p} of ${n} fail</span>`;
  const drawing = problems ? `<button class="pill bad" data-problem title="Go to the first one">${problems} drawing problem${problems === 1 ? '' : 's'}</button>` : '';
  if ($('summary').written !== verdict + drawing) { $('summary').innerHTML = verdict + drawing; $('summary').written = verdict + drawing; }
  $('stateChip').hidden = !store.dirty;
  $('undo').disabled = !store.undo.length;
  $('redo').disabled = !store.redo.length;
  document.title = `${store.dirty ? '• ' : ''}${doc.name || 'Untitled flow'}${info ? ` · ${info.name}` : ''} – Playthrough`;
}
$('summary').addEventListener('click', (ev) => {
  if (!ev.target.closest('[data-problem]')) return;
  const p = store.problems[0];
  if (p?.node) select({ type: 'node', id: p.node });
  else if (p?.edge) select({ type: 'edge', id: p.edge });
});

function renderLint() {
  const box = $('lint');
  const ps = store.problems;
  box.classList.toggle('show', ps.length > 0);
  box.innerHTML = ps.slice(0, 8).map((p, i) => `<div data-p="${i}">⚠ ${p.message.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('') + (ps.length > 8 ? `<div class="muted">… and ${ps.length - 8} more</div>` : '');
}
$('lint').addEventListener('click', (ev) => {
  const d = ev.target.closest('[data-p]');
  if (!d) return;
  const p = store.problems[Number(d.dataset.p)];
  if (p?.node) select({ type: 'node', id: p.node });
  else if (p?.edge) select({ type: 'edge', id: p.edge });
});

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); }
  catch { notice(`Could not reach the clipboard`, `Copy the ${what} from here instead.`, text); }
}

// ---- header -----------------------------------------------------------------------------------

$('docName').addEventListener('input', (ev) => commit((d) => { d.name = ev.target.value; }));
$('projectName').addEventListener('change', (ev) => project.renameProject(ev.target.value));
$('projectName').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.target.blur(); });
/** Before something replaces what is on the page: fine unless it has unsaved changes, then a short question. `what` is a verb phrase, "Open another flow". */
async function replaceable(what) {
  if (!store.dirty || !store.doc.nodes.length) return true;
  const name = store.doc.name || 'Untitled flow';
  return ask({ title: 'Drop the unsaved changes?', body: `"${name.length > 40 ? `${name.slice(0, 38)}…` : name}" has changes that are not in a file. ${what[0].toUpperCase() + what.slice(1)} anyway, or cancel and save first.`, ok: 'Drop changes', danger: true });
}
project.hooks.fit = canvas.fit;
project.hooks.replaceable = replaceable;
// Import (pasted or a file) and a preset's flow put an unfiled flow on the page; in a project, Save then adds it to the folder.
/** In a project, Save writes the file in place; otherwise it downloads the flow. */
function save() {
  if (project.project.info) return project.save();
  download();
  setDirty(false); emit();
}
function download() {
  const blob = new Blob([JSON.stringify(store.doc, null, 2)], { type: 'application/json' });
  const name = store.file ?? `${(store.doc.name || 'flow').replace(/[^\w.-]+/g, '-').toLowerCase()}.playthrough.json`;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Downloaded ${name}`);
}
$('saveDoc').addEventListener('click', save);
$('openDoc').addEventListener('click', () => { closeMenus(); $('fileInput').click(); });
$('fileInput').addEventListener('change', async (ev) => { const f = ev.target.files[0]; if (f) await openFile(f); ev.target.value = ''; });
async function openFile(file) {
  if (!await replaceable('open the file')) return;
  try { const doc = JSON.parse(await file.text()); setFile(null); load(doc); canvas.fit(); toast(`Opened ${file.name}`); }
  catch (e) { notice('Could not read that file', `${file.name}: ${e.message}`); }
}
/** Hide or show the project's flows; the arrow at the top left of the drawing points the way a click takes them. */
function sideHidden(hidden) {
  document.body.classList.toggle('side-hidden', hidden);
  const label = hidden ? 'Show the flows' : 'Hide the flows';
  $('sideToggle').title = label; $('sideToggle').setAttribute('aria-label', label);
}
$('sideToggle').addEventListener('click', (ev) => {
  const hidden = !document.body.classList.contains('side-hidden');
  ev.currentTarget.blur();
  sideHidden(hidden);
  try { localStorage.setItem('playthrough.sideHidden', hidden ? '1' : ''); } catch {}
  canvas.render();
});
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('addScenario').addEventListener('click', table.addScenario);
$('generateScenarios').addEventListener('click', generate.show);
$('help').addEventListener('click', () => $('helpDialog').showModal());
window.addEventListener('beforeunload', (ev) => { if (store.dirty) { ev.preventDefault(); ev.returnValue = ''; } });

// ---- template: presets, import, export, and the ways out under it ---------------------------------

/** The header's drop-down menus close when something outside them is clicked, or when an item is picked. */
const closeMenus = () => { for (const m of document.querySelectorAll('header details.menu')) { m.open = false; m.querySelectorAll('.sub.open').forEach((s) => s.classList.remove('open')); } };
// A submenu opens on hover; a click (or a tap, where there is no hover) holds it open.
for (const b of document.querySelectorAll('header .menu .subhead')) b.addEventListener('click', () => b.parentElement.classList.toggle('open'));
document.addEventListener('click', (ev) => { if (!ev.target.closest('header details.menu')) closeMenus(); });
$('openPresets').addEventListener('click', () => { closeMenus(); presets.show(); });
$('importDoc').addEventListener('click', async () => {
  closeMenus();
  if (!await replaceable('import a flow')) return;
  const text = await promptText({ title: 'Import a flow', body: 'Paste the JSON of a flow, as Copy as JSON or Download as JSON gives it. It replaces what is on the page; in a project, Save then adds it to the folder.', placeholder: '{ "name": "…", "nodes": [ … ], "edges": [ … ] }', ok: 'Import' });
  if (text == null) return;
  try {
    const doc = JSON.parse(text);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('a flow is an object with nodes, edges and scenarios');
    setFile(null); load(doc); canvas.fit(); toast(`Imported "${store.doc.name || 'Untitled flow'}"`);
  } catch (e) { notice('Could not read that as a flow', e.message); }
});
$('exportDoc').addEventListener('click', () => { closeMenus(); copy(JSON.stringify(store.doc, null, 2), 'JSON'); });

$('copyMarkdown').addEventListener('click', () => { closeMenus(); copy(toMarkdown(store.doc, store.results), 'Markdown'); });
$('downloadDoc').addEventListener('click', () => { closeMenus(); download(); });
$('copyLink').addEventListener('click', async () => {
  closeMenus();
  const url = `${location.origin}${location.pathname}#d=${await encodeDoc(store.doc)}`;
  if (url.length > 30000) return toast('This flow is too big to fit in a link; use Save instead');
  copy(url, 'link');
});
// The whole document rides in the hash: JSON → deflate → base64url. Nothing leaves the browser.
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function encodeDoc(doc) {
  const stream = new Blob([JSON.stringify(doc)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return b64u(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function decodeDoc(s) {
  const stream = new Blob([unb64u(s)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

// ---- drop a file anywhere ---------------------------------------------------------------------

{
  let depth = 0;
  const hasFile = (ev) => [...(ev.dataTransfer?.types ?? [])].includes('Files');
  document.addEventListener('dragenter', (ev) => { if (!hasFile(ev)) return; ev.preventDefault(); depth++; $('drop').classList.add('show'); });
  document.addEventListener('dragover', (ev) => { if (hasFile(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('dragleave', (ev) => { if (!hasFile(ev)) return; if (--depth <= 0) { depth = 0; $('drop').classList.remove('show'); } });
  document.addEventListener('drop', (ev) => {
    if (!hasFile(ev)) return;
    ev.preventDefault(); depth = 0; $('drop').classList.remove('show');
    const f = ev.dataTransfer.files[0];
    if (f) openFile(f);
  });
}

// ---- play -------------------------------------------------------------------------------------

let timer = null;
function play() {
  const r = store.results?.results.find((x) => x.scenario.id === store.selection?.id);
  if (!r) return;
  clearInterval(timer);
  store.playhead = 0;
  emit();
  timer = setInterval(() => {
    store.playhead += 1;
    if (store.playhead > r.result.steps.length) { clearInterval(timer); timer = null; store.playhead = null; }
    emit();
  }, 380);
}
document.addEventListener('play', play);
// Done in the config drawer saves the flow to its file; without a project folder there is no file, and Save would download one, so Done only closes.
document.addEventListener('flow-save', () => { if (project.project.info) save(); });

// ---- keyboard ---------------------------------------------------------------------------------

document.addEventListener('keydown', (ev) => {
  if (dialogOpen()) return;                       // Esc closes it; everything else is the dialog's
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
  if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); return; }
  if (typing) return;
  if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); selectNodes(store.doc.nodes.map((n) => n.id)); return; }
  // Copy, cut, paste and duplicate work on the selected nodes; with nothing selected the browser keeps them.
  if (mod && ev.key.toLowerCase() === 'c') { if (canvas.copySelection()) ev.preventDefault(); return; }
  if (mod && ev.key.toLowerCase() === 'x') { if (store.selection?.type === 'node') { ev.preventDefault(); canvas.cutSelection(); } return; }
  if (mod && ev.key.toLowerCase() === 'v') { if (canvas.hasClipboard()) { ev.preventDefault(); canvas.paste(); } return; }
  if (mod && ev.key.toLowerCase() === 'd') { if (store.selection?.type === 'node') { ev.preventDefault(); canvas.duplicateSelection(); } return; }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && store.selection) {
    ev.preventDefault();
    const sel = store.selection;
    if (sel.type === 'node') return canvas.deleteSelectedNodes();
    commit((d) => {
      if (sel.type === 'edge') d.edges = d.edges.filter((e) => e.id !== sel.id);
      if (sel.type === 'scenario') d.scenarios = d.scenarios.filter((s) => s.id !== sel.id);
    });
    select(null);
  }
  if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && store.selection?.type === 'scenario') { ev.preventDefault(); table.step(ev.key === 'ArrowUp' ? -1 : 1); return; }
  if (ev.key === 'Escape') select(null);
  if (ev.key === 'f') canvas.fit();
  if (ev.key === '?') { ev.preventDefault(); $('helpDialog').showModal(); }
});

// ---- side panel width ---------------------------------------------------------------------------

{
  const key = 'playthrough.panelWidth', bar = $('panelResizer');
  const apply = (w) => { w = Math.max(300, Math.min(w, window.innerWidth - 480)); document.body.style.setProperty('--panel-w', `${w}px`); bar.style.right = `${w - 3}px`; return w; };
  let width = apply(Number(localStorage.getItem(key)) || 400);
  bar.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    bar.setPointerCapture(ev.pointerId); bar.classList.add('on');
    const startX = ev.clientX, startW = width;
    const move = (e) => { width = apply(startW + startX - e.clientX); canvas.render(); };
    const up = () => { bar.classList.remove('on'); bar.removeEventListener('pointermove', move); localStorage.setItem(key, String(width)); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
  });
  window.addEventListener('resize', () => { width = apply(width); });
}

// ---- table height ---------------------------------------------------------------------------------

{
  const key = 'playthrough.tableHeight', bar = $('tableResizer');
  const apply = (h) => { h = Math.max(120, Math.min(h, window.innerHeight - 220)); document.body.style.setProperty('--table-h', `${h}px`); return h; };
  let height = apply(Number(localStorage.getItem(key)) || 280);
  bar.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    bar.setPointerCapture(ev.pointerId); bar.classList.add('on');
    const startY = ev.clientY, startH = height;
    const move = (e) => { height = apply(startH + startY - e.clientY); canvas.render(); };
    const up = () => { bar.classList.remove('on'); bar.removeEventListener('pointermove', move); localStorage.setItem(key, String(height)); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
  });
  window.addEventListener('resize', () => { height = apply(height); });
}

// ---- config drawer height ----------------------------------------------------------------------------
// The same grip as the table's, on the drawer's top edge: the drawer is anchored to the bottom, so it grows upward.

{
  const key = 'playthrough.drawerHeight', bar = $('drawerResizer'), drawer = $('settings');
  const apply = (h) => { h = Math.max(200, Math.min(h, window.innerHeight - 48)); drawer.style.setProperty('--drawer-h', `${h}px`); return h; };
  let height = Number(localStorage.getItem(key)) || 0;
  if (height) height = apply(height);
  bar.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    bar.setPointerCapture(ev.pointerId); bar.classList.add('on');
    const startY = ev.clientY, startH = drawer.getBoundingClientRect().height;
    const move = (e) => { height = apply(startH + startY - e.clientY); };
    const up = () => { bar.classList.remove('on'); bar.removeEventListener('pointermove', move); localStorage.setItem(key, String(height)); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
  });
  window.addEventListener('resize', () => { if (height) height = apply(height); });
}

// ---- boot -------------------------------------------------------------------------------------

/** A `#d=…` link in the address bar: read it, drop it, and open it unless that would lose work. */
async function openLink() {
  const m = /^#d=([\w-]+)$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  let doc;
  try { doc = await decodeDoc(m[1]); } catch { toast('That link does not hold a flow'); return false; }
  const name = doc.name || 'Untitled flow';
  if (!await replaceable('open the flow from the link')) return true;
  setFile(null); load(doc); canvas.fit(); toast(`Opened "${name}" from the link`);
  return true;
}
window.addEventListener('hashchange', openLink);

{
  const saved = restore(), wasDirty = restoreDirty(), last = restoreFile();   // read the flags before load() resets them
  const info = await project.detect();
  if (info) {
    try { sideHidden(localStorage.getItem('playthrough.sideHidden') === '1'); } catch {}
    $('saveDoc').title = 'Write the flow to its file (⌘S)';
  }
  const known = last && info?.flows.some((f) => f.file === last.file) ? last : null;
  if (saved && (wasDirty || !info)) {
    // Unsaved work, or no project at all: the autosaved copy is the newest thing there is.
    load(saved); canvas.fit();
    if (known) setFile(known.file, known.mtime);
    if (wasDirty) { setDirty(true); emit(); }
  } else if (info) {
    // Clean, in a project: read the last flow (or the first) fresh, so a pull since the last visit shows up.
    const file = known?.file ?? info.flows[0]?.file;
    if (file) await project.open(file, { quiet: true });
  }
  const empty = !store.doc.nodes.length && !store.doc.scenarios.length;
  if (!await openLink() && empty && !info) await presets.openDefault();   // first visit: the simple shop's checkout
}
