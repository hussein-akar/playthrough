// The side panel: whatever is selected, editable. Nothing selected shows the flow itself, which
// is where inputs and state fields are declared, because the guards can only mention what is
// declared here.
import { store, commit, select, uid, activeRun } from './store.mjs';
import { check } from '../lib/expr.mjs';
import { knownNames } from '../lib/run.mjs';

const el = document.getElementById('inspector');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const opt = (v, cur, label = v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;

export function render() {
  // Never rebuild under the user's cursor: a keystroke commits, and the commit re-renders.
  if (el.contains(document.activeElement) && document.activeElement !== el) { patchVerdict(); return; }
  const { doc, selection } = store;
  if (!selection) el.innerHTML = flowView(doc);
  else if (selection.type === 'node') el.innerHTML = nodeView(doc, doc.nodes.find((n) => n.id === selection.id));
  else if (selection.type === 'edge') el.innerHTML = edgeView(doc, doc.edges.find((e) => e.id === selection.id));
  else if (selection.type === 'scenario') el.innerHTML = scenarioView(doc, doc.scenarios.find((s) => s.id === selection.id));
}

el.addEventListener('focusout', () => setTimeout(() => { if (!el.contains(document.activeElement)) render(); }, 0));

// ---- views ------------------------------------------------------------------------------------

function flowView(doc) {
  const inputs = doc.inputs.map((i, k) => `
    <div class="row" data-input="${k}">
      <input type="text" data-f="name" value="${esc(i.name)}" placeholder="name">
      <select data-f="type">${['enum', 'boolean', 'number', 'text'].map((t) => opt(t, i.type)).join('')}</select>
      <button class="icon danger" data-act="rm-input" title="Remove">×</button>
    </div>
    ${i.type === 'enum' ? `<div class="field" data-input="${k}"><input type="text" data-f="values" value="${esc((i.values ?? []).join(', '))}" placeholder="values, comma separated"></div>` : ''}`).join('');
  const state = doc.state.map((f, k) => `
    <div class="row" data-state="${k}">
      <input type="text" data-f="name" value="${esc(f.name)}" placeholder="field">
      <input type="text" class="expr" data-f="initial" value="${esc(f.initial ?? '')}" placeholder="initial (blank = null)">
      <button class="icon danger" data-act="rm-state" title="Remove">×</button>
    </div>`).join('');
  return `
    <h2>Flow</h2>
    <div class="field"><label>Name</label><input type="text" data-doc="name" value="${esc(doc.name)}"></div>
    <div class="field"><label>What this flow is about</label><textarea data-doc="description" style="font-family: inherit">${esc(doc.description)}</textarea></div>
    <h2>Inputs <span class="muted">· what a scenario provides</span></h2>
    ${inputs || '<div class="muted">No inputs yet. A guard can only mention an input declared here.</div>'}
    <div class="actions"><button class="small" data-act="add-input">+ Input</button></div>
    <h2>State <span class="muted">· what actions may set</span></h2>
    ${state || '<div class="muted">No state fields. Add one when an action needs to leave something behind that a scenario can check.</div>'}
    <div class="actions"><button class="small" data-act="add-state">+ State field</button></div>
    <h2>Conditions</h2>
    <div class="muted">Guards read like <code>type in [Subscription, Refund]</code>, <code>isExpress</code>, <code>amount &gt; 100 and not blocked</code>, <code>date == null</code>. Enum values need no quotes. One edge out of a decision may be <em>else</em>.</div>`;
}

function nodeView(doc, n) {
  if (!n) return '';
  const known = knownNames(doc);
  const sets = Object.entries(n.set ?? {}).map(([field, src], k) => {
    const errs = (doc.state.some((f) => f.name === field) ? [] : [`${field} is not a declared state field`]).concat(check(String(src ?? ''), known));
    return `<div class="row" data-set="${k}">
      <select data-f="field">${doc.state.map((f) => opt(f.name, field)).join('')}${doc.state.some((f) => f.name === field) ? '' : opt(field, field)}</select>
      <input type="text" class="expr" data-f="src" value="${esc(src)}" placeholder="expression">
      <button class="icon danger" data-act="rm-set" title="Remove">×</button>
    </div>${errs.map((e) => `<div class="err">${esc(e)}</div>`).join('')}`;
  }).join('');
  return `
    <h2>${esc(n.kind)} node</h2>
    <div class="field"><label>Label</label><input type="text" data-node="label" value="${esc(n.label)}"></div>
    <div class="field"><label>Kind</label><select data-node="kind">${['start', 'action', 'decision', 'end'].map((k) => opt(k, n.kind)).join('')}</select></div>
    ${n.kind === 'action' ? `
    <h2>Sets <span class="muted">· state this action leaves behind</span></h2>
    ${sets}
    <div class="actions"><button class="small" data-act="add-set" ${doc.state.length ? '' : 'disabled title="Declare a state field on the flow first"'}>+ Set a field</button></div>` : ''}
    <div class="field" style="margin-top: 12px"><label>Note</label><textarea data-node="note" style="font-family: inherit" placeholder="Anything the team should know">${esc(n.note ?? '')}</textarea></div>
    <div class="actions"><button class="small danger" data-act="rm-node">Delete node</button></div>`;
}

function edgeView(doc, e) {
  if (!e) return '';
  const from = doc.nodes.find((n) => n.id === e.from), to = doc.nodes.find((n) => n.id === e.to);
  const errs = check(e.when, knownNames(doc));
  return `
    <h2>Edge</h2>
    <div class="muted" style="margin-bottom: 10px"><b>${esc(from?.label)}</b> → <b>${esc(to?.label)}</b></div>
    <div class="field"><label>Condition <span class="muted">· blank means always</span></label>
      <input type="text" class="expr" data-edge="when" value="${esc(e.when)}" placeholder="e.g. type in [Subscription, Refund]" ${e.else ? 'disabled' : ''}>
      ${errs.map((m) => `<div class="err">${esc(m)}</div>`).join('')}
    </div>
    <div class="field checks"><label><input type="checkbox" data-edge="else" ${e.else ? 'checked' : ''}> <span>else: taken when no other branch matches</span></label></div>
    <div class="field"><label>Label <span class="muted">· shown when there is no condition</span></label><input type="text" data-edge="label" value="${esc(e.label ?? '')}"></div>
    <div class="actions"><button class="small danger" data-act="rm-edge">Delete edge</button></div>`;
}

function scenarioView(doc, s) {
  if (!s) return '';
  const actions = [...new Set(doc.nodes.filter((n) => n.kind === 'action').map((n) => n.label))];
  const ends = doc.nodes.filter((n) => n.kind === 'end').map((n) => n.label);
  const want = new Set(s.expect.actions ?? []);
  return `
    <h2>Scenario</h2>
    <div class="field"><label>Name</label><input type="text" data-scn="name" value="${esc(s.name)}"></div>
    <h2>Inputs</h2>
    ${doc.inputs.map((i) => `<div class="field"><label>${esc(i.name)}</label>${inputControl(i, s.inputs[i.name], `data-scn-input="${esc(i.name)}"`)}</div>`).join('') || '<div class="muted">The flow declares no inputs yet.</div>'}
    <h2>Expected actions</h2>
    <div class="checks">${actions.map((a) => `<label><input type="checkbox" data-scn-action="${esc(a)}" ${want.has(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('') || '<div class="muted">No action nodes in the flow yet.</div>'}</div>
    <h2>Expected landing</h2>
    <div class="field"><select data-scn="end"><option value="">(any end)</option>${ends.map((e) => opt(e, s.expect.end ?? '')).join('')}</select></div>
    ${doc.state.length ? `<h2>Expected state</h2>
    ${doc.state.map((f) => `<div class="field"><label>${esc(f.name)} <span class="muted">· <code>*</code> any value, <code>null</code>, or the value</span></label><input type="text" class="expr" data-scn-state="${esc(f.name)}" value="${esc(s.expect.state?.[f.name] ?? '')}"></div>`).join('')}` : ''}
    <div class="field" style="margin-top: 12px"><label>Note</label><textarea data-scn="note" style="font-family: inherit" placeholder="Why this scenario exists">${esc(s.note ?? '')}</textarea></div>
    <h2>Result</h2>
    <div id="verdict">${verdictHtml()}</div>
    <div class="actions"><button class="small primary" data-act="play">▶ Play</button><button class="small" data-act="dup-scn">Duplicate</button><button class="small danger" data-act="rm-scn">Delete</button></div>`;
}

export function inputControl(i, value, attrs) {
  const v = value == null ? '' : String(value);
  if (i.type === 'enum') return `<select ${attrs}><option value=""></option>${(i.values ?? []).map((x) => opt(x, v)).join('')}</select>`;
  if (i.type === 'boolean') return `<select ${attrs}><option value="" ${v === '' ? 'selected' : ''}></option><option value="true" ${['true', 'yes', '1'].includes(v.toLowerCase()) ? 'selected' : ''}>yes</option><option value="false" ${['false', 'no', '0'].includes(v.toLowerCase()) ? 'selected' : ''}>no</option></select>`;
  if (i.type === 'number') return `<input type="number" ${attrs} value="${esc(v)}">`;
  return `<input type="text" ${attrs} value="${esc(v)}">`;
}

function verdictHtml() {
  const r = activeRun();
  if (!r) return '';
  const path = r.result.steps.map((st) => store.doc.nodes.find((n) => n.id === st.node)?.label).join(' → ');
  if (r.verdict.pass) return `<div class="verdict ok"><b>Passes.</b> ${esc(path)}</div>`;
  return `<div class="verdict bad"><b>${r.result.error ? 'Got stuck.' : 'Does not match.'}</b> ${esc(path)}<ul>${r.verdict.issues.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul></div>`;
}

function patchVerdict() { const v = el.querySelector('#verdict'); if (v) v.innerHTML = verdictHtml(); }

// ---- edits ------------------------------------------------------------------------------------

function current() {
  const { doc, selection } = store;
  if (!selection) return null;
  const list = selection.type === 'node' ? doc.nodes : selection.type === 'edge' ? doc.edges : doc.scenarios;
  return list.find((x) => x.id === selection.id);
}

el.addEventListener('input', (ev) => {
  const t = ev.target;
  const d = t.dataset;
  if (d.doc) return commit((doc) => { doc[d.doc] = t.value; });
  if (d.node) return commit((doc) => { const n = doc.nodes.find((n) => n.id === store.selection.id); n[d.node] = t.value; });
  if (d.edge === 'when' || d.edge === 'label') return commit((doc) => { const e = doc.edges.find((e) => e.id === store.selection.id); e[d.edge] = t.value; });
  if (d.scn) return commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); if (d.scn === 'end') s.expect.end = t.value; else s[d.scn] = t.value; });
  if (d.scnInput) return commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); s.inputs[d.scnInput] = t.value; });
  if (d.scnState) return commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); s.expect.state ??= {}; s.expect.state[d.scnState] = t.value; });
  const inputRow = t.closest('[data-input]');
  if (inputRow) return commit((doc) => {
    const i = doc.inputs[Number(inputRow.dataset.input)];
    if (d.f === 'values') i.values = t.value.split(',').map((s) => s.trim()).filter(Boolean);
    else i[d.f] = t.value;
  });
  const stateRow = t.closest('[data-state]');
  if (stateRow) return commit((doc) => {
    const f = doc.state[Number(stateRow.dataset.state)];
    if (d.f === 'initial') f.initial = t.value === '' ? null : t.value;
    else f.name = t.value;
  });
  const setRow = t.closest('[data-set]');
  if (setRow) return commit((doc) => {
    const n = doc.nodes.find((n) => n.id === store.selection.id);
    const entries = Object.entries(n.set ?? {});
    const k = Number(setRow.dataset.set);
    if (d.f === 'field') entries[k][0] = t.value; else entries[k][1] = t.value;
    n.set = Object.fromEntries(entries);
  });
});

el.addEventListener('change', (ev) => {
  const t = ev.target;
  const d = t.dataset;
  if (d.edge === 'else') { commit((doc) => { const e = doc.edges.find((e) => e.id === store.selection.id); e.else = t.checked; if (t.checked) e.when = ''; }); t.blur(); render(); }
  if (d.scnAction != null) commit((doc) => {
    const s = doc.scenarios.find((s) => s.id === store.selection.id);
    const set = new Set(s.expect.actions ?? []);
    if (t.checked) set.add(d.scnAction); else set.delete(d.scnAction);
    s.expect.actions = [...set];
  });
  // Selects and kind changes reshape the panel; rebuild once the choice is made.
  if (t.tagName === 'SELECT') { t.blur(); render(); }
});

el.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const sel = store.selection;
  if (act === 'add-input') commit((doc) => { doc.inputs.push({ name: `input${doc.inputs.length + 1}`, type: 'text' }); });
  if (act === 'rm-input') commit((doc) => { doc.inputs.splice(Number(b.closest('[data-input]').dataset.input), 1); });
  if (act === 'add-state') commit((doc) => { doc.state.push({ name: `field${doc.state.length + 1}`, initial: null }); });
  if (act === 'rm-state') commit((doc) => { doc.state.splice(Number(b.closest('[data-state]').dataset.state), 1); });
  if (act === 'add-set') commit((doc) => { const n = doc.nodes.find((n) => n.id === sel.id); n.set ??= {}; const free = doc.state.find((f) => !(f.name in n.set)) ?? doc.state[0]; n.set[free.name] = ''; });
  if (act === 'rm-set') commit((doc) => { const n = doc.nodes.find((n) => n.id === sel.id); const entries = Object.entries(n.set ?? {}); entries.splice(Number(b.closest('[data-set]').dataset.set), 1); n.set = Object.fromEntries(entries); });
  if (act === 'rm-node') { commit((doc) => { doc.nodes = doc.nodes.filter((n) => n.id !== sel.id); doc.edges = doc.edges.filter((e) => e.from !== sel.id && e.to !== sel.id); }); select(null); }
  if (act === 'rm-edge') { commit((doc) => { doc.edges = doc.edges.filter((e) => e.id !== sel.id); }); select(null); }
  if (act === 'rm-scn') { commit((doc) => { doc.scenarios = doc.scenarios.filter((s) => s.id !== sel.id); }); select(null); }
  if (act === 'dup-scn') { const id = uid('s'); commit((doc) => { const s = doc.scenarios.find((s) => s.id === sel.id); const i = doc.scenarios.indexOf(s); doc.scenarios.splice(i + 1, 0, { ...structuredClone(s), id, name: s.name + ' (copy)' }); }); select({ type: 'scenario', id }); }
  if (act === 'play') el.dispatchEvent(new CustomEvent('play', { bubbles: true }));
  render();
});
