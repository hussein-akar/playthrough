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

// A node has a port in the middle of each side. A wire leaves its port along the side's normal
// and arrives at the other port the same way, so it always meets a box square-on.
export const SIDES = ['top', 'right', 'bottom', 'left'];
const NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const side = (s, dflt) => (SIDES.includes(s) ? s : dflt);

export function portAt(g, s) {
  if (s === 'top') return { x: g.cx, y: g.y };
  if (s === 'bottom') return { x: g.cx, y: g.y + g.h };
  if (s === 'left') return { x: g.x, y: g.cy };
  return { x: g.x + g.w, y: g.cy };
}

/**
 * A wire is smooth (one curve) or square (straight runs with rounded elbows); `mid` is where its
 * pill sits. A wire that has been pulled passes through `via`: a smooth one bends through it, a
 * square one runs straight out of each port to it, so dragging it moves the middle run.
 */
export function edgePath(a, b, fromSide, toSide, shape, via) {
  const fs = side(fromSide, 'right'), ts = side(toSide, 'left');
  const p = portAt(a, fs), q = portAt(b, ts);
  const na = NORMAL[fs], nb = NORMAL[ts];
  if (shape === 'square') {
    const pts = via ? viaRoute(p, q, na, nb, via) : squareRoute(p, q, na, nb, a, b);
    // The pill rides the level run, under the pointer while the wire is being pulled.
    const lo = Math.min(p.x + na[0] * STUB, q.x + nb[0] * STUB), hi = Math.max(p.x + na[0] * STUB, q.x + nb[0] * STUB);
    return { d: rounded(pts), mid: via ? [Math.max(lo, Math.min(hi, via.x)), via.y] : midOf(pts) };
  }
  if (via) {
    const d1 = reach(p, via), d2 = reach(via, q), len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const t = { x: (q.x - p.x) / len, y: (q.y - p.y) / len }, k = Math.min(d1, d2) * 0.6;
    return {
      d: `M${p.x},${p.y} C${p.x + na[0] * d1},${p.y + na[1] * d1} ${via.x - t.x * k},${via.y - t.y * k} ${via.x},${via.y} C${via.x + t.x * k},${via.y + t.y * k} ${q.x + nb[0] * d2},${q.y + nb[1] * d2} ${q.x},${q.y}`,
      mid: [via.x, via.y],
    };
  }
  const d = reach(p, q);
  const p1 = [p.x + na[0] * d, p.y + na[1] * d], p2 = [q.x + nb[0] * d, q.y + nb[1] * d];
  const mid = [(p.x + 3 * p1[0] + 3 * p2[0] + q.x) / 8, (p.y + 3 * p1[1] + 3 * p2[1] + q.y) / 8];
  return { d: `M${p.x},${p.y} C${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${q.x},${q.y}`, mid };
}

/** How far a smooth wire runs out of its ports before bending: half the distance, but capped so a long wire is straight in the middle rather than one huge S. */
const reach = (p, q) => Math.max(48, Math.min(200, Math.hypot(q.x - p.x, q.y - p.y) / 2));

const STUB = 24;   // how far a square wire runs straight out of a port before it may turn

/**
 * The corners of a square wire. Each end runs a stub out of its port; between the stubs the wire
 * turns once or twice. Ends that face each other with room meet halfway; ends that do not (a wire
 * running back to the left, say) go round the outside of both boxes instead of through them.
 */
