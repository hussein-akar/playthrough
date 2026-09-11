// One place the document lives. Every change goes through `commit`, which snapshots for undo,
// replays every scenario (cheap: it is a walk over a drawing), lints, saves, and tells the views.
import { runAll, lint } from '../lib/run.mjs';

const KEY = 'playthrough.doc';

export const uid = (p) => p + Math.random().toString(36).slice(2, 8);

export function emptyDoc(name = 'Untitled flow') {
  return { name, description: '', inputs: [], state: [], nodes: [], edges: [], scenarios: [] };
}

export const store = {
  doc: emptyDoc(),
  selection: null,          // { type: 'node'|'edge'|'scenario', id }
  view: { x: 40, y: 40, k: 1 },
  showCoverage: false,
  playhead: null,           // when animating: number of steps revealed
  results: null,            // from runAll
  problems: [],             // from lint
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
  emit();
}

/** A snapshot before a drag, so the whole drag is one undo step. */
export function mark() { store.undo.push(JSON.stringify(store.doc)); store.redo = []; }

export function undo() {
  if (!store.undo.length) return;
  store.redo.push(JSON.stringify(store.doc));
  store.doc = JSON.parse(store.undo.pop());
  afterLoad();
}
export function redo() {
  if (!store.redo.length) return;
  store.undo.push(JSON.stringify(store.doc));
  store.doc = JSON.parse(store.redo.pop());
  afterLoad();
}

export function load(doc, { keepHistory = false } = {}) {
  store.doc = normalize(doc);
  if (!keepHistory) { store.undo = []; store.redo = []; }
  store.selection = null;
  store.playhead = null;
  afterLoad();
}

function afterLoad() {
  if (store.selection && !exists(store.selection)) store.selection = null;
  recompute(); save(); emit();
}

export function select(sel) { store.selection = sel; store.playhead = null; emit(); }

export function exists(sel) {
  if (!sel) return false;
  const list = sel.type === 'node' ? store.doc.nodes : sel.type === 'edge' ? store.doc.edges : store.doc.scenarios;
  return list.some((x) => x.id === sel.id);
}

export function save() { try { localStorage.setItem(KEY, JSON.stringify(store.doc)); } catch {} }
export function restore() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } }

/** Tolerate hand-written files: missing lists, missing ids, stray fields. */
export function normalize(doc) {
  const d = { ...emptyDoc(), ...doc };
  for (const k of ['inputs', 'state', 'nodes', 'edges', 'scenarios']) if (!Array.isArray(d[k])) d[k] = [];
  for (const n of d.nodes) { n.id ??= uid('n'); n.kind ??= 'action'; n.label ??= ''; n.x ??= 0; n.y ??= 0; }
  for (const e of d.edges) { e.id ??= uid('e'); e.when ??= ''; }
  for (const s of d.scenarios) { s.id ??= uid('s'); s.name ??= ''; s.inputs ??= {}; s.expect ??= {}; s.expect.actions ??= []; s.expect.state ??= {}; }
  return d;
}

/** The result for the selected scenario, if a scenario is selected. */
export function activeRun() {
  if (store.selection?.type !== 'scenario' || !store.results) return null;
  return store.results.results.find((r) => r.scenario.id === store.selection.id) ?? null;
}
