// The spreadsheet, kept: one row per scenario, a column per input, then what should happen. The
// verdict sits at the end of the row and updates as you type, because the run is free.
import { store, commit, select, uid } from './store.mjs';
import { inputControl } from './inspector.mjs';

const table = document.getElementById('table');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function render() {
  if (table.contains(document.activeElement)) { patch(); return; }
  const { doc, results, selection } = store;
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
      <td class="expect">${chips(s, results)}</td>
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
  return `<div class="chips">${want.map((a) => `<span class="chip ${missing.has(a) ? 'missing' : ''}">${esc(a)}</span>`).join('')}${extra.map((a) => `<span class="chip extra" title="happened, not expected">+ ${esc(a)}</span>`).join('')}</div>`;
}

function status(s, results) {
  const r = resultFor(s, results);
  if (!r) return '';
  if (r.verdict.pass) return `<span class="status ok">✓ pass</span>`;
  const first = r.verdict.issues[0];
  const more = r.verdict.issues.length > 1 ? ` <span class="why">+${r.verdict.issues.length - 1} more</span>` : '';
  return `<span class="status bad">${r.result.error ? '⚠ stuck' : '✗ fail'}</span><span class="why">${esc(first.message)}</span>${more}`;
}

/** Only the computed cells, so the input being typed into keeps its focus. */
function patch() {
  const { doc, results, selection } = store;
  for (const tr of table.querySelectorAll('tr[data-row]')) {
    const s = doc.scenarios.find((s) => s.id === tr.dataset.row);
    if (!s) continue;
    tr.classList.toggle('active', selection?.type === 'scenario' && selection.id === s.id);
    tr.querySelector('td.expect').innerHTML = chips(s, results);
    tr.querySelector('td.result').innerHTML = status(s, results);
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
  if (b.dataset.act === 'rm') { commit((doc) => { doc.scenarios = doc.scenarios.filter((s) => s.id !== id); }); if (store.selection?.id === id) select(null); }
  if (b.dataset.act === 'dup') {
    const nid = uid('s');
    commit((doc) => { const s = doc.scenarios.find((s) => s.id === id); doc.scenarios.splice(doc.scenarios.indexOf(s) + 1, 0, { ...structuredClone(s), id: nid, name: s.name + ' (copy)' }); });
    select({ type: 'scenario', id: nid });
  }
});

export function addScenario() {
  const id = uid('s');
  commit((doc) => { doc.scenarios.push({ id, name: `Scenario ${doc.scenarios.length + 1}`, inputs: {}, expect: { actions: [], state: {} } }); });
  select({ type: 'scenario', id });
  table.querySelector(`tr[data-row="${id}"] input.name`)?.focus();
}
