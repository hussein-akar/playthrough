import { store, subscribe, commit, load, restore, undo, redo, select, emit } from './store.mjs';
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

// ---- header -----------------------------------------------------------------------------------

$('docName').addEventListener('input', (ev) => commit((d) => { d.name = ev.target.value; }));
$('newDoc').addEventListener('click', () => { if (!store.doc.nodes.length || confirm('Start a new, empty flow? The current one stays in this browser\'s undo until you reload.')) { load({ name: 'Untitled flow' }); canvas.fit(); } });
$('loadExample').addEventListener('click', async () => {
  const doc = await (await fetch('examples/order.json')).json();
  load(doc); canvas.fit();
});
$('saveDoc').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.doc, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${(store.doc.name || 'flow').replace(/[^\w.-]+/g, '-').toLowerCase()}.playthrough.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('openDoc').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  try { load(JSON.parse(await f.text())); canvas.fit(); } catch (e) { alert(`Could not read that file: ${e.message}`); }
  ev.target.value = '';
});
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('coverage').addEventListener('click', () => { store.showCoverage = !store.showCoverage; emit(); });
$('addScenario').addEventListener('click', table.addScenario);
for (const b of document.querySelectorAll('#palette [data-add]')) b.addEventListener('click', () => canvas.addNode(b.dataset.add));

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
});

// ---- boot -------------------------------------------------------------------------------------

const saved = restore();
if (saved) { load(saved); canvas.fit(); }
else $('loadExample').click();
