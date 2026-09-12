import { store, subscribe, commit, load, restore, restoreDirty, restoreFile, setDirty, setFile, undo, redo, select, selectNodes, emit } from './store.mjs';
import { toMarkdown } from '../lib/markdown.mjs';
import { ask, notice, toast, dialogOpen } from './dialog.mjs';
import * as canvas from './canvas.mjs';
import * as inspector from './inspector.mjs';
import * as table from './table.mjs';
import * as project from './project.mjs';

const $ = (id) => document.getElementById(id);

subscribe(() => {
  // The panel is for what is selected; with nothing selected the drawing has the width.
  document.body.classList.toggle('panel-hidden', !store.selection);
  canvas.render();
  inspector.render();
  table.render();
  renderHeader();
  renderLint();
});

function renderHeader() {
  const { doc, results } = store;
  if (document.activeElement !== $('docName')) $('docName').value = doc.name;
  const n = doc.scenarios.length;
  const p = results?.passed ?? 0;
  const problems = store.problems.length;
  $('summary').innerHTML = n
    ? `${n} scenario${n === 1 ? '' : 's'} · <b class="ok">${p} pass</b>${n - p ? ` · <b class="bad">${n - p} fail</b>` : ''}${problems ? ` · <b class="bad">${problems} drawing problem${problems === 1 ? '' : 's'}</b>` : ''}`
    : `${doc.nodes.length} node${doc.nodes.length === 1 ? '' : 's'}${problems ? ` · <b class="bad">${problems} drawing problem${problems === 1 ? '' : 's'}</b>` : ''}`;
  $('undo').disabled = !store.undo.length;
  $('redo').disabled = !store.redo.length;
  $('saveDoc').classList.toggle('dirty', store.dirty);
  $('saveDoc').title = store.dirty ? 'Changed since the last save' : '';
  document.title = `${store.dirty ? '• ' : ''}${doc.name || 'Untitled flow'} – Playthrough`;
  $('coverage').classList.toggle('on', store.showCoverage);
  if (store.showCoverage && results) {
    const u = results.coverage.untouchedNodes.length + results.coverage.untouchedEdges.length;
    $('coverage').textContent = u ? `Coverage · ${u} untouched` : 'Coverage · all touched';
  } else $('coverage').textContent = 'Coverage';
}

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
/** New/Example throw the current drawing away; when it is not in a file yet, ask first. */
async function replaceable(what) {
  if (!store.dirty || !store.doc.nodes.length) return true;
  return ask({ title: `${what} and drop the unsaved changes?`, body: `"${store.doc.name || 'Untitled flow'}" has changes that are not in a file. Save first if you want to keep them.`, ok: what, danger: true });
}
project.hooks.fit = canvas.fit;
project.hooks.replaceable = replaceable;
// New, Open… and Example put an unfiled flow on the page; in a project, Save then adds it to the folder.
$('newDoc').addEventListener('click', async () => { if (await replaceable('Start a new flow')) { setFile(null); load({ name: 'Untitled flow' }); canvas.fit(); } });
$('loadExample').addEventListener('click', async () => {
  if (!await replaceable('Load the example')) return;
  const doc = await (await fetch('examples/order.json')).json();
  setFile(null); load(doc); canvas.fit();
});
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
$('openDoc').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (ev) => { const f = ev.target.files[0]; if (f) await openFile(f); ev.target.value = ''; });
async function openFile(file) {
  if (!await replaceable(`Open ${file.name}`)) return;
  try { const doc = JSON.parse(await file.text()); setFile(null); load(doc); canvas.fit(); toast(`Opened ${file.name}`); }
  catch (e) { notice('Could not read that file', `${file.name}: ${e.message}`); }
}
$('projectToggle').addEventListener('click', () => {
  const hidden = document.body.classList.toggle('side-hidden');
  try { localStorage.setItem('playthrough.sideHidden', hidden ? '1' : ''); } catch {}
  $('projectToggle').classList.toggle('on', !hidden);
  canvas.render();
});
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('coverage').addEventListener('click', () => { store.showCoverage = !store.showCoverage; emit(); });
$('addScenario').addEventListener('click', table.addScenario);
$('help').addEventListener('click', () => $('helpDialog').showModal());
window.addEventListener('beforeunload', (ev) => { if (store.dirty) { ev.preventDefault(); ev.returnValue = ''; } });

// ---- share ------------------------------------------------------------------------------------

const closeShare = () => { $('share').open = false; };
document.addEventListener('click', (ev) => { if (!$('share').contains(ev.target)) closeShare(); });
$('copyMarkdown').addEventListener('click', () => { closeShare(); copy(toMarkdown(store.doc, store.results), 'Markdown'); });
$('downloadDoc').addEventListener('click', () => { closeShare(); download(); });
$('copyLink').addEventListener('click', async () => {
  closeShare();
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

// ---- boot -------------------------------------------------------------------------------------

/** A `#d=…` link in the address bar: read it, drop it, and open it unless that would lose work. */
async function openLink() {
  const m = /^#d=([\w-]+)$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  let doc;
  try { doc = await decodeDoc(m[1]); } catch { toast('That link does not hold a flow'); return false; }
  const name = doc.name || 'Untitled flow';
  if (!await replaceable(`Open "${name}" from the link`)) return true;
  setFile(null); load(doc); canvas.fit(); toast(`Opened "${name}" from the link`);
  return true;
}
window.addEventListener('hashchange', openLink);

{
  const saved = restore(), wasDirty = restoreDirty(), last = restoreFile();   // read the flags before load() resets them
  const info = await project.detect();
  if (info) {
    try { if (localStorage.getItem('playthrough.sideHidden') === '1') document.body.classList.add('side-hidden'); } catch {}
    $('projectToggle').hidden = false;
    $('projectToggle').classList.toggle('on', !document.body.classList.contains('side-hidden'));
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
  if (!await openLink() && empty && !info) $('loadExample').click();
}
