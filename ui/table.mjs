// The spreadsheet, kept: one row per scenario, a column per input, then what should happen. The
// verdict sits at the end of the row and updates as you type, because the run is free.
import { store, commit, select, uid } from './store.mjs';
import { inputControl, editing, acceptRun } from './inspector.mjs';

const table = document.getElementById('table');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const expanded = new Set();   // scenario ids whose result cell shows every issue, not just the first

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
  const key = shapeOf(doc);
  if ((key === shape && table.querySelector('tr[data-row]')) || editing(table)) { patch(); return; }
  shape = key;
  if (!doc.scenarios.length) {
    table.innerHTML = `<tr><td class="empty">No scenarios yet. Add one and fill in its inputs; the row turns green or red as you type.</td></tr>`;
    return;
  }
  const ends = doc.nodes.filter((n) => n.kind === 'end').map((n) => n.label);
  let html = `<thead><tr><th>#</th><th>Scenario</th>${doc.inputs.map((i) => `<th>${esc(i.name)}</th>`).join('')}
    <th class="expect">expected actions</th><th class="expect">lands on</th>${doc.state.map((f) => `<th class="expect">${esc(f.name)}</th>`).join('')}<th>result</th><th></th></tr></thead><tbody>`;
  doc.scenarios.forEach((s, k) => {
    const active = selection?.type === 'scenario' && selection.id === s.id;
    html += `<tr class="row ${active ? 'active' : ''}" data-row="${s.id}">
      <td class="muted">${k + 1}</td>
      <td><input type="text" class="name" data-f="name" value="${esc(s.name)}" placeholder="what is being tried"></td>
      ${doc.inputs.map((i) => `<td>${inputControl(i, s.inputs[i.name], `data-input="${esc(i.name)}"`)}</td>`).join('')}
      <td class="expect actions">${chips(s, results)}</td>
      <td class="expect"><select data-f="end"><option value="">any</option>${ends.map((e) => `<option value="${esc(e)}" ${s.expect.end === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></td>
      ${doc.state.map((f) => `<td class="expect"><input type="text" class="st expr" data-state="${esc(f.name)}" value="${esc(s.expect.state?.[f.name] ?? '')}" placeholder="*, null, value"></td>`).join('')}
      <td class="result">${status(s, results)}</td>
      <td class="tools"><button class="icon" data-act="dup" title="Duplicate">⧉</button> <button class="icon danger" data-act="rm" title="Delete">×</button></td>
    </tr>`;
  });
  table.innerHTML = html + '</tbody>';
}

function resultFor(s, results) { return results?.results.find((r) => r.scenario.id === s.id); }

function chips(s, results) {
  const r = resultFor(s, results);
  const missing = new Set(r?.verdict.issues.filter((i) => i.kind === 'missing-action').map((i) => i.action));
  const extra = r?.verdict.issues.filter((i) => i.kind === 'extra-action').map((i) => i.action) ?? [];
  const want = s.expect.actions ?? [];
  if (!want.length && !extra.length) return `<span class="muted">click row to choose</span>`;
  return `<div class="chips">${want.map((a) => `<span class="chip ${missing.has(a) ? 'missing' : ''}" title="${esc(a)}">${esc(a)}</span>`).join('')}${extra.map((a) => `<span class="chip extra" title="happened, not expected">+ ${esc(a)}</span>`).join('')}</div>`;
}

function status(s, results) {
  const r = resultFor(s, results);
  if (!r) return '';
  if (r.verdict.pass) return `<span class="status ok">✓ pass</span>`;
  const issues = r.verdict.issues, open = expanded.has(s.id);
  // A stuck run has nothing worth accepting; its trouble is in the drawing, not the expectation.
  const accept = r.result.error ? '' : `<button class="small accept" data-act="accept" title="Use this run as the expectation: what happened becomes what is expected">accept run</button>`;
  const rest = issues.length <= 1 ? ''
    : open ? `<ul class="issues">${issues.slice(1).map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul><span class="why more" data-act="more">show less</span>`
    : ` <span class="why more" data-act="more" title="Show every issue">+${issues.length - 1} more</span>`;
  return `<span class="status ${r.result.error ? 'stuck' : 'bad'}">${r.result.error ? '⚠ stuck' : '✗ fail'}</span><span class="why">${esc(issues[0].message)}</span>${accept}${rest}`;
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
    for (const [sel, html] of [['td.expect', chips(s, results)], ['td.result', status(s, results)]]) { const td = tr.querySelector(sel); if (td.written !== html) { td.innerHTML = html; td.written = html; } }
    for (const c of tr.querySelectorAll('input, select')) {
      if (c === document.activeElement) continue;
      const d = c.dataset;
      let v;
      if (d.f === 'name') v = s.name;
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
    else if (t.dataset.f === 'end') s.expect.end = t.value;
    else if (t.dataset.input) s.inputs[t.dataset.input] = t.value;
    else if (t.dataset.state) { s.expect.state ??= {}; s.expect.state[t.dataset.state] = t.value; }
  });
});

table.addEventListener('pointerdown', (ev) => {
  const tr = ev.target.closest('tr[data-row]');
  if (!tr) return;
  if (!(store.selection?.type === 'scenario' && store.selection.id === tr.dataset.row)) select({ type: 'scenario', id: tr.dataset.row });
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
    select({ type: 'scenario', id: nid });
  }
  if (b.dataset.act === 'accept') acceptRun(id);
  if (b.dataset.act === 'more') { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); patch(); }
});

// Enter in the last row's name starts the next scenario, the way a spreadsheet would; Escape just
// stops editing (the row stays selected, so the panel keeps showing it).
table.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (ev.key === 'Escape' && editing(table)) { ev.stopPropagation(); t.blur(); return; }
  if (ev.key === 'Enter' && t.dataset.f === 'name' && !t.closest('tr[data-row]')?.nextElementSibling) { ev.preventDefault(); addScenario(); }
});

export function addScenario() {
  const id = uid('s');
  if (editing(table)) document.activeElement.blur();   // else the guard above would keep the new row from being built
  commit((doc) => { doc.scenarios.push({ id, name: `Scenario ${doc.scenarios.length + 1}`, inputs: {}, expect: { actions: [], state: {} } }); });
  select({ type: 'scenario', id });
  table.querySelector(`tr[data-row="${id}"] input.name`)?.focus();
}
