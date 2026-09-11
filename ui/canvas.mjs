// The drawing. Nodes are boxes, edges are wires with the guard written on a pill; the selected
// scenario's path is painted over it in the accent colour, step by step, and whatever no scenario
// ever reaches can be dimmed. Everything is re-rendered from the document on every change: the
// drawings this is for are dozens of nodes, not thousands.
import { store, commit, mark, select, uid, activeRun, emit } from './store.mjs';

const svg = document.getElementById('canvas');
const zoomPct = document.getElementById('zoomPct');
const NS = 'http://www.w3.org/2000/svg';
const GRID = 20;
const ZOOM = { min: 0.25, max: 2.5 };

// ---- geometry ---------------------------------------------------------------------------------

export function wrap(text, max = 24) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > max) { lines.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['(untitled)'];
}

export function geom(node) {
  const lines = wrap(node.label);
  const sets = Object.entries(node.set ?? {}).filter(([, v]) => v != null && String(v).trim() !== '');
  const longest = Math.max(...lines.map((l) => l.length), ...sets.map(([k, v]) => `${k} = ${v}`.length * 1.05));
  const w = Math.max(130, Math.min(280, longest * 7.1 + 40));
  const h = 32 + lines.length * 16 + sets.length * 13 + 6;
  return { x: node.x, y: node.y, w, h, lines, sets, cx: node.x + w / 2, cy: node.y + h / 2 };
}

function shape(node, g) {
  const { x, y, w, h } = g;
  if (node.kind === 'start' || node.kind === 'end') return `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`;
  if (node.kind === 'decision') {
    const c = 12;
    return `<path class="box" d="M${x + c},${y} H${x + w - c} L${x + w},${y + c} V${y + h - c} L${x + w - c},${y + h} H${x + c} L${x},${y + h - c} V${y + c} Z"/>`;
  }
  return `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="7"/>`;
}