function squareRoute(p, q, na, nb, ga, gb) {
  const a = { x: p.x + na[0] * STUB, y: p.y + na[1] * STUB }, b = { x: q.x + nb[0] * STUB, y: q.y + nb[1] * STUB };
  const ah = na[1] === 0, bh = nb[1] === 0;   // the stub is horizontal
  let mids;
  if (ah && bh) {
    if (na[0] === nb[0]) { const mx = na[0] > 0 ? Math.max(a.x, b.x) : Math.min(a.x, b.x); mids = [{ x: mx, y: a.y }, { x: mx, y: b.y }]; }
    else if ((b.x - a.x) * na[0] > 0 && (a.x - b.x) * nb[0] > 0) { const mx = (a.x + b.x) / 2; mids = [{ x: mx, y: a.y }, { x: mx, y: b.y }]; }
    else { const my = Math.max(ga.y + ga.h, gb.y + gb.h) + 30; mids = [{ x: a.x, y: my }, { x: b.x, y: my }]; }
  } else if (!ah && !bh) {
    if (na[1] === nb[1]) {
      // Both ends leave the same way (a bypass under two boxes): run level with the deeper stub. When
      // the boxes are side by side, climb and descend in the gaps beside them, not through whatever
      // sits above or below them.
      const my = na[1] > 0 ? Math.max(a.y, b.y) : Math.min(a.y, b.y);
      if (gb.x > ga.x + ga.w + 2 * STUB) { const sx = ga.x + ga.w + STUB, tx = gb.x - STUB; mids = [{ x: sx, y: a.y }, { x: sx, y: my }, { x: tx, y: my }, { x: tx, y: b.y }]; }
      else if (ga.x > gb.x + gb.w + 2 * STUB) { const sx = ga.x - STUB, tx = gb.x + gb.w + STUB; mids = [{ x: sx, y: a.y }, { x: sx, y: my }, { x: tx, y: my }, { x: tx, y: b.y }]; }
      else mids = [{ x: a.x, y: my }, { x: b.x, y: my }];
    }
    else if ((b.y - a.y) * na[1] > 0 && (a.y - b.y) * nb[1] > 0) { const my = (a.y + b.y) / 2; mids = [{ x: a.x, y: my }, { x: b.x, y: my }]; }
    else { const mx = Math.max(ga.x + ga.w, gb.x + gb.w) + 30; mids = [{ x: mx, y: a.y }, { x: mx, y: b.y }]; }
  } else if (ah) {
    mids = (b.x - a.x) * na[0] > 0 && (b.y - a.y) * nb[1] < 0 ? [{ x: b.x, y: a.y }] : [{ x: a.x, y: b.y }];
  } else {
    mids = (b.y - a.y) * na[1] > 0 && (b.x - a.x) * nb[0] < 0 ? [{ x: a.x, y: b.y }] : [{ x: b.x, y: a.y }];
  }
  // Drop repeated points and corners that are not corners (three points on one line).
  const pts = [p, a, ...mids, b, q].filter((c, i, all) => !i || Math.abs(c.x - all[i - 1].x) > 0.01 || Math.abs(c.y - all[i - 1].y) > 0.01);
  return pts.filter((c, i) => !i || i === pts.length - 1 || !((pts[i - 1].x === c.x && c.x === pts[i + 1].x) || (pts[i - 1].y === c.y && c.y === pts[i + 1].y)));
}

/** The corners of a square wire pulled to V: out of each port, then a level run at V's height between the two stubs, so the wire runs where it was dropped. */
function viaRoute(p, q, na, nb, V) {
  const a = { x: p.x + na[0] * STUB, y: p.y + na[1] * STUB }, b = { x: q.x + nb[0] * STUB, y: q.y + nb[1] * STUB };
  const pts = [p, a, { x: a.x, y: V.y }, { x: b.x, y: V.y }, b, q].filter((c, i, all) => !i || Math.abs(c.x - all[i - 1].x) > 0.01 || Math.abs(c.y - all[i - 1].y) > 0.01);
  return pts.filter((c, i) => !i || i === pts.length - 1 || !((pts[i - 1].x === c.x && c.x === pts[i + 1].x) || (pts[i - 1].y === c.y && c.y === pts[i + 1].y)));
}

/** A polyline as a path whose corners are rounded off, as far as the runs on either side allow. */
function rounded(pts, r = 8) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y), l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) { d += ` L${c.x},${c.y}`; continue; }
    const u = { x: (c.x - p.x) / l1, y: (c.y - p.y) / l1 }, v = { x: (n.x - c.x) / l2, y: (n.y - c.y) / l2 };
    d += ` L${c.x - u.x * rr},${c.y - u.y * rr} Q${c.x},${c.y} ${c.x + v.x * rr},${c.y + v.y * rr}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x},${last.y}`;
}

/** The point halfway along a polyline. */
function midOf(pts) {
  const lens = pts.slice(1).map((c, i) => Math.hypot(c.x - pts[i].x, c.y - pts[i].y));
  let left = lens.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i]) { const t = lens[i] ? left / lens[i] : 0; return [pts[i].x + (pts[i + 1].x - pts[i].x) * t, pts[i].y + (pts[i + 1].y - pts[i].y) * t]; }
    left -= lens[i];
  }
  return [pts[0].x, pts[0].y];
}

