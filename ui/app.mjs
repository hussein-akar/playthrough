import { store, subscribe, commit, load, restore, restoreDirty, setDirty, undo, redo, select, emit } from './store.mjs';
import { toMarkdown } from '../lib/markdown.mjs';
import * as canvas from './canvas.mjs';
import * as inspector from './inspector.mjs';
import * as table from './table.mjs';

const $ = (id) => document.getElementById(id);

subscribe(() => {
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

// ---- small in-page dialogs ------------------------------------------------------------------------
// No native confirm()/alert(): a <dialog> for questions and errors, a toast for "it worked".

/** A yes/no question. Resolves true on OK. */
function ask({ title, body = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
  const dlg = $('modal');
  $('modalTitle').textContent = title;
  $('modalBody').textContent = body;
  $('modalOk').textContent = ok; $('modalOk').classList.toggle('danger', danger);
  $('modalCancel').textContent = cancel; $('modalCancel').hidden = cancel == null;
  dlg.returnValue = '';
  return new Promise((resolve) => { dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }); dlg.showModal(); $('modalOk').focus(); });
}
/** Something to read, with one button. `text`, if given, is shown in a textarea to copy from. */
function notice(title, body = '', text = null) {
  const p = ask({ title, body, ok: 'Close', cancel: null });
  if (text != null) { const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true }); $('modalBody').append(ta); ta.select(); }
  return p;
}
function toast(message, ms = 2200) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: message });
  $('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}
const dialogOpen = () => Boolean(document.querySelector('dialog[open]'));

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
$('newDoc').addEventListener('click', async () => { if (await replaceable('Start a new flow')) { load({ name: 'Untitled flow' }); canvas.fit(); } });
$('loadExample').addEventListener('click', async () => {
  if (!await replaceable('Load the example')) return;
  const doc = await (await fetch('examples/order.json')).json();
  load(doc); canvas.fit();
});
$('saveDoc').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.doc, null, 2)], { type: 'application/json' });
  const name = `${(store.doc.name || 'flow').replace(/[^\w.-]+/g, '-').toLowerCase()}.playthrough.json`;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setDirty(false); emit();
  toast(`Saved ${name}`);
});
$('openDoc').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (ev) => { const f = ev.target.files[0]; if (f) await openFile(f); ev.target.value = ''; });
async function openFile(file) {
  if (!await replaceable(`Open ${file.name}`)) return;
  try { load(JSON.parse(await file.text())); canvas.fit(); toast(`Opened ${file.name}`); }
  catch (e) { notice('Could not read that file', `${file.name}: ${e.message}`); }
}
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('coverage').addEventListener('click', () => { store.showCoverage = !store.showCoverage; emit(); });
$('addScenario').addEventListener('click', table.addScenario);
for (const b of document.querySelectorAll('#palette [data-add]')) b.addEventListener('click', () => canvas.addNode(b.dataset.add));
$('help').addEventListener('click', () => $('helpDialog').showModal());
window.addEventListener('beforeunload', (ev) => { if (store.dirty) { ev.preventDefault(); ev.returnValue = ''; } });

// ---- share ------------------------------------------------------------------------------------

const closeShare = () => { $('share').open = false; };
document.addEventListener('click', (ev) => { if (!$('share').contains(ev.target)) closeShare(); });
$('copyMarkdown').addEventListener('click', () => { closeShare(); copy(toMarkdown(store.doc, store.results), 'Markdown'); });
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
  if (typing) return;
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && store.selection) {
    ev.preventDefault();
    const sel = store.selection;
    commit((d) => {
      if (sel.type === 'node') { d.nodes = d.nodes.filter((n) => n.id !== sel.id); d.edges = d.edges.filter((e) => e.from !== sel.id && e.to !== sel.id); }
      if (sel.type === 'edge') d.edges = d.edges.filter((e) => e.id !== sel.id);
      if (sel.type === 'scenario') d.scenarios = d.scenarios.filter((s) => s.id !== sel.id);
    });
    select(null);
  }
  if (ev.key === 'Escape') select(null);
  if (ev.key === ' ' && store.selection?.type === 'scenario') { ev.preventDefault(); play(); }
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
  load(doc); canvas.fit(); toast(`Opened "${name}" from the link`);
  return true;
}
window.addEventListener('hashchange', openLink);

{
  const saved = restore(), wasDirty = restoreDirty();   // read the flag before load() resets it
  if (saved) { load(saved); canvas.fit(); if (wasDirty) { setDirty(true); emit(); } }
  if (!await openLink() && !saved) $('loadExample').click();
}