export function edgePath(a, b) {
  const x1 = a.x + a.w, y1 = a.cy, x2 = b.x, y2 = b.cy;
  const dx = Math.max(48, Math.abs(x2 - x1) / 2);
  const p1 = [x1 + dx, y1], p2 = [x2 - dx, y2];
  const mid = [(x1 + 3 * p1[0] + 3 * p2[0] + x2) / 8, (y1 + 3 * p1[1] + 3 * p2[1] + y2) / 8];
  return { d: `M${x1},${y1} C${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${x2},${y2}`, mid };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ---- render -----------------------------------------------------------------------------------

let connecting = null; // { from, x, y, over }

export function render() {
  const { doc, view, selection, showCoverage, results, problems, playhead } = store;
  const gs = new Map(doc.nodes.map((n) => [n.id, geom(n)]));

  // What the selected scenario touched, up to the playhead if one is set.
  const nodeSteps = new Map(), edgesOn = new Set();
  let stuckAt = null;
  const active = activeRun();
  if (active) {
    const steps = playhead == null ? active.result.steps : active.result.steps.slice(0, playhead);
    steps.forEach((s, i) => {
      if (!nodeSteps.has(s.node)) nodeSteps.set(s.node, []);
      nodeSteps.get(s.node).push(i + 1);
      if (s.via) edgesOn.add(s.via);
    });
    if (active.result.error && (playhead == null || playhead >= active.result.steps.length)) stuckAt = active.result.error.at;
  }
  const untouchedN = new Set(showCoverage && results ? results.coverage.untouchedNodes : []);
  const untouchedE = new Set(showCoverage && results ? results.coverage.untouchedEdges : []);
  const badN = new Set(problems.filter((p) => p.node).map((p) => p.node));
  const badE = new Set(problems.filter((p) => p.edge).map((p) => p.edge));

  let out = `<defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#9aa3af"/></marker>
    <marker id="arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2f6fed"/></marker>
    <marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1c2430"/></marker>
  </defs><g transform="translate(${view.x} ${view.y}) scale(${view.k})">`;

  for (const e of doc.edges) {
    const a = gs.get(e.from), b = gs.get(e.to);
    if (!a || !b) continue;
    const { d, mid } = edgePath(a, b);
    const sel = selection?.type === 'edge' && selection.id === e.id;
    const on = edgesOn.has(e.id);
    const cls = ['edge', sel && 'selected', on && 'on', e.else && 'else', untouchedE.has(e.id) && 'untouched', badE.has(e.id) && 'bad'].filter(Boolean).join(' ');
    const full = e.else ? 'else' : (e.when?.trim() || e.label || '');
    const text = full.length > 34 ? full.slice(0, 32) + '…' : full;
    const marker = sel ? 'arrow-sel' : on ? 'arrow-on' : 'arrow';
    out += `<g class="${cls}" data-edge="${e.id}"><title>${esc(full)}</title><path class="grab" d="${d}"/><path class="wire" d="${d}" marker-end="url(#${marker})"/>`;
    if (text) {
      const w = text.length * 6.6 + 14;
      out += `<g class="label"><rect x="${mid[0] - w / 2}" y="${mid[1] - 10}" width="${w}" height="20"/><text x="${mid[0]}" y="${mid[1] + 4}" text-anchor="middle">${esc(text)}</text></g>`;
    }
    out += `</g>`;
  }

  for (const n of doc.nodes) {
    const g = gs.get(n.id);
    const sel = selection?.type === 'node' && selection.id === n.id;
    const steps = nodeSteps.get(n.id);
    const cls = ['node', n.kind, sel && 'selected', steps && 'on', stuckAt === n.id && 'stuck', untouchedN.has(n.id) && 'untouched', badN.has(n.id) && 'bad', connecting?.over === n.id && 'target'].filter(Boolean).join(' ');
    out += `<g class="${cls}" data-node="${n.id}">${shape(n, g)}`;
    out += `<text class="kind" x="${g.cx}" y="${g.y + 15}" text-anchor="middle">${n.kind}</text>`;
    g.lines.forEach((l, i) => { out += `<text x="${g.cx}" y="${g.y + 32 + i * 16}" text-anchor="middle">${esc(l)}</text>`; });
    g.sets.forEach(([k, v], i) => { out += `<text class="setbadge" x="${g.cx}" y="${g.y + 32 + g.lines.length * 16 + i * 13}" text-anchor="middle">${esc(k)} = ${esc(v)}</text>`; });
    if (n.kind !== 'end') out += `<circle class="port" data-port="${n.id}" cx="${g.x + g.w}" cy="${g.cy}" r="6"/>`;
    out += `</g>`;
  }

  // Step badges go on top of everything so no wire, port or neighbouring box can sit on them, and
  // they stop shrinking below 1:1 so the numbers stay legible when the drawing is zoomed out.
  const bs = view.k < 1 ? 1 / view.k : 1;
  for (const [id, steps] of nodeSteps) {
    const g = gs.get(id);
    if (!g) continue;
    out += `<g class="badge${stuckAt === id ? ' stuck' : ''}" transform="translate(${g.x} ${g.y - 2}) scale(${bs})">`;
    steps.forEach((s, i) => { out += `<circle cx="${2 + i * 20}" cy="0" r="9"/><text x="${2 + i * 20}" y="3.5">${s}</text>`; });
    out += `</g>`;
  }

  if (connecting) {
    const a = gs.get(connecting.from);
    if (a) out += `<path class="connecting" d="M${a.x + a.w},${a.cy} L${connecting.x},${connecting.y}"/>`;
  }
  out += `</g>`;

  if (!doc.nodes.length) {
    const r = svg.getBoundingClientRect();
    out += `<g class="empty-hint" transform="translate(${r.width / 2} ${r.height / 2})"><text class="big" y="-8">Nothing drawn yet</text><text y="16">Double-click anywhere to add an action, or use the buttons above</text></g>`;
  }
  svg.innerHTML = out;
  zoomPct.textContent = `${Math.round(view.k * 100)}%`;
}

// ---- interaction ------------------------------------------------------------------------------

function toWorld(ev) {
  const r = svg.getBoundingClientRect();
  return { x: (ev.clientX - r.left - store.view.x) / store.view.k, y: (ev.clientY - r.top - store.view.y) / store.view.k };
}
const snap = (v) => Math.round(v / GRID) * GRID;

let drag = null; // { mode: 'pan'|'node'|'connect', ... }

svg.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const port = ev.target.closest('[data-port]');
  const nodeEl = ev.target.closest('[data-node]');
  const edgeEl = ev.target.closest('[data-edge]');
  const w = toWorld(ev);
  try { svg.setPointerCapture(ev.pointerId); } catch {}
  if (port) {
    connecting = { from: port.dataset.port, x: w.x, y: w.y, over: null };
    drag = { mode: 'connect' };
    svg.classList.add('connecting');
    render();
  } else if (nodeEl) {
    const node = store.doc.nodes.find((n) => n.id === nodeEl.dataset.node);
    drag = { mode: 'node', id: node.id, ox: w.x - node.x, oy: w.y - node.y, moved: false };
    if (!(store.selection?.type === 'node' && store.selection.id === node.id)) select({ type: 'node', id: node.id });
  } else if (edgeEl) {
    select({ type: 'edge', id: edgeEl.dataset.edge });
    drag = { mode: 'none' };
  } else {
    drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: store.view.x, vy: store.view.y, moved: false };
    svg.classList.add('dragging');
  }
});