// A wire may carry a status colour; these are the four everyone knows, in the page's own tones.
export const EDGE_COLORS = { success: '#1f9d55', failed: '#d64545', warning: '#d98c0d', info: '#2f6fed' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ---- render -----------------------------------------------------------------------------------

// While a wire is being dragged: the end that stays put (`node`, `side`), which end of the wire
// is in hand (`end`), the edge being re-attached if it is not a new one, the pointer, and the
// dot it would land on.
let connecting = null; // { node, side, end: 'to'|'from', edge: id|null, x, y, hit: { node, side }|null }
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
    <marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5b6675"/></marker>
    ${Object.entries(EDGE_COLORS).map(([c, v]) => `<marker id="arrow-${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${v}"/></marker>`).join('')}
  </defs><g transform="translate(${view.x} ${view.y}) scale(${view.k})">`;

  const mids = new Map();   // where each wire's pill sits, for the bar over the selected one
  for (const e of doc.edges) {
    const a = gs.get(e.from), b = gs.get(e.to);
    if (!a || !b || connecting?.edge === e.id) continue;   // a wire whose end is in hand is drawn as the preview
    const { d, mid } = edgePath(a, b, e.fromSide, e.toSide, e.shape, e.via);
    mids.set(e.id, mid);
    const sel = selection?.type === 'edge' && selection.id === e.id;
    const on = edgesOn.has(e.id);
    const linked = group && selN.has(e.from) && selN.has(e.to);
    // The pill reads the label when there is one, else the condition, else "else": a long guard
    // is better read in the panel, and the full text is in the tooltip either way.
    const label = e.label?.trim() ?? '', when = e.when?.trim() ?? '';
    const full = label || (e.else ? 'else' : when);
    const color = EDGE_COLORS[e.color] ? e.color : null;
    const cls = ['edge', sel && 'selected', linked && 'linked', on && 'on', e.else && !label && 'else', color && `c-${color}`, untouchedE.has(e.id) && 'untouched', badE.has(e.id) && 'bad'].filter(Boolean).join(' ');
    const text = full.length > 34 ? full.slice(0, 32) + '…' : full;
    const marker = on ? 'arrow-on' : color ? `arrow-${color}` : sel ? 'arrow-sel' : 'arrow';
    const tip = label && (when || e.else) ? `${label} · ${e.else ? 'else' : when}` : full;
    out += `<g class="${cls}" data-edge="${e.id}"><title>${esc(tip)}</title><path class="grab" d="${d}"/><path class="wire" d="${d}" marker-end="url(#${marker})"/>`;
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
    const cls = ['node', n.kind, sel && 'selected', steps && 'on', stuckAt === n.id && 'stuck', untouchedN.has(n.id) && 'untouched', badN.has(n.id) && 'bad'].filter(Boolean).join(' ');
    out += `<g class="${cls}" data-node="${n.id}">${shape(n, g)}`;
    out += `<text class="kind" x="${g.cx}" y="${g.y + 15}" text-anchor="middle">${n.kind}</text>`;
    g.lines.forEach((l, i) => { out += `<text x="${g.cx}" y="${g.y + 32 + i * 16}" text-anchor="middle">${esc(l)}</text>`; });
    g.sets.forEach(([k, v], i) => { out += `<text class="setbadge" x="${g.cx}" y="${g.y + 32 + g.lines.length * 16 + i * 13}" text-anchor="middle">${esc(k)} = ${esc(v)}</text>`; });
    // The dots on the sides. Nothing leaves an End, so its dots only appear while a wire is looking
    // for somewhere to land; a wire's own start and the dot it is about to land on are marked.
    if (n.kind !== 'end' || connecting) for (const s of SIDES) {
      const p = portAt(g, s);
      const hot = connecting?.hit?.node === n.id && connecting.hit.side === s;
      const src = connecting?.node === n.id && connecting.side === s;
      out += `<g class="port${hot ? ' hot' : ''}${src ? ' src' : ''}" data-port="${n.id}" data-side="${s}"><circle class="hit" cx="${p.x}" cy="${p.y}" r="11"/><circle class="dot" cx="${p.x}" cy="${p.y}" r="${hot ? 7 : 5}"/></g>`;
    }
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

  // The ends of the selected wire are handles: either can be dragged to another dot.
  const selEdge = selection?.type === 'edge' && !connecting ? doc.edges.find((e) => e.id === selection.id) : null;
  if (selEdge && gs.has(selEdge.from) && gs.has(selEdge.to)) {
    const p = portAt(gs.get(selEdge.from), side(selEdge.fromSide, 'right')), q = portAt(gs.get(selEdge.to), side(selEdge.toSide, 'left'));
    out += `<circle class="handle" data-handle="from" data-edge="${selEdge.id}" cx="${p.x}" cy="${p.y}" r="5.5"/><circle class="handle" data-handle="to" data-edge="${selEdge.id}" cx="${q.x}" cy="${q.y}" r="5.5"/>`;
    // The middle of the wire can be pulled: by its pill when it has one, else by this handle.
    const m = mids.get(selEdge.id);
    if (m && !(selEdge.label?.trim() || selEdge.when?.trim() || selEdge.else)) out += `<circle class="handle bend" data-edge="${selEdge.id}" cx="${m[0]}" cy="${m[1]}" r="5"/>`;
  }

  if (connecting) {
    const a = gs.get(connecting.node), b = connecting.hit && gs.get(connecting.hit.node);
    const e = connecting.edge && doc.edges.find((e) => e.id === connecting.edge);
    const toEnd = connecting.end === 'to';
    if (a && b) {
      const d = toEnd ? edgePath(a, b, connecting.side, connecting.hit.side, e?.shape, e?.via).d : edgePath(b, a, connecting.hit.side, connecting.side, e?.shape, e?.via).d;
      out += `<path class="connecting" d="${d}" marker-end="url(#arrow)"/>`;
    } else if (a) {
      const p = portAt(a, connecting.side), n = NORMAL[connecting.side], c = { x: p.x + n[0] * 40, y: p.y + n[1] * 40 };
      out += toEnd
        ? `<path class="connecting" d="M${p.x},${p.y} C${c.x},${c.y} ${connecting.x},${connecting.y} ${connecting.x},${connecting.y}" marker-end="url(#arrow)"/>`
        : `<path class="connecting" d="M${connecting.x},${connecting.y} C${connecting.x},${connecting.y} ${c.x},${c.y} ${p.x},${p.y}" marker-end="url(#arrow)"/>`;
    }
  }
  if (marquee) {
    const r = rectOf(marquee);
    out += `<rect class="marquee" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
  }
  out += `</g>`;

  if (!doc.nodes.length) {
    const r = svg.getBoundingClientRect();
    out += `<g class="empty-hint" transform="translate(${r.width / 2} ${r.height / 2})"><text class="big" y="-8">Nothing drawn yet</text><text y="16">Drag a shape in from the palette on the left, or right-click the canvas to add one</text></g>`;
  }
  svg.innerHTML = out;
  zoomPct.textContent = `${Math.round(view.k * 100)}%`;
  placeEdgebar(selEdge, selEdge && mids.get(selEdge.id));
}

