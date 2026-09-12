// The drawing. Nodes are boxes, edges are wires with the guard written on a pill; the selected
// scenario's path is painted over it in the accent colour, step by step, and whatever no scenario
// ever reaches can be dimmed. Everything is re-rendered from the document on every change: the
// drawings this is for are dozens of nodes, not thousands.
import { store, commit, mark, select, selectNodes, selectedNodeIds, isSelectedNode, uid, activeRun, emit } from './store.mjs';

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
let marquee = null;    // { x0, y0, x1, y1 } in world coordinates while a rubber band is being drawn

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
  const selN = new Set(selectedNodeIds());
  const group = selN.size > 1;

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
    const linked = group && selN.has(e.from) && selN.has(e.to);
    const cls = ['edge', sel && 'selected', linked && 'linked', on && 'on', e.else && 'else', untouchedE.has(e.id) && 'untouched', badE.has(e.id) && 'bad'].filter(Boolean).join(' ');
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
    const sel = selN.has(n.id);
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
  if (marquee) {
    const r = rectOf(marquee);
    out += `<rect class="marquee" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
  }
  out += `</g>`;

  if (!doc.nodes.length) {
    const r = svg.getBoundingClientRect();
    out += `<g class="empty-hint" transform="translate(${r.width / 2} ${r.height / 2})"><text class="big" y="-8">Nothing drawn yet</text><text y="16">Drag a shape in from the palette on the left, or double-click anywhere to add an action</text></g>`;
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
const rectOf = ({ x0, y0, x1, y1 }) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
/** The nodes whose box overlaps the rubber band. Touching is enough: nobody wants to cover a whole box to catch it. */
function nodesIn(m) {
  const r = rectOf(m);
  return store.doc.nodes.filter((n) => { const g = geom(n); return g.x < r.x + r.w && g.x + g.w > r.x && g.y < r.y + r.h && g.y + g.h > r.y; }).map((n) => n.id);
}

let drag = null; // { mode: 'pan'|'node'|'connect'|'marquee'|'none', ... }

// Space is the pan modifier, as in Figma: held, a drag on empty canvas pans instead of selecting.
// The hold is remembered so a Space that panned is not also a Space that plays the scenario.
let spaceHeld = false, spaceUsed = false;
const typing = (t) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable;
window.addEventListener('keydown', (ev) => {
  if (ev.key !== ' ' || typing(ev.target) || document.querySelector('dialog[open]')) return;
  ev.preventDefault();
  if (ev.repeat) return;
  spaceHeld = true; spaceUsed = false;
  svg.classList.add('pannable');
});
window.addEventListener('keyup', (ev) => {
  if (ev.key !== ' ' || !spaceHeld) return;
  spaceHeld = false;
  svg.classList.remove('pannable');
  if (!spaceUsed && store.selection?.type === 'scenario') document.dispatchEvent(new Event('play'));
});
window.addEventListener('blur', () => { spaceHeld = false; svg.classList.remove('pannable'); });

svg.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 && ev.button !== 1) return;
  const w = toWorld(ev);
  try { svg.setPointerCapture(ev.pointerId); } catch {}
  if (ev.button === 1 || spaceHeld) {
    ev.preventDefault();
    spaceUsed = true;
    drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: store.view.x, vy: store.view.y, moved: false };
    svg.classList.add('dragging');
    return;
  }
  const port = ev.target.closest('[data-port]');
  const nodeEl = ev.target.closest('[data-node]');
  const edgeEl = ev.target.closest('[data-edge]');
  if (port) {
    connecting = { from: port.dataset.port, x: w.x, y: w.y, over: null };
    drag = { mode: 'connect' };
    svg.classList.add('connecting');
    render();
  } else if (nodeEl) {
    const id = nodeEl.dataset.node;
    if (ev.shiftKey) {
      // Shift-click adds a node to the group or takes it out again; nothing moves.
      const ids = selectedNodeIds();
      selectNodes(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
      drag = { mode: 'none' };
      return;
    }
    // Pressing a node that is already in the group keeps the group, so the whole of it can be dragged.
    if (!isSelectedNode(id)) select({ type: 'node', id });
    const nodes = selectedNodeIds().map((nid) => { const n = store.doc.nodes.find((x) => x.id === nid); return { id: nid, x: n.x, y: n.y }; });
    drag = { mode: 'node', start: w, nodes, moved: false };
  } else if (edgeEl) {
    select({ type: 'edge', id: edgeEl.dataset.edge });
    drag = { mode: 'none' };
  } else {
    // Dragging on empty canvas draws a rubber band. Shift keeps what was already selected and adds
    // to it; without Shift a plain click clears the selection, as it always did.
    marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    drag = { mode: 'marquee', add: ev.shiftKey ? selectedNodeIds() : [], moved: false };
  }
});
svg.addEventListener('auxclick', (ev) => ev.preventDefault());

/** The node under the pointer, other than the one a connection starts from. */
function nodeUnder(ev, except) {
  const id = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-node]')?.dataset.node;
  return id && id !== except ? id : null;
}

let pointer = null; // last world position of the pointer over the canvas, where a paste lands
svg.addEventListener('pointerleave', () => { pointer = null; });
svg.addEventListener('pointermove', (ev) => {
  pointer = toWorld(ev);
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
    // Every node in the group moves by the same offset from where it started, so the group keeps its shape.
    const place = ev.altKey ? Math.round : snap;
    const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    commit((d) => {
      for (const s of drag.nodes) { const n = d.nodes.find((n) => n.id === s.id); if (n) { n.x = place(s.x + dx); n.y = place(s.y + dy); } }
    }, { quiet: true });
  } else if (drag.mode === 'marquee') {
    marquee.x1 = w.x; marquee.y1 = w.y;
    if (!drag.moved && Math.abs(w.x - marquee.x0) * store.view.k + Math.abs(w.y - marquee.y0) * store.view.k > 3) { drag.moved = true; svg.classList.add('selecting'); }
    if (drag.moved) render();
  } else if (drag.mode === 'connect') {
    connecting.x = w.x; connecting.y = w.y;
    connecting.over = nodeUnder(ev, connecting.from);
    render();
  }
});

svg.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  svg.classList.remove('dragging', 'moving', 'connecting', 'selecting');
  if (drag.mode === 'marquee') {
    const caught = drag.moved ? nodesIn(marquee) : [];
    marquee = null;
    if (!drag.moved) select(null);
    else if (caught.length || drag.add.length) selectNodes([...drag.add, ...caught]);
    else { select(null); render(); }
  }
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
    if (!(store.selection?.type === 'node' && !store.selection.ids && store.selection.id === nodeEl.dataset.node)) select({ type: 'node', id: nodeEl.dataset.node });
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

// The wheel pans, as on a trackpad; ⌘-wheel, Ctrl-wheel and a pinch (which browsers report as a
// Ctrl-wheel) zoom about the pointer. The pinch deltas are tiny and a mouse notch is huge, so the
// step is clamped to keep both usable.
svg.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) {
    const r = svg.getBoundingClientRect();
    const d = Math.max(-40, Math.min(40, ev.deltaY));
    zoomAt(store.view.k * Math.exp(-d * 0.008), ev.clientX - r.left, ev.clientY - r.top);
  } else {
    const m = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
    store.view.x -= ev.deltaX * m; store.view.y -= ev.deltaY * m;
    render();
  }
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

// Arrow keys nudge the selected nodes one grid step (five with Shift). The snapshot is taken on the
// first press and the rest are quiet, so holding a key down is one undo step, like a drag.
let nudging = false;
window.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable) return;
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
  const ids = selectedNodeIds();
  if (!dir || ev.metaKey || ev.ctrlKey || !ids.length) return;
  ev.preventDefault();
  const step = GRID * (ev.shiftKey ? 5 : 1);
  if (!nudging) { nudging = true; mark(); }
  commit((d) => { for (const n of d.nodes) if (ids.includes(n.id)) { n.x = snap(n.x) + dir[0] * step; n.y = snap(n.y) + dir[1] * step; } }, { quiet: true });
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

// ---- palette ----------------------------------------------------------------------------------

// A shape is clicked to add it in the middle of the view or dragged in to put it where it lands. A
// ghost of the node at the canvas's zoom follows the pointer and fades while it is off the canvas.
const palette = document.getElementById('palette');
const ghost = document.getElementById('ghost');
const OFFSET = { x: 65, y: 25 }; // where the pointer sits inside a freshly placed node
let placing = null; // { kind, sx, sy, moved }

const overCanvas = (ev) => { const el = document.elementFromPoint(ev.clientX, ev.clientY); return !!el && (el === svg || svg.contains(el)); };

function drawGhost(kind) {
  const label = { start: 'Start', end: 'End', decision: 'Decision?', action: 'Action' }[kind];
  const g = geom({ kind, label, x: 0, y: 0 });
  const k = store.view.k;
  ghost.innerHTML = `<svg width="${g.w * k}" height="${g.h * k}"><g class="node ${kind}" transform="scale(${k})">${shape({ kind }, g)}<text class="kind" x="${g.cx}" y="${g.y + 15}" text-anchor="middle">${kind}</text><text x="${g.cx}" y="${g.y + 32}" text-anchor="middle">${esc(label)}</text></g></svg>`;
}
function moveGhost(ev) {
  const k = store.view.k;
  ghost.style.transform = `translate(${ev.clientX - OFFSET.x * k}px, ${ev.clientY - OFFSET.y * k}px)`;
  ghost.classList.toggle('off', !overCanvas(ev));
}

palette.addEventListener('pointerdown', (ev) => {
  const b = ev.target.closest('[data-add]');
  if (!b || ev.button !== 0) return;
  ev.preventDefault();
  placing = { kind: b.dataset.add, sx: ev.clientX, sy: ev.clientY, moved: false };
  try { b.setPointerCapture(ev.pointerId); } catch {}
});
palette.addEventListener('pointermove', (ev) => {
  if (!placing) return;
  if (!placing.moved) {
    if (Math.hypot(ev.clientX - placing.sx, ev.clientY - placing.sy) < 4) return;
    placing.moved = true;
    drawGhost(placing.kind);
    ghost.hidden = false;
    document.body.classList.add('placing');
  }
  moveGhost(ev);
});
function endPlacing() {
  placing = null;
  ghost.hidden = true;
  ghost.innerHTML = '';
  document.body.classList.remove('placing');
}
palette.addEventListener('pointerup', (ev) => {
  if (!placing) return;
  const { kind, moved } = placing;
  endPlacing();
  if (!moved) addNode(kind);
  else if (overCanvas(ev)) { const w = toWorld(ev); addNode(kind, snap(w.x - OFFSET.x), snap(w.y - OFFSET.y)); }
});
palette.addEventListener('pointercancel', endPlacing);
palette.addEventListener('lostpointercapture', () => { if (placing) endPlacing(); });

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

/** Line the selected nodes up on their leftmost edge or their topmost edge, in one undo step. */
export function alignSelected(axis) {
  const ids = selectedNodeIds();
  if (ids.length < 2) return;
  const key = axis === 'left' ? 'x' : 'y';
  commit((d) => {
    const picked = d.nodes.filter((n) => ids.includes(n.id));
    const v = Math.min(...picked.map((n) => n[key]));
    for (const n of picked) n[key] = v;
  });
}

// ---- clipboard --------------------------------------------------------------------------------

// The clipboard holds copies of the selected nodes and of the edges between them, positioned from
// their own top-left corner. It lives in memory: the system clipboard stays free for text.
let clipboard = null; // { nodes, edges, w, h, origin: { x, y } }

function bundleSelection() {
  const ids = new Set(selectedNodeIds());
  if (!ids.size) return null;
  const nodes = store.doc.nodes.filter((n) => ids.has(n.id));
  const gs = nodes.map(geom);
  const x0 = Math.min(...gs.map((g) => g.x)), y0 = Math.min(...gs.map((g) => g.y));
  const w = Math.max(...gs.map((g) => g.x + g.w)) - x0, h = Math.max(...gs.map((g) => g.y + g.h)) - y0;
  return {
    nodes: nodes.map((n) => ({ ...structuredClone(n), x: n.x - x0, y: n.y - y0 })),
    edges: store.doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => structuredClone(e)),
    w, h, origin: { x: x0, y: y0 },
  };
}

/** Put a bundle on the canvas with its top-left at (x, y), fresh ids throughout, and select it. */
function place(bundle, x, y) {
  const ids = new Map(bundle.nodes.map((n) => [n.id, uid('n')]));
  commit((d) => {
    for (const n of bundle.nodes) d.nodes.push({ ...structuredClone(n), id: ids.get(n.id), x: snap(x + n.x), y: snap(y + n.y) });
    for (const e of bundle.edges) d.edges.push({ ...structuredClone(e), id: uid('e'), from: ids.get(e.from), to: ids.get(e.to) });
  });
  selectNodes([...ids.values()]);
}

export function hasClipboard() { return !!clipboard; }
export function copySelection() { const b = bundleSelection(); if (b) clipboard = b; return !!b; }
export function cutSelection() { if (copySelection()) deleteSelectedNodes(); }

/** Paste centred on the pointer when it is over the canvas, else a step down and right of where the copy came from. */
export function paste(at = pointer) {
  if (!clipboard) return;
  if (at) place(clipboard, at.x - clipboard.w / 2, at.y - clipboard.h / 2);
  else {
    clipboard.origin = { x: clipboard.origin.x + GRID * 2, y: clipboard.origin.y + GRID * 2 };
    place(clipboard, clipboard.origin.x, clipboard.origin.y);
  }
}

/** A copy of the selection a step down and right, leaving the clipboard alone. */
export function duplicateSelection() {
  const b = bundleSelection();
  if (b) place(b, b.origin.x + GRID * 2, b.origin.y + GRID * 2);
}

// ---- context menu -----------------------------------------------------------------------------

// A small menu on right-click: the four shapes (added where the menu was opened) and Paste on empty
// canvas; Copy, Cut, Duplicate and Delete on a node; Delete on an edge.
const ctx = document.getElementById('ctx');
let ctxAt = null; // world position the menu was opened at

function closeCtx() { ctx.hidden = true; ctx.innerHTML = ''; ctxAt = null; }
const KIND_LABEL = { start: 'Start', action: 'Action', decision: 'Decision', end: 'End' };

function openCtx(ev, items) {
  ctx.innerHTML = items.map((it) => it === '-' ? '<hr>' : `<button data-act="${it.act}"${it.off ? ' disabled' : ''}>${it.icon ?? ''}<span>${esc(it.label)}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>`).join('');
  ctx.hidden = false;
  const r = ctx.getBoundingClientRect();
  ctx.style.left = `${Math.min(ev.clientX, window.innerWidth - r.width - 8)}px`;
  ctx.style.top = `${Math.min(ev.clientY, window.innerHeight - r.height - 8)}px`;
}

svg.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  closeCtx();
  ctxAt = toWorld(ev);
  const nodeEl = ev.target.closest('[data-node]');
  const edgeEl = ev.target.closest('[data-edge]');
  if (nodeEl) {
    const id = nodeEl.dataset.node;
    if (!isSelectedNode(id)) select({ type: 'node', id });
    const n = selectedNodeIds().length, what = n > 1 ? `${n} nodes` : 'node';
    openCtx(ev, [
      { act: 'copy', label: `Copy ${what}`, key: '⌘C' },
      { act: 'cut', label: `Cut ${what}`, key: '⌘X' },
      { act: 'duplicate', label: `Duplicate ${what}`, key: '⌘D' },
      '-',
      { act: 'delete', label: `Delete ${what}`, key: '⌫' },
    ]);
  } else if (edgeEl) {
    select({ type: 'edge', id: edgeEl.dataset.edge });
    openCtx(ev, [{ act: 'delete-edge', label: 'Delete connection', key: '⌫' }]);
  } else {
    openCtx(ev, [
      ...Object.entries(KIND_LABEL).map(([kind, label]) => ({ act: `add:${kind}`, label, icon: `<i class="dot ${kind}"></i>` })),
      '-',
      { act: 'paste', label: 'Paste', key: '⌘V', off: !clipboard },
      { act: 'select-all', label: 'Select all', key: '⌘A', off: !store.doc.nodes.length },
    ]);
  }
});

ctx.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act, at = ctxAt;
  closeCtx();
  if (act.startsWith('add:')) addNode(act.slice(4), snap(at.x - OFFSET.x), snap(at.y - OFFSET.y));
  else if (act === 'paste') paste(at);
  else if (act === 'select-all') selectNodes(store.doc.nodes.map((n) => n.id));
  else if (act === 'copy') copySelection();
  else if (act === 'cut') cutSelection();
  else if (act === 'duplicate') duplicateSelection();
  else if (act === 'delete') deleteSelectedNodes();
  else if (act === 'delete-edge') { const id = store.selection?.id; commit((d) => { d.edges = d.edges.filter((e) => e.id !== id); }); select(null); }
});
// The menu goes away on any press outside it, on Escape, on a wheel turn and when the window changes.
window.addEventListener('pointerdown', (ev) => { if (!ctx.hidden && !ctx.contains(ev.target)) closeCtx(); }, true);
window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !ctx.hidden) closeCtx(); });
svg.addEventListener('wheel', () => { if (!ctx.hidden) closeCtx(); }, { passive: true });
window.addEventListener('resize', () => { if (!ctx.hidden) closeCtx(); });
window.addEventListener('blur', () => { if (!ctx.hidden) closeCtx(); });

/** Remove every selected node and each edge that touched one of them, in one undo step. */
export function deleteSelectedNodes() {
  const ids = new Set(selectedNodeIds());
  if (!ids.size) return;
  commit((d) => { d.nodes = d.nodes.filter((n) => !ids.has(n.id)); d.edges = d.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to)); });
  select(null);
}