/** The node under the pointer, other than the one a connection starts from. */
function nodeUnder(ev, except) {
  const id = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-node]')?.dataset.node;
  return id && id !== except ? id : null;
}

svg.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const w = toWorld(ev);
  if (drag.mode === 'pan') {
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    store.view.x = drag.vx + dx; store.view.y = drag.vy + dy;
    render();
  } else if (drag.mode === 'node') {
    if (!drag.moved) { drag.moved = true; mark(); svg.classList.add('moving'); }
    // Positions land on the grid unless Alt is held, which is the escape hatch for fine placement.
    const place = ev.altKey ? Math.round : snap;
    commit((d) => { const n = d.nodes.find((n) => n.id === drag.id); n.x = place(w.x - drag.ox); n.y = place(w.y - drag.oy); }, { quiet: true });
  } else if (drag.mode === 'connect') {
    connecting.x = w.x; connecting.y = w.y;
    connecting.over = nodeUnder(ev, connecting.from);
    render();
  }
});

svg.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  svg.classList.remove('dragging', 'moving', 'connecting');
  if (drag.mode === 'pan' && !drag.moved) select(null);
  if (drag.mode === 'connect') {
    const to = nodeUnder(ev, connecting.from);
    const from = connecting.from;
    connecting = null;
    if (to) {
      const id = uid('e');
      commit((d) => { d.edges.push({ id, from, to, when: '' }); });
      select({ type: 'edge', id });
    } else render();
  }
  drag = null;
});

svg.addEventListener('dblclick', (ev) => {
  if (ev.target.closest('[data-edge]')) return;
  const nodeEl = ev.target.closest('[data-node]');
  if (nodeEl) {
    // The node is already selected by the pointerdown; the inspector has rendered its fields by
    // the time the next tick runs, so put the cursor straight into the label.
    if (!(store.selection?.type === 'node' && store.selection.id === nodeEl.dataset.node)) select({ type: 'node', id: nodeEl.dataset.node });
    setTimeout(() => { const el = document.querySelector('#inspector [data-node="label"]'); if (el) { el.focus(); el.select?.(); } }, 0);
    return;
  }
  const w = toWorld(ev);
  addNode('action', snap(w.x - 65), snap(w.y - 25));
});

/** Zoom to factor `k`, keeping the stage point (mx, my) under the same world point. */
function zoomAt(k, mx, my) {
  const { view } = store;
  k = Math.min(ZOOM.max, Math.max(ZOOM.min, k));
  view.x = mx - (mx - view.x) * (k / view.k);
  view.y = my - (my - view.y) * (k / view.k);
  view.k = k;
  render();
}
function zoomCentre(k) { const r = svg.getBoundingClientRect(); zoomAt(k, r.width / 2, r.height / 2); }

svg.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomAt(store.view.k * Math.exp(-ev.deltaY * 0.0012), ev.clientX - r.left, ev.clientY - r.top);
}, { passive: false });

// The zoom corner: −, the current percentage, +, fit, 1:1 and the auto-layout.
for (const b of document.querySelectorAll('#zoom [data-zoom]')) b.addEventListener('click', () => {
  const z = b.dataset.zoom;
  if (z === 'in') zoomCentre(store.view.k * 1.25);
  else if (z === 'out') zoomCentre(store.view.k / 1.25);
  else if (z === 'fit') fit();
  else if (z === 'reset') zoomCentre(1);
  else if (z === 'tidy') tidy();
});

// Arrow keys nudge the selected node one grid step (five with Shift). The snapshot is taken on the
// first press and the rest are quiet, so holding a key down is one undo step, like a drag.
let nudging = false;
window.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable) return;
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
  if (!dir || ev.metaKey || ev.ctrlKey || store.selection?.type !== 'node') return;
  ev.preventDefault();
  const step = GRID * (ev.shiftKey ? 5 : 1), id = store.selection.id;
  if (!nudging) { nudging = true; mark(); }
  commit((d) => { const n = d.nodes.find((n) => n.id === id); if (n) { n.x = snap(n.x) + dir[0] * step; n.y = snap(n.y) + dir[1] * step; } }, { quiet: true });
});
window.addEventListener('keyup', () => { nudging = false; });