// ---- the bar over a selected wire ------------------------------------------------------------
// Smooth or square, and the status colour: the two things one changes on a wire while looking at
// it. It floats just above the pill and follows the wire while nodes move.
const edgebar = document.getElementById('edgebar');
function placeEdgebar(e, mid) {
  if (!e || !mid) { edgebar.hidden = true; return; }
  for (const b of edgebar.querySelectorAll('[data-shape]')) b.classList.toggle('on', (e.shape === 'square' ? 'square' : 'smooth') === b.dataset.shape);
  for (const b of edgebar.querySelectorAll('[data-color]')) b.classList.toggle('on', (e.color ?? '') === b.dataset.color);
  for (const b of edgebar.querySelectorAll('[data-straight]')) b.hidden = !e.via;
  edgebar.hidden = false;
  const { view } = store, r = svg.getBoundingClientRect(), w = edgebar.offsetWidth, h = edgebar.offsetHeight;
  const sx = view.x + mid[0] * view.k, sy = view.y + (mid[1] - 10) * view.k;
  edgebar.style.left = `${Math.max(8, Math.min(r.width - w - 8, sx - w / 2))}px`;
  edgebar.style.top = `${Math.max(8, Math.min(r.height - h - 8, sy - h - 10))}px`;
}
edgebar.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  const id = store.selection?.id;
  commit((d) => {
    const e = d.edges.find((e) => e.id === id);
    if (!e) return;
    if (b.dataset.shape) { if (b.dataset.shape === 'square') e.shape = 'square'; else delete e.shape; }
    if (b.dataset.color != null) { if (b.dataset.color) e.color = b.dataset.color; else delete e.color; }
    if (b.dataset.straight != null) delete e.via;
  });
});
edgebar.addEventListener('pointerdown', (ev) => ev.stopPropagation());

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
  const handle = ev.target.closest('[data-handle]');
  const nodeEl = ev.target.closest('[data-node]');
  const edgeEl = ev.target.closest('[data-edge]');
  if (handle) {
    // One end of the selected wire is picked up; the other end stays where it is.
    const e = store.doc.edges.find((x) => x.id === handle.dataset.edge);
    if (!e) return;
    const toEnd = handle.dataset.handle === 'to';
    connecting = { node: toEnd ? e.from : e.to, side: toEnd ? side(e.fromSide, 'right') : side(e.toSide, 'left'), end: toEnd ? 'to' : 'from', edge: e.id, x: w.x, y: w.y, hit: null };
    drag = { mode: 'connect' };
    svg.classList.add('connecting');
    render();
  } else if (port) {
    connecting = { node: port.dataset.port, side: port.dataset.side, end: 'to', edge: null, x: w.x, y: w.y, hit: null };
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
    const id = edgeEl.dataset.edge;
    // A wire that is already selected is picked up: dragging it pulls it through wherever it is dropped.
    if (store.selection?.type === 'edge' && store.selection.id === id) drag = { mode: 'bend', id, start: w, moved: false };
    else { select({ type: 'edge', id }); drag = { mode: 'none' }; }
  } else {
    // Dragging on empty canvas draws a rubber band. Shift keeps what was already selected and adds
    // to it; without Shift a plain click clears the selection, as it always did.
    marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    drag = { mode: 'marquee', add: ev.shiftKey ? selectedNodeIds() : [], moved: false };
  }
});
svg.addEventListener('auxclick', (ev) => ev.preventDefault());
// A drag across the drawing must never turn into the browser's own text selection or a native
// drag of it: the latter cancels the pointer mid-move and the node is left behind.
svg.addEventListener('selectstart', (ev) => ev.preventDefault());
svg.addEventListener('dragstart', (ev) => ev.preventDefault());

