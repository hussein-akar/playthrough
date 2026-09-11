// The drawing. Nodes are boxes, edges are wires with the guard written on a pill; the selected
// scenario's path is painted over it in the accent colour, step by step, and whatever no scenario
// ever reaches can be dimmed. Everything is re-rendered from the document on every change: the
// drawings this is for are dozens of nodes, not thousands.
import { store, commit, mark, select, uid, activeRun, emit } from './store.mjs';

const svg = document.getElementById('canvas');
const NS = 'http://www.w3.org/2000/svg';
const GRID = 12;

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

let connecting = null; // { from, x, y }

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
    const cls = ['node', n.kind, sel && 'selected', steps && 'on', stuckAt === n.id && 'stuck', untouchedN.has(n.id) && 'untouched', badN.has(n.id) && 'bad'].filter(Boolean).join(' ');
    out += `<g class="${cls}" data-node="${n.id}">${shape(n, g)}`;
    out += `<text class="kind" x="${g.cx}" y="${g.y + 15}" text-anchor="middle">${n.kind}</text>`;
    g.lines.forEach((l, i) => { out += `<text x="${g.cx}" y="${g.y + 32 + i * 16}" text-anchor="middle">${esc(l)}</text>`; });
    g.sets.forEach(([k, v], i) => { out += `<text class="setbadge" x="${g.cx}" y="${g.y + 32 + g.lines.length * 16 + i * 13}" text-anchor="middle">${esc(k)} = ${esc(v)}</text>`; });
    if (n.kind !== 'end') out += `<circle class="port" data-port="${n.id}" cx="${g.x + g.w}" cy="${g.cy}" r="6"/>`;
    if (steps) steps.forEach((s, i) => { out += `<g class="badge"><circle cx="${g.x + 2 + i * 20}" cy="${g.y - 2}" r="9"/><text x="${g.x + 2 + i * 20}" y="${g.y + 1.5}">${s}</text></g>`; });
    out += `</g>`;
  }

  if (connecting) {
    const a = gs.get(connecting.from);
    if (a) out += `<path class="connecting" d="M${a.x + a.w},${a.cy} L${connecting.x},${connecting.y}"/>`;
  }
  out += `</g>`;
  svg.innerHTML = out;
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
    connecting = { from: port.dataset.port, x: w.x, y: w.y };
    drag = { mode: 'connect' };
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

svg.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const w = toWorld(ev);
  if (drag.mode === 'pan') {
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    store.view.x = drag.vx + dx; store.view.y = drag.vy + dy;
    render();
  } else if (drag.mode === 'node') {
    if (!drag.moved) { drag.moved = true; mark(); }
    commit((d) => { const n = d.nodes.find((n) => n.id === drag.id); n.x = snap(w.x - drag.ox); n.y = snap(w.y - drag.oy); }, { quiet: true });
  } else if (drag.mode === 'connect') {
    connecting.x = w.x; connecting.y = w.y;
    render();
  }
});

svg.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  svg.classList.remove('dragging');
  if (drag.mode === 'pan' && !drag.moved) select(null);
  if (drag.mode === 'connect') {
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-node]');
    const from = connecting.from;
    connecting = null;
    if (target && target.dataset.node !== from) {
      const id = uid('e');
      commit((d) => { d.edges.push({ id, from, to: target.dataset.node, when: '' }); });
      select({ type: 'edge', id });
    } else render();
  }
  drag = null;
});

svg.addEventListener('dblclick', (ev) => {
  if (ev.target.closest('[data-node]') || ev.target.closest('[data-edge]')) return;
  const w = toWorld(ev);
  addNode('action', snap(w.x - 65), snap(w.y - 25));
});

svg.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const { view } = store;
  const k = Math.min(2.5, Math.max(0.25, view.k * Math.exp(-ev.deltaY * 0.0012)));
  view.x = mx - (mx - view.x) * (k / view.k);
  view.y = my - (my - view.y) * (k / view.k);
  view.k = k;
  render();
}, { passive: false });

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
  const k = Math.min(1.4, Math.max(0.25, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
  store.view = { k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k };
  render();
}

window.addEventListener('resize', render);
