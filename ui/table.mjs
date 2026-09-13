// The spreadsheet, kept: one row per scenario, a column per input, then what should happen. The
// verdict sits at the end of the row and updates as you type, because the run is free.
import { store, commit, select, selectScenario, emit, uid, parseTags, tagSummary } from './store.mjs';
import { inputControl, editing, acceptRun } from './inspector.mjs';
import { parseRecords } from '../lib/run.mjs';

const table = document.getElementById('table');
const tagBar = document.getElementById('tagBar');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const expanded = new Set();   // scenario ids whose result cell shows every issue, not just the first
const svg = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  play: svg('<path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke-width="1.2"/>'),
  edit: svg('<path d="M11.5 2.5l2 2L5 13H3v-2z"/>'),
  dup: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"/>'),
  rm: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
};
const GRIP = `<svg viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg>`;

// What the table's columns and rows are built from. While this is unchanged (a selection change,
// a keystroke, an undo of a value) the existing rows are patched in place; rebuilding them would
// pull the control out from under the pointer, and a click on a button in an unselected row
// would be lost to the rebuild that selecting the row triggers.
let shape = '';
function shapeOf(doc) {
  return JSON.stringify([doc.scenarios.map((s) => s.id), doc.inputs.map((i) => [i.name, i.type, i.values]), doc.state.map((f) => f.name), doc.nodes.filter((n) => n.kind === 'end').map((n) => n.label)]);
}