/** The node under the pointer, other than the one a connection starts from. */
function nodeUnder(ev, except) {
  const id = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-node]')?.dataset.node;
  return id && id !== except ? id : null;
}

/**
 * Where a wire would land: the nearest dot within reach of the pointer, or, when the pointer is
 * over a node's body, that node's nearest side. Dropping anywhere on a box still connects.
 */
function landing(ev, w, except) {
  const near = (g) => SIDES.map((s) => { const p = portAt(g, s); return { s, d: Math.hypot(p.x - w.x, p.y - w.y) }; }).sort((a, b) => a.d - b.d)[0];
  let best = null;
  for (const n of store.doc.nodes) {
    if (n.id === except) continue;
    const c = near(geom(n));
    if (!best || c.d < best.d) best = { to: n.id, toSide: c.s, d: c.d };
  }
  if (best && best.d <= 18 / store.view.k) return { node: best.to, side: best.toSide };
  const over = nodeUnder(ev, except);
  if (!over) return null;
  return { node: over, side: near(geom(store.doc.nodes.find((n) => n.id === over))).s };
}

let pointer = null; // last world position of the pointer over the canvas, where a paste lands
svg.addEventListener('pointerleave', () => { pointer = null; });
svg.addEventListener('pointermove', (ev) => { pointer = toWorld(ev); });

// Moves and releases are watched on the window, not the canvas: the pointer is captured on the
// press, but if the browser ever lets go of it the drag still follows the pointer and still ends
// on the release, wherever that lands.
window.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  last = { clientX: ev.clientX, clientY: ev.clientY, altKey: ev.altKey };
  dragTo(ev);
  if (!panRaf && drag.mode !== 'pan' && drag.mode !== 'none' && edgePush(ev)) panRaf = requestAnimationFrame(edgePan);
});

// A wire, a node or a band dragged to the edge of the window pans the view that way, faster the
// further out the pointer goes, so a far-off node can be reached without letting go.
let last = null, panRaf = 0;
const EDGE = 28;
function edgePush(ev) {
  const r = svg.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
  const x = px < EDGE ? px - EDGE : px > r.width - EDGE ? px - (r.width - EDGE) : 0;
  const y = py < EDGE ? py - EDGE : py > r.height - EDGE ? py - (r.height - EDGE) : 0;
  return x || y ? { x, y } : null;
}
function edgePan() {
  panRaf = 0;
  const push = drag && last && edgePush(last);
  if (!push) return;
  const step = (v) => Math.sign(v) * Math.min(16, 2 + Math.abs(v) / 3);
  store.view.x -= step(push.x); store.view.y -= step(push.y);
  dragTo(last);
  panRaf = requestAnimationFrame(edgePan);
}

