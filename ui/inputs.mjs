// The inputs box: what the selected scenario gives the flow, as tables over the top-right of the
// drawing, beside the path it lights up. The table's cell says `3 records` and the panel shows a
// form, and neither reads at a glance as the case being played; here every input is a value next
// to its name, every list a table of its records, and under them the state as the run left it, so
// the drawing, the path and the case can be read together. Nothing here edits: the table and the
// panel do that. The box folds to the scenario's name, and stays folded until it is opened again.
import { store, activeRun } from './store.mjs';
import { parseRecords, shadows } from '../lib/run.mjs';

const el = document.getElementById('inputs');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const CHEV = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
const FOLDED = 'playthrough.inputsFolded';
let folded = false;
try { folded = localStorage.getItem(FOLDED) === '1'; } catch {}

/** A value as a cell: yes and no for a boolean, a blank said out loud, a list by its size. */
const word = (v) => (v == null || v === '' ? '<span class="muted">blank</span>'
  : typeof v === 'boolean' ? (v ? 'yes' : 'no')
  : Array.isArray(v) ? plural(v.length, 'record')
  : typeof v === 'object' ? esc(JSON.stringify(v))
  : esc(v));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A name beside its value, one row each. */
const pairs = (rows) => `<table class="pairs">${rows.map(([n, v]) => `<tr><th>${esc(n)}</th><td>${v}</td></tr>`).join('')}</table>`;

/** The records of a list: a column per field, a row per record. A list the flow did not declare fields for shows the fields its records have. */
function rows(records, fields) {
  if (!records.length) return '<div class="muted">no records</div>';
  const cols = fields.length ? fields : [...new Set(records.flatMap((r) => Object.keys(r)))];
  return `<table class="rows"><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${records.map((r) => `<tr>${cols.map((c) => `<td>${word(r[c])}</td>`).join('')}</tr>`).join('')}</table>`;
}

export function render() {
  const r = activeRun();
  el.classList.toggle('show', !!r);
  if (!r) { el.innerHTML = ''; el.written = ''; return; }
  const { doc } = store;
  const { scenario: s, result } = r;
  const read = result.inputs ?? null;   // the inputs as the run read them; null when it could not, and the text is shown as written
  const ended = result.state ?? {};
  const fieldsOf = (i) => (i.fields ?? []).filter((f) => f.name).map((f) => f.name);
  // A state field that shadows an input is one name in two roles, so it is shown once, as the
  // input, with where the run left it after an arrow when that is somewhere else.
  const left = (name) => (read && shadows(doc, name) && name in ended && !same(read[name], ended[name]) ? ` <span class="to" title="where the run left it">→ ${word(ended[name])}</span>` : '');

  const parts = [];
  const scalars = doc.inputs.filter((i) => i.name && i.type !== 'list');
  if (scalars.length) parts.push('<div class="cap">Inputs</div>' + pairs(scalars.map((i) => [i.name, (read ? word(read[i.name]) : word(s.inputs[i.name])) + left(i.name)])));
  for (const i of doc.inputs.filter((i) => i.name && i.type === 'list')) {
    let records = null, why = '';
    try { records = read ? read[i.name] : parseRecords(s.inputs[i.name], i.fields ?? []); } catch (e) { why = e.message; }
    parts.push(`<div class="cap">${esc(i.name)} · ${records ? plural(records.length, 'record') : 'could not be read'}${left(i.name)}</div>`
      + (records ? rows(records, fieldsOf(i)) : `<div class="bad">${esc(why)}</div><pre>${esc(s.inputs[i.name])}</pre>`));
  }
  // The rest of the state, as the run left it: the scalar fields in one table, each list in its own.
  const rest = read ? doc.state.filter((f) => f.name && !shadows(doc, f.name)) : [];
  const when = result.error ? 'where it stopped' : 'at the end';
  const flat = rest.filter((f) => !Array.isArray(ended[f.name]));
  if (flat.length) parts.push(`<div class="cap">State ${when}</div>` + pairs(flat.map((f) => [f.name, word(ended[f.name])])));
  for (const f of rest.filter((f) => Array.isArray(ended[f.name]))) parts.push(`<div class="cap">${esc(f.name)} · ${plural(ended[f.name].length, 'record')} ${when}</div>` + rows(ended[f.name], []));

  const head = `<div class="head" data-fold title="${folded ? 'Show the inputs' : 'Fold them away'}"><span class="name">${esc(s.name) || 'Untitled scenario'}</span><span class="chev">${CHEV}</span></div>`;
  const html = head + `<div class="list">${parts.join('') || '<div class="muted">The flow declares no inputs yet.</div>'}</div>`;
  el.classList.toggle('folded', folded);
  // Written only when it changed: play re-renders on every step, and the list should not lose its scroll to that.
  if (el.written !== html) { el.innerHTML = html; el.written = html; }
}

el.addEventListener('click', (ev) => {
  if (!ev.target.closest('[data-fold]')) return;
  folded = !folded;
  try { localStorage.setItem(FOLDED, folded ? '1' : ''); } catch {}
  render();
});
