// One place the document lives. Every change goes through `commit`, which snapshots for undo,
// replays every scenario (cheap: it is a walk over a drawing), lints, saves, and tells the views.
import { runAll, lint } from '../lib/run.mjs';

const KEY = 'playthrough.doc';
const DIRTY = 'playthrough.dirty';
const FILE = 'playthrough.file';

export const uid = (p) => p + Math.random().toString(36).slice(2, 8);

export function emptyDoc(name = 'Untitled flow') {
  return { name, description: '', inputs: [], state: [], nodes: [], edges: [], scenarios: [] };
}

export const store = {
  doc: emptyDoc(),
  selection: null,          // { type: 'node'|'edge'|'scenario', id } — a node selection may carry `ids` for a group; `id` is its first member; a scenario's `open` shows it in the panel
  view: { x: 40, y: 40, k: 1 },
  showCoverage: false,
  tagFilter: null,          // a tag the scenario table is narrowed to, or null for every row
  playhead: null,           // when animating: number of steps revealed
  results: null,            // from runAll
  problems: [],             // from lint
  dirty: false,             // changed since the last Save / Open / Import / New (autosave does not count)
  file: null,               // the project file this flow lives in, when the server has a project folder
  mtime: null,              // that file's modification time as last read or written, so a save can notice a change on disk
  undo: [], redo: [],
  listeners: new Set(),
};

export function subscribe(fn) { store.listeners.add(fn); return () => store.listeners.delete(fn); }
export function emit() { for (const fn of store.listeners) fn(store); }

export function recompute() {
  store.results = runAll(store.doc);
  store.problems = lint(store.doc);
}

/** Change the document. `quiet` skips the undo snapshot (used while dragging). */
export function commit(mutate, { quiet = false } = {}) {
  if (!quiet) { store.undo.push(JSON.stringify(store.doc)); if (store.undo.length > 100) store.undo.shift(); store.redo = []; }
  mutate(store.doc);
  recompute();
  save();
  setDirty(true);
  emit();
}

/** Dirty means "not in a file yet"; it survives a reload with the autosaved doc. */
export function setDirty(v) { store.dirty = v; try { localStorage.setItem(DIRTY, v ? '1' : ''); } catch {} }

/** A snapshot before a drag, so the whole drag is one undo step. */
export function mark() { store.undo.push(JSON.stringify(store.doc)); store.redo = []; }

export function undo() {
  if (!store.undo.length) return;
  store.redo.push(JSON.stringify(store.doc));
  store.doc = JSON.parse(store.undo.pop());
  setDirty(true);
  afterLoad();
}
export function redo() {
  if (!store.redo.length) return;
  store.undo.push(JSON.stringify(store.doc));
  store.doc = JSON.parse(store.redo.pop());
  setDirty(true);
  afterLoad();
}

/** A whole new document (New, Open…, Import, a preset, a dropped file, a link): clean until edited. */
export function load(doc, { keepHistory = false } = {}) {
  store.doc = normalize(doc);
  if (!keepHistory) { store.undo = []; store.redo = []; }
  store.selection = null;
  store.playhead = null;
  setDirty(false);
  afterLoad();
}

function afterLoad() {
  pruneSelection();
  recompute(); save(); emit();
}

export function select(sel) { store.selection = sel; store.playhead = null; emit(); }

/**
 * Select a scenario. Picking a row only selects it, so its path shows on the canvas and the table
 * keeps the room; the panel shows it when asked (`open`, a double-click) or when the panel is
 * already on a scenario, so going down the rows with it open keeps it open.
 */
export function selectScenario(id, open = false) {
  const s = store.selection;
  select({ type: 'scenario', id, open: open || (s?.type === 'scenario' && Boolean(s.open)) });
}
/** Is the side panel showing? For anything selected but a scenario that has not been opened. */
export function panelOpen() { const s = store.selection; return Boolean(s) && (s.type !== 'scenario' || Boolean(s.open)); }

/** Select a group of nodes: one is a plain node selection, several carry `ids`, none clears it. */
export function selectNodes(ids) {
  ids = [...new Set(ids)].filter((id) => store.doc.nodes.some((n) => n.id === id));
  select(!ids.length ? null : ids.length === 1 ? { type: 'node', id: ids[0] } : { type: 'node', id: ids[0], ids });
}
/** Every selected node id; empty unless nodes are selected. */
export function selectedNodeIds() { const s = store.selection; return s?.type !== 'node' ? [] : (s.ids ?? [s.id]); }
export function isSelectedNode(id) { return selectedNodeIds().includes(id); }

export function exists(sel) {
  if (!sel) return false;
  if (sel.type === 'flow') return true;   // the flow itself: its scenarios, inputs and state
  const list = sel.type === 'node' ? store.doc.nodes : sel.type === 'edge' ? store.doc.edges : store.doc.scenarios;
  return list.some((x) => x.id === sel.id);
}