export function render() {
  const { doc, results, selection } = store;
  renderTagBar();
  const key = shapeOf(doc);
  if ((key === shape && table.querySelector('tr[data-row]')) || editing(table)) { patch(); return; }
  shape = key;
  if (!doc.scenarios.length) {
    table.innerHTML = `<tr><td class="empty">No scenarios yet. Add one and fill in its inputs; the row turns green or red as you type.</td></tr>`;
    return;
  }
  const ends = doc.nodes.filter((n) => n.kind === 'end').map((n) => n.label);
  // The tags column appears once a scenario has a tag (given in its panel): until then it is noise.
  const tagged = doc.scenarios.some((s) => s.tags?.length);
  let html = `<thead><tr><th>#</th><th>Scenario</th>${tagged ? '<th>tags</th>' : ''}${doc.inputs.map((i) => `<th>${esc(i.name)}</th>`).join('')}
    <th class="expect">lands on</th>${doc.state.map((f) => `<th class="expect">${esc(f.name)}</th>`).join('')}<th>result</th><th></th></tr></thead><tbody>`;
  doc.scenarios.forEach((s, k) => {
    const active = selection?.type === 'scenario' && selection.id === s.id;
    html += `<tr class="row ${active ? 'active' : ''}" data-row="${s.id}">
      <td class="num"><span class="grip" title="Drag to move this scenario">${GRIP}</span><span class="n">${k + 1}</span></td>
      <td><input type="text" class="name" data-f="name" value="${esc(s.name)}" placeholder="what is being tried"></td>
      ${tagged ? `<td><input type="text" class="tags" data-f="tags" value="${esc((s.tags ?? []).join(', '))}" placeholder="edge, PROJ-12" title="Tags, comma-separated"></td>` : ''}
      ${doc.inputs.map((i) => (i.type === 'list' ? `<td class="list" data-list="${esc(i.name)}">${listCell(i, s)}</td>` : `<td>${inputControl(i, s.inputs[i.name], `data-input="${esc(i.name)}"`, true)}</td>`)).join('')}
      <td class="expect"><select data-f="end"><option value="">any</option>${ends.map((e) => `<option value="${esc(e)}" ${s.expect.end === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></td>
      ${doc.state.map((f) => `<td class="expect"><input type="text" class="st expr" data-state="${esc(f.name)}" value="${esc(s.expect.state?.[f.name] ?? '')}" placeholder="*, null, value, == 1" title="* any value · null · the value · a check such as == 1, size > 0, count(notices where linked) == 1"></td>`).join('')}
      <td class="result">${status(s, results)}</td>
      <td class="tools"><button class="small icon play" data-act="play" title="Play it step by step on the canvas (Space)">${ICON.play}</button><button class="small icon" data-act="edit" title="Open it in the panel (double-click the row)">${ICON.edit}</button><button class="small icon" data-act="dup" title="Duplicate">${ICON.dup}</button><button class="small icon danger" data-act="rm" title="Delete">${ICON.rm}</button></td>
    </tr>`;
  });
  table.innerHTML = html + '</tbody>';
  narrow();
}

/** Rows outside the tag filter are hidden, not rebuilt, so the filter is free to flick on and off. */
function narrow() {
  const { doc, tagFilter } = store;
  if (tagFilter && !doc.scenarios.some((s) => s.tags?.includes(tagFilter))) { store.tagFilter = null; }   // the last row with that tag went away
  for (const tr of table.querySelectorAll('tr[data-row]')) {
    const s = doc.scenarios.find((s) => s.id === tr.dataset.row);
    tr.hidden = Boolean(store.tagFilter) && !(s?.tags ?? []).includes(store.tagFilter);
  }
}

/** Every tag, with its pass count; the active one narrows the table. Nothing is shown when nobody tagged anything. */
function renderTagBar() {
  const { doc, results, tagFilter } = store;
  const tags = tagSummary(doc, results);
  const html = !tags.length ? '' : tags.map((t) => `<button class="chip tag ${t.tag === tagFilter ? 'on' : ''}" data-tag="${esc(t.tag)}" title="${t.tag === tagFilter ? 'Show every scenario' : `Only the scenarios tagged ${esc(t.tag)}`}">${esc(t.tag)} <b class="${t.passed === t.total ? 'ok' : 'bad'}">${t.passed}/${t.total}</b></button>`).join('')
    + (tagFilter ? `<button class="link" data-tag="" title="Show every scenario">show all</button>` : '');
  if (tagBar.written !== html) { tagBar.innerHTML = html; tagBar.written = html; }
}
tagBar.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-tag]');
  if (!b) return;
  b.blur();
  store.tagFilter = b.dataset.tag && b.dataset.tag !== store.tagFilter ? b.dataset.tag : null;
  emit();
});

function resultFor(s, results) { return results?.results.find((r) => r.scenario.id === s.id); }

/**
 * A list input's records, counted: their values side by side do not read in a table cell, so the
 * cell says how many there are, the tooltip lists them, and they are edited in the panel, where
 * each is a row of controls. Double-clicking the row opens the panel on them.
 */
function listCell(i, s) {
  const value = s.inputs[i.name];
  let records;
  try { records = parseRecords(value, i.fields ?? []); }
  catch (e) { return `<span class="bad" title="${esc(e.message)}">could not be read · fix in the panel</span>`; }
  if (!records.length) return `<span class="muted" title="Double-click the row and add records in the panel">no records</span>`;
  const word = (v) => (v == null || v === '' ? '∅' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
  const fields = (i.fields ?? []).map((f) => f.name);
  return `<span class="recs" title="${esc(records.map((r) => fields.map((f) => `${f}=${word(r[f])}`).join(', ')).join('\n'))}">${records.length} record${records.length === 1 ? '' : 's'}</span>`;
}

function status(s, results) {
  const r = resultFor(s, results);
  if (!r) return '';
  if (r.verdict.pass) return `<span class="status ok">✓ pass</span>`;
  const issues = r.verdict.issues, open = expanded.has(s.id);
  // A stuck run has nothing worth accepting; its trouble is in the drawing, not the expectation.
  const accept = r.result.error ? '' : `<button class="small accept" data-act="accept" title="Use this run as the expectation: what happened becomes what is expected">accept run</button>`;
  // The column is narrow: the verdict and its buttons on one line, the first issue cut to the line
  // under it; a click on the issue (or +N more) lists every issue in full.
  const toggle = open ? `<span class="why more" data-act="more">show less</span>` : issues.length > 1 ? `<span class="why more" data-act="more" title="Show every issue">+${issues.length - 1} more</span>` : '';
  const body = open ? `<ul class="issues">${issues.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul>` : `<span class="why first" data-act="more" title="${esc(issues[0].message)}">${esc(issues[0].message)}</span>`;
  return `<span class="status ${r.result.error ? 'stuck' : 'bad'}">${r.result.error ? '⚠ stuck' : '✗ fail'}</span>${accept}${toggle}${body}`;
}

/**
 * The computed cells and every control the user is not typing into, so focus is kept. A cell is
 * only rewritten when its markup changed: the click that selected a row must land on the same
 * button it was pressed on.
 */
function patch() {
  const { doc, results, selection } = store;
  const bool = (v) => { const t = String(v ?? '').trim().toLowerCase(); return ['true', 'yes', '1'].includes(t) ? 'true' : ['false', 'no', '0'].includes(t) ? 'false' : ''; };
  for (const tr of table.querySelectorAll('tr[data-row]')) {
    const s = doc.scenarios.find((s) => s.id === tr.dataset.row);
    if (!s) continue;
    tr.classList.toggle('active', selection?.type === 'scenario' && selection.id === s.id);
    const cells = [['td.result', status(s, results)], ...doc.inputs.filter((i) => i.type === 'list').map((i) => [`td[data-list="${CSS.escape(i.name)}"]`, listCell(i, s)])];
    for (const [sel, html] of cells) { const td = tr.querySelector(sel); if (td && td.written !== html) { td.innerHTML = html; td.written = html; } }
    tr.hidden = Boolean(store.tagFilter) && !(s.tags ?? []).includes(store.tagFilter);
    for (const c of tr.querySelectorAll('input, select')) {
      if (c === document.activeElement) continue;
      const d = c.dataset;
      let v;
      if (d.f === 'name') v = s.name;
      else if (d.f === 'tags') v = (s.tags ?? []).join(', ');
      else if (d.f === 'end') v = s.expect.end ?? '';
      else if (d.input) { v = s.inputs[d.input] ?? ''; if (doc.inputs.find((i) => i.name === d.input)?.type === 'boolean') v = bool(v); }
      else if (d.state) v = s.expect.state?.[d.state] ?? '';
      else continue;
      if (c.value !== String(v)) c.value = String(v);
    }
  }
}

table.addEventListener('focusout', () => setTimeout(() => { if (!table.contains(document.activeElement)) render(); }, 0));

table.addEventListener('input', (ev) => {
  const t = ev.target, tr = t.closest('tr[data-row]');
  if (!tr) return;
  const id = tr.dataset.row;
  commit((doc) => {
    const s = doc.scenarios.find((s) => s.id === id);
    if (t.dataset.f === 'name') s.name = t.value;
    else if (t.dataset.f === 'tags') s.tags = parseTags(t.value);
    else if (t.dataset.f === 'end') s.expect.end = t.value;
    else if (t.dataset.input) s.inputs[t.dataset.input] = t.value;
    else if (t.dataset.state) { s.expect.state ??= {}; s.expect.state[t.dataset.state] = t.value; }
  });
});

table.addEventListener('pointerdown', (ev) => {
  const tr = ev.target.closest('tr[data-row]');
  if (!tr) return;
  if (!(store.selection?.type === 'scenario' && store.selection.id === tr.dataset.row)) selectScenario(tr.dataset.row);
});
// A click picks the row; a double-click opens it in the panel, where the rest of it is edited.
table.addEventListener('dblclick', (ev) => {
  const tr = ev.target.closest('tr[data-row]');
  if (!tr || ev.target.closest('button') || store.selection?.open) return;
  selectScenario(tr.dataset.row, true);
});

table.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('tr').dataset.row;
  b.blur();
  if (b.dataset.act === 'rm') { commit((doc) => { doc.scenarios = doc.scenarios.filter((s) => s.id !== id); }); if (store.selection?.id === id) select(null); }
  if (b.dataset.act === 'dup') {
    const nid = uid('s');
    commit((doc) => { const s = doc.scenarios.find((s) => s.id === id); doc.scenarios.splice(doc.scenarios.indexOf(s) + 1, 0, { ...structuredClone(s), id: nid, name: s.name + ' (copy)' }); });
    selectScenario(nid);
  }
  if (b.dataset.act === 'accept') acceptRun(id);
  if (b.dataset.act === 'play') { selectScenario(id); document.dispatchEvent(new Event('play')); }
  if (b.dataset.act === 'edit') selectScenario(id, true);
  if (b.dataset.act === 'more') { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); patch(); }
});

// A row moves by its grip: press it and drag, and the row it would land beside shows a line on
// the edge it would go (above or below, whichever half the pointer is over). Near the top or the
// bottom of the table it scrolls. Letting go puts it there, in one commit, so one undo; Escape or a
// press that never moved leaves the list alone.
{
  const scroller = table.closest('.scroll');
  let drag = null;   // { id, row, pointerId, startY, moved, target, after }
  const clearMarks = () => table.querySelectorAll('.drop-before, .drop-after').forEach((t) => t.classList.remove('drop-before', 'drop-after'));
  const stop = () => { if (!drag) return; clearMarks(); drag.row.classList.remove('dragging'); document.body.classList.remove('moving-row'); drag = null; };
  table.addEventListener('pointerdown', (ev) => {
    const grip = ev.target.closest('.grip');
    if (!grip || ev.button !== 0) return;
    ev.preventDefault();
    const row = grip.closest('tr[data-row]');
    grip.setPointerCapture(ev.pointerId);
    drag = { id: row.dataset.row, row, pointerId: ev.pointerId, startY: ev.clientY, moved: false, target: null, after: false };
  });
  table.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.abs(ev.clientY - drag.startY) < 4) return;
    if (!drag.moved) { drag.moved = true; drag.row.classList.add('dragging'); document.body.classList.add('moving-row'); }
    const box = scroller.getBoundingClientRect();
    if (ev.clientY < box.top + 36) scroller.scrollTop -= 12; else if (ev.clientY > box.bottom - 24) scroller.scrollTop += 12;
    const rows = [...table.querySelectorAll('tr[data-row]')].filter((tr) => !tr.hidden);
    const over = rows.find((tr) => { const r = tr.getBoundingClientRect(); return ev.clientY >= r.top && ev.clientY < r.bottom; })
      ?? (ev.clientY < rows[0].getBoundingClientRect().top ? rows[0] : rows[rows.length - 1]);
    const r = over.getBoundingClientRect(), after = ev.clientY > r.top + r.height / 2;
    clearMarks();
    drag.target = over.dataset.row === drag.id ? null : over.dataset.row;
    drag.after = after;
    if (drag.target) over.classList.add(after ? 'drop-after' : 'drop-before');
  });
  table.addEventListener('pointerup', (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const { id, target, after, moved } = drag;
    stop();
    if (!moved || !target) return;
    commit((doc) => {
      const [s] = doc.scenarios.splice(doc.scenarios.findIndex((x) => x.id === id), 1);
      doc.scenarios.splice(doc.scenarios.findIndex((x) => x.id === target) + (after ? 1 : 0), 0, s);
    });
  });
  table.addEventListener('pointercancel', stop);
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && drag) { ev.stopPropagation(); stop(); } }, true);
}

// Enter in the last row's name starts the next scenario, the way a spreadsheet would; Escape just
// stops editing (the row stays selected, so the panel keeps showing it). Up and down in a text
// cell go to the same cell a row up or down; a select or a number keeps its arrows for its value.
table.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (ev.key === 'Escape' && editing(table)) { ev.stopPropagation(); t.blur(); return; }
  if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && t.matches('input[type=text]') && !ev.altKey && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) {
    const tr = t.closest('tr[data-row]'), col = [...tr.children].indexOf(t.closest('td'));
    const next = step(ev.key === 'ArrowUp' ? -1 : 1, tr.dataset.row);
    ev.preventDefault();
    const c = next?.children[col]?.querySelector('input, select');
    c?.focus(); c?.select?.();
    return;
  }
  if (ev.key === 'Enter' && t.dataset.f === 'name' && !t.closest('tr[data-row]')?.nextElementSibling) { ev.preventDefault(); addScenario(); }
});

/** Select the scenario `dir` rows away from `from` (the selected one), among the rows the tag filter leaves; it scrolls into view. Its row, or null past either end. */
export function step(dir, from = store.selection?.id) {
  const rows = [...table.querySelectorAll('tr[data-row]')].filter((tr) => !tr.hidden);
  const next = rows[rows.findIndex((tr) => tr.dataset.row === from) + dir];
  if (!next) return null;
  selectScenario(next.dataset.row);
  next.scrollIntoView({ block: 'nearest' });
  return next;
}

export function addScenario() {
  const id = uid('s');
  if (editing(table)) document.activeElement.blur();   // else the guard above would keep the new row from being built
  // A row added while the table is narrowed to a tag gets that tag, so it does not vanish from view.
  const tags = store.tagFilter ? [store.tagFilter] : [];
  commit((doc) => { doc.scenarios.push({ id, name: `Scenario ${doc.scenarios.length + 1}`, tags, inputs: {}, expect: { actions: [], state: {} } }); });
  selectScenario(id);
  table.querySelector(`tr[data-row="${id}"] input.name`)?.focus();
}