/** Move whatever is being dragged to where the pointer is. */
function dragTo(ev) {
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
    // While the pointer is down only the drawing follows it; the scenarios, the table and the
    // panel are told once, on the drop, so a fast drag on a big flow keeps up with the mouse.
    const place = ev.altKey ? Math.round : snap;
    const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    for (const s of drag.nodes) { const n = store.doc.nodes.find((n) => n.id === s.id); if (n) { n.x = place(s.x + dx); n.y = place(s.y + dy); } }
    render();
  } else if (drag.mode === 'bend') {
    if (!drag.moved) { if (Math.hypot(w.x - drag.start.x, w.y - drag.start.y) * store.view.k < 3) return; drag.moved = true; mark(); svg.classList.add('moving'); }
    const e = store.doc.edges.find((e) => e.id === drag.id);
    if (e) { const place = ev.altKey ? Math.round : snap; e.via = { x: place(w.x), y: place(w.y) }; render(); }
  } else if (drag.mode === 'marquee') {
    marquee.x1 = w.x; marquee.y1 = w.y;
    if (!drag.moved && Math.abs(w.x - marquee.x0) * store.view.k + Math.abs(w.y - marquee.y0) * store.view.k > 3) { drag.moved = true; svg.classList.add('selecting'); }
    if (drag.moved) render();
  } else if (drag.mode === 'connect') {
    connecting.x = w.x; connecting.y = w.y;
    connecting.hit = landing(ev, w, connecting.node);
    render();
  }
}

/** The drag is over: on a release it lands, on a cancel (the browser took the pointer) it is dropped where it stands. */
function endDrag(ev, cancelled) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (panRaf) { cancelAnimationFrame(panRaf); panRaf = 0; }
  svg.classList.remove('dragging', 'moving', 'connecting', 'selecting');
  if ((d.mode === 'node' || d.mode === 'bend') && d.moved) commit(() => {}, { quiet: true });   // the change is in place; now tell everyone
  if (d.mode === 'marquee') {
    const caught = d.moved && !cancelled ? nodesIn(marquee) : [];
    marquee = null;
    if (cancelled) render();
    else if (!d.moved) select(null);
    else if (caught.length || d.add.length) selectNodes([...d.add, ...caught]);
    else { select(null); render(); }
  }
  if (d.mode === 'connect') {
    const c = connecting;
    if (!cancelled) c.hit = landing(ev, toWorld(ev), c.node);
    connecting = null;
    if (!c.hit || cancelled) { render(); return; }
    // The default sides (out of the right, into the left) are left unwritten so a file stays terse.
    const setSide = (e, key, v, dflt) => { if (v === dflt) delete e[key]; else e[key] = v; };
    if (c.edge) {
      commit((doc) => {
        const e = doc.edges.find((e) => e.id === c.edge);
        if (!e) return;
        if (c.end === 'to') { e.to = c.hit.node; setSide(e, 'toSide', c.hit.side, 'left'); }
        else { e.from = c.hit.node; setSide(e, 'fromSide', c.hit.side, 'right'); }
      });
    } else {
      const id = uid('e');
      const e = { id, from: c.node, to: c.hit.node, when: '' };
      setSide(e, 'fromSide', c.side, 'right'); setSide(e, 'toSide', c.hit.side, 'left');
      commit((doc) => { doc.edges.push(e); });
      select({ type: 'edge', id });
    }
  }
}
window.addEventListener('pointerup', (ev) => endDrag(ev, false));
window.addEventListener('pointercancel', (ev) => endDrag(ev, true));