export function addNode(kind, x, y) {
  const id = uid('n');
  if (x == null) {
    const r = svg.getBoundingClientRect();
    x = snap((r.width / 2 - store.view.x) / store.view.k - 65 + (Math.random() * 60 - 30));
    y = snap((r.height / 2 - store.view.y) / store.view.k - 25 + (Math.random() * 60 - 30));
  }
  const label = { start: 'Start', end: 'End', decision: 'Decision?', action: 'Action' }[kind];
  commit((d) => { d.nodes.push({ id, kind, label, x, y }); });
  select({ type: 'node', id });
}

/** Scale and centre the view on everything drawn. */
export function fit() {
  const { doc } = store;
  if (!doc.nodes.length) { store.view = { x: 40, y: 40, k: 1 }; render(); return; }
  const gs = doc.nodes.map(geom);
  const minX = Math.min(...gs.map((g) => g.x)) - 40, minY = Math.min(...gs.map((g) => g.y)) - 40;
  const maxX = Math.max(...gs.map((g) => g.x + g.w)) + 40, maxY = Math.max(...gs.map((g) => g.y + g.h)) + 40;
  const r = svg.getBoundingClientRect();
  const k = Math.min(1.4, Math.max(ZOOM.min, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
  store.view = { k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k };
  render();
}

// ---- layout -----------------------------------------------------------------------------------

const COL = 240, ROW = 110;

/**
 * Lay the flow out left to right. Layers are the longest path from the start (so a node sits to
 * the right of everything that can lead to it), rows within a layer are ordered by where their
 * neighbours sit so wires mostly go straight and seldom cross. A loop is a finding, not a layout
 * problem: the edge that would walk back onto the path is simply ignored here. One undo step.
 */
export function tidy() {
  const { doc } = store;
  if (!doc.nodes.length) return;
  const ids = doc.nodes.map((n) => n.id);
  const outs = new Map(ids.map((id) => [id, []])), ins = new Map(ids.map((id) => [id, []]));
  for (const e of doc.edges) if (outs.has(e.from) && outs.has(e.to) && e.from !== e.to) { outs.get(e.from).push(e.to); ins.get(e.to).push(e.from); }
  const roots = doc.nodes.filter((n) => n.kind === 'start').map((n) => n.id);
  if (!roots.length) roots.push(...ids.filter((id) => !ins.get(id).length));

  // A depth-first walk from the roots (then from anything it never reached) that drops back edges;
  // its reversed finishing order is topological for what remains, which is all longest-path needs.
  const seen = new Map(), order = [], fwd = new Map(ids.map((id) => [id, []]));
  const visit = (id) => {
    seen.set(id, 'open');
    for (const t of outs.get(id)) { if (seen.get(t) === 'open') continue; fwd.get(id).push(t); if (!seen.has(t)) visit(t); }
    seen.set(id, 'done'); order.push(id);
  };
  for (const id of [...roots, ...ids]) if (!seen.has(id)) visit(id);
  const layer = new Map(ids.map((id) => [id, 0]));
  for (const id of order.reverse()) for (const t of fwd.get(id)) layer.set(t, Math.max(layer.get(t), layer.get(id) + 1));

  const layers = [];
  for (const id of ids) (layers[layer.get(id)] ??= []).push(id);
  const row = new Map();
  const place = (L) => L.forEach((id, i) => row.set(id, i));
  layers.forEach(place);
  // Barycentre ordering: a few sweeps down (by predecessors) and up (by successors).
  const bary = (id, nbrs) => nbrs.length ? nbrs.reduce((s, x) => s + row.get(x), 0) / nbrs.length : row.get(id);
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    for (const L of down ? layers : [...layers].reverse()) {
      const key = new Map(L.map((id) => [id, bary(id, (down ? ins : outs).get(id))]));
      L.sort((a, b) => key.get(a) - key.get(b));
      place(L);
    }
  }

  const gs = new Map(doc.nodes.map((n) => [n.id, geom(n)]));
  const pos = new Map();
  let x = 40;
  for (const L of layers) {
    const top = 40 - ((L.length - 1) * ROW) / 2;
    L.forEach((id, i) => pos.set(id, { x, y: snap(top + i * ROW) }));
    x += snap(Math.max(COL, Math.max(...L.map((id) => gs.get(id).w)) + 60));
  }
  const minY = Math.min(...[...pos.values()].map((p) => p.y));
  commit((d) => { for (const n of d.nodes) { const p = pos.get(n.id); if (p) { n.x = p.x; n.y = p.y - minY + 40; } } });
  fit();
}

window.addEventListener('resize', render);