/** After undo, a load or a delete some selected nodes may be gone: keep the ones that remain. */
function pruneSelection() {
  const s = store.selection;
  if (s?.type === 'node' && s.ids) {
    const ids = s.ids.filter((id) => store.doc.nodes.some((n) => n.id === id));
    store.selection = !ids.length ? null : ids.length === 1 ? { type: 'node', id: ids[0] } : { type: 'node', id: ids[0], ids };
  } else if (s && !exists(s)) store.selection = null;
}

export function save() { try { localStorage.setItem(KEY, JSON.stringify(store.doc)); } catch {} }
export function restore() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
export function restoreDirty() { try { return localStorage.getItem(DIRTY) === '1'; } catch { return false; } }

/** Which project file the page is on (null: none). Remembered so a reload lands on the same flow. */
export function setFile(file, mtime = null) {
  store.file = file; store.mtime = mtime;
  try { if (file) localStorage.setItem(FILE, JSON.stringify({ file, mtime })); else localStorage.removeItem(FILE); } catch {}
}
export function restoreFile() { try { return JSON.parse(localStorage.getItem(FILE)) ?? null; } catch { return null; } }

/** Tolerate hand-written files: missing lists, missing ids, stray fields. */
export function normalize(doc) {
  const d = { ...emptyDoc(), ...doc };
  for (const k of ['inputs', 'state', 'nodes', 'edges', 'scenarios']) if (!Array.isArray(d[k])) d[k] = [];
  for (const n of d.nodes) { n.id ??= uid('n'); n.kind ??= 'action'; n.label ??= ''; n.x ??= 0; n.y ??= 0; }
  for (const e of d.edges) { e.id ??= uid('e'); e.when ??= ''; }
  for (const s of d.scenarios) { s.id ??= uid('s'); s.name ??= ''; s.inputs ??= {}; s.expect ??= {}; s.expect.actions ??= []; s.expect.state ??= {}; s.tags = parseTags(Array.isArray(s.tags) ? s.tags.join(',') : s.tags); if (s.note != null) { s.description ??= s.note; delete s.note; } }
  return d;
}

/** "edge, PROJ-12 ,edge" → ["edge", "PROJ-12"]: comma-separated, trimmed, no repeats, order kept. */
export function parseTags(text) {
  const out = [];
  for (const t of String(text ?? '').split(',')) { const v = t.trim(); if (v && !out.includes(v)) out.push(v); }
  return out;
}

/** Every tag in the document with how its scenarios did, in first-seen order. */
export function tagSummary(doc, results) {
  const map = new Map();
  for (const s of doc.scenarios ?? []) {
    const r = results?.results.find((x) => x.scenario.id === s.id);
    for (const t of s.tags ?? []) { const e = map.get(t) ?? { tag: t, total: 0, passed: 0 }; e.total++; if (r?.verdict.pass) e.passed++; map.set(t, e); }
  }
  return [...map.values()];
}

/** The result for the selected scenario, if a scenario is selected. */
export function activeRun() {
  if (store.selection?.type !== 'scenario' || !store.results) return null;
  return store.results.results.find((r) => r.scenario.id === store.selection.id) ?? null;
}

/**
 * Rename an input or state field everywhere the document mentions it: edge guards, the `set`
 * expressions and field names on nodes, the inputs and expected state of every scenario. Pure:
 * mutates and returns `doc`, so a caller wraps it in one `commit` and the rename is one undo step.
 * Nothing happens for a malformed new name, so a half-typed name never scrambles the guards.
 */
export function renameName(doc, from, to) {
  if (!from || from === to || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) return doc;
  const rekey = (o) => { if (!o || !(from in o)) return o; const out = {}; for (const [k, v] of Object.entries(o)) out[k === from ? to : k] = v; return out; };
  for (const e of doc.edges ?? []) if (e.when) e.when = rewrite(e.when, from, to);
  for (const n of doc.nodes ?? []) if (n.set) { n.set = rekey(n.set); for (const k of Object.keys(n.set)) n.set[k] = rewrite(n.set[k] ?? '', from, to); }
  for (const s of doc.scenarios ?? []) { s.inputs = rekey(s.inputs); if (s.expect) s.expect.state = rekey(s.expect.state); }
  return doc;
}

/**
 * `from` becomes `to` in an expression wherever it stands as a whole identifier, or as the head
 * of a dotted one (`who.role` follows a rename of `who`). Quoted strings and numbers pass through,
 * and `subtype` is left alone when `type` is renamed: the match is on identifier boundaries, not
 * on substrings.
 */
export function rewrite(src, from, to) {
  return String(src).replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[0-9][A-Za-z0-9_.]*|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g,
    (m) => /^[A-Za-z_]/.test(m) && m.split('.')[0] === from ? to + m.slice(from.length) : m);
}