svg.addEventListener('dblclick', (ev) => {
  const edgeEl = ev.target.closest('[data-edge]');
  if (edgeEl) {
    // A double-click straightens a wire that was pulled.
    const id = edgeEl.dataset.edge;
    if (store.doc.edges.find((e) => e.id === id)?.via) commit((d) => { delete d.edges.find((e) => e.id === id).via; });
    return;
  }
  const nodeEl = ev.target.closest('[data-node]');
  if (nodeEl) {
    // The node is already selected by the pointerdown; the inspector has rendered its fields by
    // the time the next tick runs, so put the cursor straight into the label.
    if (!(store.selection?.type === 'node' && !store.selection.ids && store.selection.id === nodeEl.dataset.node)) select({ type: 'node', id: nodeEl.dataset.node });
    setTimeout(() => { const el = document.querySelector('#inspector [data-node="label"]'); if (el) { el.focus(); el.select?.(); } }, 0);
  }
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
palette.addEventListener('dragstart', (ev) => ev.preventDefault());
window.addEventListener('pointermove', (ev) => {
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
window.addEventListener('pointerup', (ev) => {
  if (!placing) return;
  const { kind, moved } = placing;
  endPlacing();
  if (!moved) addNode(kind);
  else if (overCanvas(ev)) { const w = toWorld(ev); addNode(kind, snap(w.x - OFFSET.x), snap(w.y - OFFSET.y)); }
});
window.addEventListener('pointercancel', () => { if (placing) endPlacing(); });

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

const GAPY = 36;   // between boxes in a column; a long wire crossing the column keeps a lane this wide too

/** Where the smooth wire from port p (leaving along na) to port q (entering along nb) is at x: the curve edgePath draws, solved for t. */
function wireY(p, q, na, nb, x) {
  const d = reach(p, q);
  const bez = (a, c1, c2, b, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t * t * c2 + t ** 3 * b;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const t = (lo + hi) / 2; if (bez(p.x, p.x + na[0] * d, q.x + nb[0] * d, q.x, t) < x) lo = t; else hi = t; }
  return bez(p.y, p.y + na[1] * d, q.y + nb[1] * d, q.y, (lo + hi) / 2);
}

/** How wide the pill on a wire is drawn, so columns can leave room for it. */
function pillWidth(e) {
  const full = e.label?.trim() || (e.else ? 'else' : e.when?.trim() || '');
  return full ? Math.min(full.length, 34) * 6.6 + 14 : 0;
}

/**
 * Lay the flow out left to right. Layers are the longest path from the start (so a node sits to
 * the right of everything that can lead to it). Rows within a layer are ordered by where their
 * neighbours sit so wires seldom cross, then each node is pulled level with what leads to it, so
 * the main path runs straight. A wire that skips layers is sent out of the bottom of its source
 * and into the bottom of its target, a bypass under the flow, and holds a lane in every column it
 * crosses so nothing is laid on top of it. Columns leave room for the widest pill on the wires
 * between them. A loop is a finding, not a layout problem: the edge that would walk back onto the
 * path is simply ignored here. Every other wire goes back to leaving right and entering left. One
 * undo step.
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

  // The layered graph: the nodes, plus a placeholder in every layer a long wire passes through.
  const layers = [];
  const put = (l, id) => (layers[l] ??= []).push(id);
  for (const id of ids) put(layer.get(id), id);
  const before = new Map(), after = new Map();
  const link = (a, b) => { (after.get(a) ?? after.set(a, []).get(a)).push(b); (before.get(b) ?? before.set(b, []).get(b)).push(a); };
  let lanes = 0;
  const chains = [];   // each long wire: its ends and the lanes it holds, in layer order
  for (const id of ids) for (const t of fwd.get(id)) {
    let prev = id;
    const held = [];
    for (let l = layer.get(id) + 1; l < layer.get(t); l++) { const v = `~${lanes++}`; put(l, v); link(prev, v); held.push(v); prev = v; }
    link(prev, t);
    if (held.length) chains.push({ from: id, to: t, lanes: held });
  }

  // Barycentre ordering: a few sweeps down (by predecessors) and up (by successors).
  const row = new Map();
  const place = (L) => L.forEach((id, i) => row.set(id, i));
  layers.forEach(place);
  const bary = (id, nbrs) => nbrs.length ? nbrs.reduce((s, x) => s + row.get(x), 0) / nbrs.length : row.get(id);
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    for (const L of down ? layers : [...layers].reverse()) {
      const key = new Map(L.map((id) => [id, bary(id, (down ? before : after).get(id) ?? [])]));
      L.sort((a, b) => key.get(a) - key.get(b));
      place(L);
    }
  }

  const gs = new Map(doc.nodes.map((n) => [n.id, geom(n)]));
  const lane = (id) => id.startsWith('~');
  const W = (id) => (gs.get(id)?.w ?? 0);

  // Columns: as wide as the widest box, then a gap that fits the widest pill on a wire leaving it.
  const xs = [], colW = [];
  let x = 40;
  layers.forEach((L, li) => {
    xs[li] = x; colW[li] = Math.max(...L.map(W));
    const pill = Math.max(0, ...doc.edges.filter((e) => layer.get(e.from) === li && layer.get(e.to) > li).map(pillWidth));
    x += snap(colW[li] + Math.max(80, pill + 40));
  });

  // Rows: each node wants to sit level with the middle of what leads to it. Down the column the
  // wants are honoured in order, pushing apart only as far as the boxes need; then the boxes shift
  // so they sit, on average, where they wanted to be. A lane is pinned where its wire really
  // crosses the column (a band as tall as the wire's slope there), and the boxes on either side
  // make way for it. The wire's course depends on where its ends land, so this is run a few times.
  const pins = new Map();   // lane → { y, h }
  const H = (id) => (gs.get(id)?.h ?? pins.get(id)?.h ?? 12);
  const cy = new Map();
  for (let pass = 0; pass < 3; pass++) {
    cy.clear();
    for (const L of layers) {
      // A box is pulled by the boxes that lead to it, never by a lane: the lane only keeps its band clear.
      const wants = L.map((id) => { if (pins.has(id)) return pins.get(id).y; const ps = (before.get(id) ?? []).filter((p) => cy.has(p) && (lane(id) || !lane(p))); return ps.length ? ps.reduce((s, p) => s + cy.get(p), 0) / ps.length : null; });
      const known = wants.filter((w) => w != null);
      const fallback = known.length ? known.reduce((s, w) => s + w, 0) / known.length : 0;
      const idx = L.map((_, i) => i).sort((a, b) => (wants[a] ?? fallback) - (wants[b] ?? fallback) || a - b);
      const ordered = idx.map((i) => L[i]), want = idx.map((i) => wants[i] ?? fallback);
      L.splice(0, L.length, ...ordered);
      let bottom = -Infinity;
      const got = L.map((id, i) => { const c = lane(id) ? want[i] : Math.max(want[i], bottom + GAPY + H(id) / 2); bottom = c + H(id) / 2; return c; });
      const boxes = L.map((id, i) => i).filter((i) => !lane(L[i]));
      const shift = boxes.length ? boxes.reduce((s, i) => s + (want[i] - got[i]), 0) / boxes.length : 0;
      for (const i of boxes) got[i] += shift;
      // A box the shift pushed onto a lane is moved off it: down on the way down, up on the way back.
      for (let i = 1; i < L.length; i++) if (!lane(L[i])) got[i] = Math.max(got[i], got[i - 1] + H(L[i - 1]) / 2 + GAPY + H(L[i]) / 2);
      for (let i = L.length - 2; i >= 0; i--) if (!lane(L[i])) got[i] = Math.min(got[i], got[i + 1] - H(L[i + 1]) / 2 - GAPY - H(L[i]) / 2);
      L.forEach((id, i) => cy.set(id, got[i]));
    }
    // Where each bypass will run, in the shape it is drawn: a square one is level with the deeper
    // of its two stubs, a smooth one follows its curve.
    for (const c of chains) {
      const p = portAt({ ...gs.get(c.from), x: xs[layer.get(c.from)], cx: xs[layer.get(c.from)] + W(c.from) / 2, cy: cy.get(c.from), y: cy.get(c.from) - H(c.from) / 2 }, 'bottom');
      const q = portAt({ ...gs.get(c.to), x: xs[layer.get(c.to)], cx: xs[layer.get(c.to)] + W(c.to) / 2, cy: cy.get(c.to), y: cy.get(c.to) - H(c.to) / 2 }, 'bottom');
      const square = doc.edges.some((e) => e.from === c.from && e.to === c.to && e.shape === 'square');
      c.lanes.forEach((v, k) => {
        const l = layer.get(c.from) + 1 + k;
        if (square) { pins.set(v, { y: Math.max(p.y, q.y) + STUB, h: 12 }); return; }
        const y1 = wireY(p, q, NORMAL.bottom, NORMAL.bottom, xs[l]), y2 = wireY(p, q, NORMAL.bottom, NORMAL.bottom, xs[l] + colW[l]);
        pins.set(v, { y: (y1 + y2) / 2, h: Math.abs(y2 - y1) + 12 });
      });
    }
  }

  const pos = new Map(ids.map((id) => [id, { x: xs[layer.get(id)], y: snap(cy.get(id) - H(id) / 2) }]));
  const minY = Math.min(...[...pos.values()].map((p) => p.y));
  commit((d) => {
    for (const n of d.nodes) { const p = pos.get(n.id); if (p) { n.x = p.x; n.y = p.y - minY + 40; } }
    const bypass = new Set(chains.map((c) => `${c.from}>${c.to}`));
    for (const e of d.edges) {
      delete e.fromSide; delete e.toSide; delete e.via;
      if (bypass.has(`${e.from}>${e.to}`)) { e.fromSide = 'bottom'; e.toSide = 'bottom'; }
    }
  });
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
    edges: store.doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ ...structuredClone(e), ...(e.via && { via: { x: e.via.x - x0, y: e.via.y - y0 } }) })),
    w, h, origin: { x: x0, y: y0 },
  };
}

/** Put a bundle on the canvas with its top-left at (x, y), fresh ids throughout, and select it. */
function place(bundle, x, y) {
  const ids = new Map(bundle.nodes.map((n) => [n.id, uid('n')]));
  commit((d) => {
    for (const n of bundle.nodes) d.nodes.push({ ...structuredClone(n), id: ids.get(n.id), x: snap(x + n.x), y: snap(y + n.y) });
    for (const e of bundle.edges) d.edges.push({ ...structuredClone(e), id: uid('e'), from: ids.get(e.from), to: ids.get(e.to), ...(e.via && { via: { x: snap(x + e.via.x), y: snap(y + e.via.y) } }) });
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
