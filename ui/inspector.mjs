// The side panel: whatever is selected, editable. Nothing selected shows the flow itself, which
// is where inputs and state fields are declared, because the guards can only mention what is
// declared here.
import { store, commit, select, selectNodes, selectedNodeIds, uid, activeRun, renameName, parseTags } from './store.mjs';
import { alignSelected, deleteSelectedNodes } from './canvas.mjs';
import { check, compile, names } from '../lib/expr.mjs';
import { knownNames, listsOf, parseRecords, initialIsExpression } from '../lib/run.mjs';

const el = document.getElementById('inspector');
const sheet = document.getElementById('settings');   // the flow settings sheet: inputs, state, the cheat sheet
const roots = [el, sheet];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** True while the user is typing in a control inside `node`; a focused button does not count. */
export const editing = (node) => { const a = document.activeElement; return node.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName); };
const opt = (v, cur, label = v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Up and down arrows for the k-th of n rows, greyed at the ends. */
const mover = (act, k, n) => `<span class="mover"><button class="icon" data-act="${act}" data-dir="-1" title="Move up" ${k === 0 ? 'disabled' : ''}>↑</button><button class="icon" data-act="${act}" data-dir="1" title="Move down" ${k === n - 1 ? 'disabled' : ''}>↓</button></span>`;
const swap = (list, k, dir) => { const j = k + dir; if (j < 0 || j >= list.length) return; [list[k], list[j]] = [list[j], list[k]]; };
const RESERVED = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'null', 'where']);   // the words of the condition language, which a name cannot be

export function render() {
  // Never rebuild under the user's cursor: a keystroke commits, and the commit re-renders. What
  // must follow the keystroke anyway (the verdict, the messages under the expressions) is patched
  // into the existing markup instead.
  if (sheet.open && !editing(sheet)) sheet.querySelector('.body').innerHTML = settingsView(store.doc);
  if (editing(el)) { patchLive(); return; }
  const { doc, selection } = store;
  if (!selection) el.innerHTML = flowView(doc);
  else if (selection.type === 'node' && selection.ids) el.innerHTML = groupView(doc, selection.ids);
  else if (selection.type === 'node') el.innerHTML = nodeView(doc, doc.nodes.find((n) => n.id === selection.id));
  else if (selection.type === 'edge') el.innerHTML = edgeView(doc, doc.edges.find((e) => e.id === selection.id));
  else if (selection.type === 'scenario') el.innerHTML = scenarioView(doc, doc.scenarios.find((s) => s.id === selection.id));
  patchLive();
}

for (const r of roots) r.addEventListener('focusout', () => setTimeout(() => { if (!r.contains(document.activeElement)) render(); }, 0));

/** Open the flow settings sheet, rendered fresh, on an item (`input:2`, `state:last`); it closes on its button or Escape. */
export function openSettings(focus = '') {
  document.activeElement?.blur?.();
  sheet.querySelector('.body').innerHTML = settingsView(store.doc);
  sheet.showModal();
  patchLive();
  const [kind, which] = String(focus).split(':');
  if (!kind || !which) return;
  const n = kind === 'input' ? store.doc.inputs.length : store.doc.state.length;
  const k = which === 'last' ? n - 1 : Number(which);
  const target = sheet.querySelector(`.row[data-${kind}="${k}"] [data-f="name"]`);
  if (target) { target.focus(); target.select?.(); target.scrollIntoView?.({ block: 'center' }); }
}
sheet.querySelector('[data-act="close-settings"]').addEventListener('click', () => sheet.close());
sheet.addEventListener('close', () => render());
document.getElementById('flowSettings').addEventListener('click', openSettings);

// ---- views ------------------------------------------------------------------------------------
// A control with `data-check` is validated by `problemsOf`; its messages go into the `.errs` box
// that follows the control, or the `.row` it sits in. The views emit the boxes empty and
// `patchChecks` fills them, at build time and again on every keystroke.

/** How many guards and sets mention a name: a hint before renaming or removing it. */
function usesOf(doc, name) {
  const mentions = (src) => { try { return src?.trim() ? names(compile(src)).some((n) => n.split('.')[0] === name) : false; } catch { return false; } };
  let n = 0;
  for (const e of doc.edges) if (mentions(e.when)) n++;
  for (const nd of doc.nodes) for (const [field, src] of Object.entries(nd.set ?? {})) if (field === name || mentions(String(src ?? ''))) n++;
  return n;
}
const uses = (doc, name) => { const n = usesOf(doc, name); return n ? `used ${n} time${n === 1 ? '' : 's'}` : 'not used yet'; };

const CHEATSHEET = `<div class="muted">Guards read like <code>type in [Subscription, Refund]</code>, <code>isExpress</code>, <code>amount &gt; 100 and not blocked</code>, <code>date == null</code>. Enum values need no quotes. One edge out of a decision may be <em>else</em>.</div>
    <div class="muted" style="margin-top: 6px">A list is narrowed with <code>where</code> and measured with <code>count</code>: an action may set <code>notices = notices where status != CLOSED</code>, and a guard may read <code>count(notices) == 0</code>. Inside <code>where</code> a bare word is a field of the record.</div>`;

/** Nothing selected: the flow at a glance as cards; any row, pencil or Add opens the settings sheet on that item. */
function flowView(doc) {
  const detail = (i) => i.type === 'enum' ? `enum · ${(i.values ?? []).map(esc).join(', ')}` : i.type === 'list' ? `list · ${(i.fields ?? []).map((f) => esc(f.name)).join(', ') || 'no fields yet'}` : esc(i.type);
  const card = (title, hint, items, empty, add, addLabel, focus) => `
    <section class="card">
      <div class="head"><h3>${title}</h3><span class="count">${items.length}</span><button class="icon pencil" data-act="open-settings" data-focus="${focus}" title="Edit in flow settings"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2z"/></svg></button></div>
      ${items.length ? items.join('') : `<div class="muted empty">${empty}</div>`}
      <div class="foot"><button class="small" data-act="${add}">${addLabel}</button></div>
    </section>`;
  const inputs = doc.inputs.map((i, k) => `<button class="item" data-act="open-settings" data-focus="input:${k}"><span class="name">${esc(i.name) || '<i>unnamed</i>'}</span><span class="detail">${detail(i)}</span><span class="chev">›</span></button>`);
  const state = doc.state.map((f, k) => `<button class="item" data-act="open-settings" data-focus="state:${k}"><span class="name">${esc(f.name) || '<i>unnamed</i>'}</span><span class="detail">${f.initial == null || String(f.initial).trim() === '' ? 'null at first' : `${esc(f.initial)} at first`}</span><span class="chev">›</span></button>`);
  return `
    <h2>Flow</h2>
    <div class="field"><label>Name</label><input type="text" data-doc="name" value="${esc(doc.name)}"></div>
    <div class="field"><label>What this flow is about</label><textarea data-doc="description" style="font-family: inherit">${esc(doc.description)}</textarea></div>
    ${card('Inputs', '', inputs, 'No inputs yet. A guard can only mention what is declared here.', 'add-input-open', '+ Input', 'input:last')}
    ${card('State', '', state, 'No state fields. Add one when an action needs to leave something behind that a scenario can check.', 'add-state-open', '+ State field', 'state:last')}
    <section class="card"><div class="head"><h3>Conditions</h3></div>${CHEATSHEET}</section>`;
}

/** The flow settings sheet: the schema a scenario is written against, with room to edit it. */
function settingsView(doc) {
  const inputs = doc.inputs.map((i, k) => `
    <div class="row" data-input="${k}">
      <input type="text" data-f="name" data-check value="${esc(i.name)}" placeholder="name">
      <select data-f="type">${['enum', 'boolean', 'number', 'text', 'list'].map((t) => opt(t, i.type)).join('')}</select>
      ${i.type === 'enum' ? `<input type="text" class="values" data-f="values" data-check value="${esc((i.values ?? []).join(', '))}" placeholder="values, comma separated">` : `<span class="use muted">${uses(doc, i.name)}</span>`}
      ${mover('mv-input', k, doc.inputs.length)}<button class="icon danger" data-act="rm-input" title="Remove">×</button>
    </div><div class="errs"></div>
    ${i.type === 'list' ? `<div class="fields" data-input="${k}">
      ${(i.fields ?? []).map((f, j) => `<div class="row" data-lf="${j}">
        <input type="text" data-f="fname" data-check value="${esc(f.name)}" placeholder="field">
        <select data-f="ftype">${['enum', 'boolean', 'number', 'text'].map((t) => opt(t, f.type)).join('')}</select>
        ${f.type === 'enum' ? `<input type="text" class="values" data-f="fvalues" value="${esc((f.values ?? []).join(', '))}" placeholder="values, comma separated">` : '<span class="use"></span>'}
        ${mover('mv-field', j, i.fields.length)}<button class="icon danger" data-act="rm-field" title="Remove">×</button>
      </div><div class="errs"></div>`).join('')}
      <div class="actions"><button class="small" data-act="add-field">+ Field</button><span class="muted">the fields of one record; a scenario fills them in per record, or writes <code>status=OPEN, linked=yes</code> one per line</span></div>
    </div>` : ''}`).join('');
  const state = doc.state.map((f, k) => `
    <div class="row" data-state="${k}">
      <input type="text" data-f="name" data-check value="${esc(f.name)}" placeholder="field">
      <input type="text" class="expr" data-f="initial" data-check value="${esc(f.initial ?? '')}" placeholder="initial value, or an input's name" title="The value before any action sets it: a value as written, or an expression over the inputs, such as an input's name to start as a copy of it. Blank means null.">
      <span class="use muted">${uses(doc, f.name)}</span>
      ${mover('mv-state', k, doc.state.length)}<button class="icon danger" data-act="rm-state" title="Remove">×</button>
    </div><div class="errs"></div>`).join('');
  return `
    <section class="card">
      <h3>About</h3>
      <div class="two">
        <div class="field"><label>Name</label><input type="text" data-doc="name" value="${esc(doc.name)}"></div>
        <div class="field"><label>What this flow is about</label><textarea data-doc="description" style="font-family: inherit">${esc(doc.description)}</textarea></div>
      </div>
    </section>
    <section class="card">
      <h3>Inputs <span class="muted">· what a scenario provides, one column each in the table</span></h3>
      ${inputs || '<div class="muted">No inputs yet. A guard can only mention what is declared here.</div>'}
      <div class="actions"><button class="small" data-act="add-input">+ Input</button></div>
    </section>
    <section class="card">
      <h3>State <span class="muted">· what actions may set, and a scenario may check at the end</span></h3>
      ${state || '<div class="muted">No state fields. Add one when an action needs to leave something behind that a scenario can check.</div>'}
      <div class="actions"><button class="small" data-act="add-state">+ State field</button></div>
    </section>
    <section class="card">
      <h3>Conditions</h3>
      ${CHEATSHEET}
    </section>`;
}

function nodeView(doc, n) {
  if (!n) return '';
  const setBlock = !doc.state.length ? 'Declare a state field on the flow first (click the empty canvas).' : doc.state.every((f) => f.name in (n.set ?? {})) ? 'Every state field is already set here.' : '';
  const sets = Object.entries(n.set ?? {}).map(([field, src], k) => `<div class="row" data-set="${k}">
      <select data-f="field">${doc.state.map((f) => opt(f.name, field)).join('')}${doc.state.some((f) => f.name === field) ? '' : opt(field, field)}</select>
      <input type="text" class="expr" data-f="src" data-check value="${esc(src)}" placeholder="expression">
      <button class="icon danger" data-act="rm-set" title="Remove">×</button>
    </div><div class="errs"></div>`).join('');
  return `
    <h2>${esc(n.kind)} node</h2>
    <div class="field"><label>Kind</label><select data-node="kind">${['start', 'action', 'decision', 'end'].map((k) => opt(k, n.kind, k[0].toUpperCase() + k.slice(1))).join('')}</select></div>
    <div class="field"><label>Label</label><input type="text" data-node="label" value="${esc(n.label)}"></div>
    ${n.kind === 'action' ? `
    <h2>Sets <span class="muted">· state this action leaves behind</span></h2>
    ${sets}
    <div class="actions"><button class="small" data-act="add-set" ${setBlock ? 'disabled' : ''}>+ Set a field</button>${setBlock ? `<span class="muted">${setBlock}</span>` : ''}</div>` : ''}
    <div class="field" style="margin-top: 12px"><label>Note</label><textarea data-node="note" style="font-family: inherit" placeholder="Anything the team should know">${esc(n.note ?? '')}</textarea></div>
    <div class="actions"><button class="small danger" data-act="rm-node">Delete node</button></div>`;
}

/** Several nodes at once: what they are, and the few things that make sense to do to all of them. */
function groupView(doc, ids) {
  const nodes = ids.map((id) => doc.nodes.find((n) => n.id === id)).filter(Boolean);
  return `
    <h2>${nodes.length} nodes selected</h2>
    <div class="group">${nodes.map((n) => `<button class="small" data-one="${esc(n.id)}" title="Select only this node"><i class="dot" style="background: var(--${n.kind})"></i>${esc(n.label || '(untitled)')}<span class="x" data-drop="${esc(n.id)}" title="Take out of the selection">×</span></button>`).join('')}</div>
    <p class="muted">Drag any of them to move them together. Arrow keys nudge the group. Shift-click a node to add or remove it; Shift-drag on the canvas to catch more.</p>
    <div class="actions">
      <button class="small" data-act="align-left" title="Line them up on the leftmost one">Align left</button>
      <button class="small" data-act="align-top" title="Line them up on the topmost one">Align top</button>
      <button class="small danger" data-act="rm-group">Delete ${nodes.length} nodes</button>
    </div>`;
}

function edgeView(doc, e) {
  if (!e) return '';
  const from = doc.nodes.find((n) => n.id === e.from), to = doc.nodes.find((n) => n.id === e.to);
  return `
    <h2>Edge</h2>
    <div class="muted" style="margin-bottom: 10px"><b>${esc(from?.label)}</b> → <b>${esc(to?.label)}</b></div>
    <div class="field"><label>Condition <span class="muted">· blank means always</span></label>
      <div class="row">
        <input type="text" class="expr" data-edge="when" data-check value="${esc(e.when)}" placeholder="e.g. type in [Subscription, Refund]" ${e.else ? 'disabled' : ''}>
        ${insertMenu(doc, e.else)}
      </div>
      <div class="errs"></div>
    </div>
    <div class="field checks"><label><input type="checkbox" data-edge="else" ${e.else ? 'checked' : ''}> <span>else: taken when no other branch matches</span></label></div>
    <div class="field"><label>Label <span class="muted">· shown on the canvas instead of the condition</span></label><input type="text" data-edge="label" value="${esc(e.label ?? '')}" placeholder="e.g. approved"></div>
    <div class="field"><label>Line</label>
      <div class="swatches">${[['smooth', 'Smooth'], ['square', 'Square']].map(([v, l]) => `<button class="swatch none${(e.shape === 'square' ? 'square' : 'smooth') === v ? ' on' : ''}" data-act="edge-shape" data-shape="${v}">${l}</button>`).join('')}</div>
    </div>
    <div class="field"><label>Colour <span class="muted">· a status for the branch</span></label>
      <div class="swatches">${[['', 'None'], ['success', 'Success'], ['failed', 'Failed'], ['warning', 'Warning'], ['info', 'Info']].map(([c, l]) => `<button class="swatch ${c ? `c-${c}` : 'none'}${(e.color ?? '') === c ? ' on' : ''}" data-act="edge-color" data-color="${c}" title="${l}"><i></i></button>`).join('')}</div>
    </div>
    <div class="actions"><button class="small danger" data-act="rm-edge">Delete edge</button></div>`;
}

// The menu beside a condition: every declared name, each enum's values and the operators, so a
// guard is assembled by picking rather than remembering. A pick lands at the cursor.
const OPERATORS = ['==', '!=', '<', '<=', '>', '>=', 'in []', 'not in []', 'and', 'or', 'not', 'null', 'true', 'false', 'where', 'count()'];
function insertMenu(doc, disabled) {
  const group = (label, items) => items.length ? `<optgroup label="${label}">${items.map(([v, l]) => `<option value="${esc(v)}">${esc(l ?? v)}</option>`).join('')}</optgroup>` : '';
  const word = (v) => (IDENT.test(v) && !RESERVED.has(v) ? v : JSON.stringify(v));
  return `<select class="insert" data-insert title="Put a name or an operator at the cursor" ${disabled ? 'disabled' : ''}>
    <option value="">insert…</option>
    ${group('Inputs', doc.inputs.filter((i) => i.name).map((i) => [i.name]))}
    ${group('State', doc.state.filter((f) => f.name).map((f) => [f.name]))}
    ${doc.inputs.filter((i) => i.type === 'enum' && i.values?.length).map((i) => group(`${i.name} values`, i.values.map((v) => [word(v), v]))).join('')}
    ${doc.inputs.filter((i) => i.type === 'list' && i.fields?.length).map((i) => group(`${i.name} fields`, i.fields.filter((f) => f.name).map((f) => [f.name])) + i.fields.filter((f) => f.type === 'enum' && f.values?.length).map((f) => group(`${i.name}.${f.name} values`, f.values.map((v) => [word(v), v]))).join('')).join('')}
    ${group('Operators', OPERATORS.map((o) => [o]))}
  </select>`;
}

/** Put `token` into the text control at its cursor, spaced from what is around it, and leave the cursor after it. */
function insertAt(input, token) {
  const v = input.value, a = input.selectionStart ?? v.length, b = input.selectionEnd ?? a;
  const before = v.slice(0, a), after = v.slice(b);
  const lead = before && !/[\s([]$/.test(before) ? ' ' : '', tail = /^[\s)\],]/.test(after) ? '' : ' ';
  input.value = before + lead + token + tail + after;
  const at = (before + lead + token).length - (token.endsWith('[]') || token.endsWith('()') ? 1 : 0);   // inside the brackets of `in []` or `count()`
  input.focus();
  input.setSelectionRange(at, at);
}

function scenarioView(doc, s) {
  if (!s) return '';
  const actions = [...new Set(flowOrder(doc).filter((n) => n.kind === 'action').map((n) => n.label))];
  const ends = doc.nodes.filter((n) => n.kind === 'end').map((n) => n.label);
  const want = new Set(s.expect.actions ?? []);
  return `
    <h2>Scenario</h2>
    <div class="field"><label>Name</label><input type="text" data-scn="name" value="${esc(s.name)}"></div>
    <div class="field"><label>Tags <span class="muted">· comma-separated; the table can be narrowed to one</span></label><input type="text" data-scn="tags" value="${esc((s.tags ?? []).join(', '))}" placeholder="edge, PROJ-12"></div>
    <h2>Inputs</h2>
    ${doc.inputs.map((i) => `<div class="field"><label>${esc(i.name)}${i.type === 'list' ? recordsToggle(i, s.inputs[i.name]) : ''}</label>${i.type === 'list' && !recordsAsText.has(i.name) && readable(i, s.inputs[i.name]) ? recordsForm(i, s.inputs[i.name]) : inputControl(i, s.inputs[i.name], `data-scn-input="${esc(i.name)}"`)}</div>`).join('') || '<div class="muted">The flow declares no inputs yet.</div>'}
    <h2>Expected actions <span class="muted">· in flow order; ✓ happened in the last run</span></h2>
    <div class="checks">${actions.map((a) => `<label><input type="checkbox" data-scn-action="${esc(a)}" ${want.has(a) ? 'checked' : ''}> <span>${esc(a)}</span><span class="did"></span></label>`).join('') || '<div class="muted">No action nodes in the flow yet.</div>'}</div>
    <h2>Expected landing</h2>
    <div class="field"><select data-scn="end"><option value="">(any end)</option>${ends.map((e) => opt(e, s.expect.end ?? '')).join('')}</select></div>
    ${doc.state.length ? `<h2>Expected state</h2>
    ${doc.state.map((f) => `<div class="field"><label>${esc(f.name)} <span class="muted">· <code>*</code> any value, <code>null</code>, or the value</span></label><input type="text" class="expr" data-scn-state="${esc(f.name)}" value="${esc(s.expect.state?.[f.name] ?? '')}"></div>`).join('')}` : ''}
    <div class="field" style="margin-top: 12px"><label>Note</label><textarea data-scn="note" style="font-family: inherit" placeholder="Why this scenario exists">${esc(s.note ?? '')}</textarea></div>
    <h2>Result</h2>
    <div id="verdict">${verdictHtml()}</div>
    <div class="actions"><button class="small primary" data-act="play">▶ Play</button><button class="small" data-act="dup-scn">Duplicate</button><button class="small danger" data-act="rm-scn">Delete</button></div>`;
}

/**
 * The nodes in the order a run meets them: everything reachable from the start, each node before
 * the nodes it leads to, sibling branches in edge order; then whatever nothing reaches. A loop is
 * tolerated, its members simply come out in visiting order.
 */
export function flowOrder(doc) {
  const seen = new Set();
  const walk = (roots) => {
    const post = [];
    const visit = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const n = doc.nodes.find((x) => x.id === id);
      if (!n) return;
      for (const e of doc.edges.filter((e) => e.from === id).reverse()) visit(e.to);
      post.push(n);
    };
    for (const id of [...roots].reverse()) visit(id);
    return post.reverse();
  };
  return walk(doc.nodes.filter((n) => n.kind === 'start').map((n) => n.id)).concat(walk(doc.nodes.map((n) => n.id)));
}

// ---- the records of a list input -------------------------------------------------------------
// The fields are declared, so a scenario fills a row of controls per record and presses Add for
// the next one. The text form underneath is what is stored (and what the table shows), so the
// two stay interchangeable; text that the form cannot read is edited as text.

const recordsAsText = new Set();   // list inputs the user chose to edit as text
const readable = (i, value) => { try { parseRecords(value, i.fields ?? []); return true; } catch { return false; } };

function recordsToggle(i, value) {
  if (!readable(i, value)) return ' <span class="muted">· could not be read as records; fix the text</span>';
  return recordsAsText.has(i.name) ? `<button class="link" data-act="records-form" data-list="${esc(i.name)}">use the form</button>` : `<button class="link" data-act="records-text" data-list="${esc(i.name)}">edit as text</button>`;
}

function recordsForm(i, value) {
  const fields = (i.fields ?? []).filter((f) => f.name);
  const records = parseRecords(value, fields);
  const cell = (f, v) => inputControl(f, v, `data-rf="${esc(f.name)}" title="${esc(f.name)}" placeholder="${esc(f.name)}"`);
  return `<div class="records" data-records="${esc(i.name)}">
    ${records.length ? `<div class="row rec head">${fields.map((f) => `<span>${esc(f.name)}</span>`).join('')}<span class="x"></span></div>` : ''}
    ${records.map((r, k) => `<div class="row rec" data-rec="${k}">${fields.map((f) => cell(f, r[f.name])).join('')}<button class="icon danger" data-act="rm-rec" title="Remove this record">×</button></div>`).join('')}
    <div class="actions"><button class="small" data-act="add-rec">+ Add</button>${records.length ? '' : '<span class="muted">no records: an empty list</span>'}</div>
  </div>`;
}

/** The records as the text that is stored: one per line, every field named, values that need it quoted. */
function recordsText(records, fields) {
  const word = (v) => (v == null ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : /[,;"\n]/.test(String(v)) ? JSON.stringify(String(v)) : String(v));
  return records.map((r) => fields.map((f) => `${f.name}=${word(r[f.name])}`).join(', ')).join('\n');
}

/** What the form says right now, written back into the scenario. */
function applyRecords(box) {
  const name = box.dataset.records, i = store.doc.inputs.find((x) => x.name === name);
  if (!i) return;
  const fields = (i.fields ?? []).filter((f) => f.name);
  const records = [...box.querySelectorAll('.rec[data-rec]')].map((row) => Object.fromEntries(fields.map((f) => [f.name, row.querySelector(`[data-rf="${CSS.escape(f.name)}"]`)?.value ?? ''])));
  commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); s.inputs[name] = recordsText(records, fields); });
}

export function inputControl(i, value, attrs, compact = false) {
  const v = value == null ? '' : String(value);
  if (i.type === 'list') {
    const hint = (i.fields ?? []).map((f) => `${f.name}=${f.type === 'enum' ? f.values?.[0] ?? '…' : f.type === 'boolean' ? 'yes' : f.type === 'number' ? '1' : '…'}`).join(', ');
    return compact
      ? `<input type="text" class="records" ${attrs} value="${esc(v)}" placeholder="${esc(hint)}; …" title="Records, separated by ; or one per line in the panel">`
      : `<textarea class="records" ${attrs} placeholder="one record per line, e.g.\n${esc(hint)}">${esc(v)}</textarea>`;
  }
  if (i.type === 'enum') return `<select ${attrs}><option value=""></option>${(i.values ?? []).map((x) => opt(x, v)).join('')}</select>`;
  if (i.type === 'boolean') return `<select ${attrs}><option value="" ${v === '' ? 'selected' : ''}></option><option value="true" ${['true', 'yes', '1'].includes(v.toLowerCase()) ? 'selected' : ''}>yes</option><option value="false" ${['false', 'no', '0'].includes(v.toLowerCase()) ? 'selected' : ''}>no</option></select>`;
  if (i.type === 'number') return `<input type="number" ${attrs} value="${esc(v)}">`;
  return `<input type="text" ${attrs} value="${esc(v)}">`;
}

function verdictHtml() {
  const r = activeRun();
  if (!r) return '';
  // Each step is a link to its node: "it got stuck here" wants a click, not a search on the canvas.
  const path = r.result.steps.map((st) => `<span class="step ${r.result.error?.at === st.node ? 'stuck' : ''}" data-step="${esc(st.node)}" title="Select this node">${esc(store.doc.nodes.find((n) => n.id === st.node)?.label)}</span>`).join(' → ');
  if (r.verdict.pass) return `<div class="verdict ok"><b>Passes.</b> ${path}</div>`;
  const accept = r.result.error ? '' : `<div><button class="small accept" data-act="accept" title="Replace the expected actions, landing and state with what this run did">Use this run as the expectation</button></div>`;
  return `<div class="verdict bad"><b>${r.result.error ? 'Got stuck.' : 'Does not match.'}</b> ${path}<ul>${r.verdict.issues.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul>${accept}</div>`;
}

// ---- patching in place ------------------------------------------------------------------------

function patchLive() { patchVerdict(); patchHappened(); patchChecks(); }

function patchVerdict() { const v = el.querySelector('#verdict'); if (v) v.innerHTML = verdictHtml(); }

/** The ✓ / ✗ beside each expected action: did it happen in the selected scenario's last run? */
function patchHappened() {
  const r = activeRun();
  const did = new Set(r?.result.actions ?? []);
  for (const box of el.querySelectorAll('[data-scn-action]')) {
    const mark = box.parentElement.querySelector('.did');
    if (!mark) continue;
    const yes = did.has(box.dataset.scnAction);
    mark.className = `did ${r ? (yes ? 'yes' : 'no') : ''}`;
    mark.textContent = r ? (yes ? '✓' : '✗') : '';
    mark.title = r ? (yes ? 'happened in the last run' : 'did not happen in the last run') : '';
  }
}

function patchChecks() {
  const known = knownNames(store.doc), lists = listsOf(store.doc);
  const boxes = new Map();   // the .row (or the control itself) → every message for the controls in it
  for (const c of roots.flatMap((r) => [...r.querySelectorAll('[data-check]')])) {
    const ms = problemsOf(c, known, lists);
    c.classList.toggle('invalid', ms.some((m) => m.cls === 'err'));
    const box = c.closest('.row') ?? c;
    boxes.set(box, (boxes.get(box) ?? []).concat(ms));
  }
  for (const [box, ms] of boxes) {
    const out = box.nextElementSibling;
    if (out?.classList.contains('errs')) out.innerHTML = ms.map((m) => `<div class="${m.cls}">${esc(m.text)}</div>`).join('');
  }
}

const err = (text) => ({ cls: 'err', text }), warn = (text) => ({ cls: 'warn', text }), note = (text) => ({ cls: 'muted', text });

/** What is wrong with one control's current text, judged against the document as it stands. */
function problemsOf(c, known, lists) {
  const { doc } = store, d = c.dataset, v = c.value;
  if (d.edge === 'when') return c.disabled ? [] : check(v, known, lists).map(err);
  if (d.f === 'src') {
    const field = c.closest('.row').querySelector('[data-f="field"]').value;
    return (doc.state.some((f) => f.name === field) ? [] : [err(`${field} is not a declared state field`)]).concat(check(v, known, lists).map(err));
  }
  if (d.f === 'fname') {
    const i = doc.inputs[Number(c.closest('[data-input]').dataset.input)], j = Number(c.closest('[data-lf]').dataset.lf);
    if (!IDENT.test(v)) return [err(v.trim() ? 'a name is letters, digits and _, and starts with a letter' : 'it needs a name')];
    if (RESERVED.has(v)) return [err(`${v} is a word of the condition language; pick another name`)];
    if ((i.fields ?? []).some((f, k) => k !== j && f.name === v)) return [err(`another field of ${i.name} is already called ${v}`)];
    return [];
  }
  // An initial value is taken as written unless it reads as an expression over the inputs, in
  // which case it starts as that value; say which, so `pending` and `pendingOrders` both make sense.
  if (d.f === 'initial') return initialIsExpression(doc, v) && !/^[0-9]/.test(v.trim()) && !doc.inputs.every((i) => !new RegExp(`\\b${i.name}\\b`).test(v)) ? [note(`starts as the value of ${v.trim()}`)] : [];
  if (d.f === 'name') {
    const row = c.closest('[data-input], [data-state]'), ix = Number(row.dataset.input ?? -1), sx = Number(row.dataset.state ?? -1);
    const taken = doc.inputs.filter((_, j) => j !== ix).map((x) => x.name).concat(doc.state.filter((_, j) => j !== sx).map((x) => x.name));
    if (!IDENT.test(v)) return [err(v.trim() ? 'a name is letters, digits and _, and starts with a letter' : 'it needs a name')];
    if (RESERVED.has(v)) return [err(`${v} is a word of the condition language; pick another name`)];
    if (taken.includes(v)) return [err(`another input or state field is already called ${v}`)];
    return [];
  }
  if (d.f === 'values') {
    const i = doc.inputs[Number(c.closest('[data-input]').dataset.input)];
    const vals = v.split(',').map((s) => s.trim());
    const listed = new Set(vals.filter(Boolean));
    const out = [];
    const twice = [...new Set(vals.filter((x, j) => x && vals.indexOf(x) !== j))];
    if (twice.length) out.push(err(`listed twice: ${twice.join(', ')}`));
    if (vals.slice(0, -1).some((x) => !x)) out.push(err('there is an empty value between two commas'));
    if (!listed.size) out.push(err('no values yet; a scenario has nothing to pick'));
    // A value taken off the list does not vanish from the scenarios that chose it; say who did.
    const stale = new Map();
    for (const s of doc.scenarios) { const x = s.inputs[i.name]; if (x != null && x !== '' && !listed.has(String(x))) stale.set(x, (stale.get(x) ?? []).concat(s.name || '(unnamed)')); }
    for (const [x, who] of stale) out.push(warn(`${x} is no longer listed, but ${who.length === 1 ? 'scenario' : 'scenarios'} ${who.map((n) => `"${n}"`).join(', ')} still use${who.length === 1 ? 's' : ''} it`));
    out.push(note(`${listed.size} value${listed.size === 1 ? '' : 's'}`));
    return out;
  }
  return [];
}

// ---- edits ------------------------------------------------------------------------------------

/**
 * Copy what a run did into what its scenario expects: the actions, the end, the state it left.
 * One commit, so one undo. Nothing happens for a run that got stuck; fix the drawing first.
 */
export function acceptRun(id) {
  const r = store.results?.results.find((x) => x.scenario.id === id);
  if (!r || r.result.error) return;
  const cell = (v) => v == null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  commit((doc) => {
    const s = doc.scenarios.find((s) => s.id === id);
    s.expect.actions = [...new Set(r.result.actions)];
    s.expect.end = r.result.end ?? '';
    s.expect.state = Object.fromEntries(doc.state.map((f) => [f.name, cell(r.result.state[f.name])]));
  });
}

/**
 * Is `name` an input or state field other than `self`? A rename onto such a name must not fold
 * two fields into one, and a rename away from one (the keystroke after a collision) must not
 * carry the other field's mentions along. Either way the mentions stay put and lint points at them.
 */
const taken = (doc, name, self) => doc.inputs.some((x) => x !== self && x.name === name) || doc.state.some((x) => x !== self && x.name === name);
const follow = (doc, from, to, self) => { if (!taken(doc, from, self) && !taken(doc, to, self)) renameName(doc, from, to); };

for (const r of roots) r.addEventListener('input', (ev) => {
  const t = ev.target;
  const d = t.dataset;
  if (d.doc) return commit((doc) => { doc[d.doc] = t.value; });
  if (d.node) return commit((doc) => { const n = doc.nodes.find((n) => n.id === store.selection.id); n[d.node] = t.value; });
  if (d.edge === 'when' || d.edge === 'label') return commit((doc) => { const e = doc.edges.find((e) => e.id === store.selection.id); e[d.edge] = t.value; });
  if (d.scn) return commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); if (d.scn === 'end') s.expect.end = t.value; else if (d.scn === 'tags') s.tags = parseTags(t.value); else s[d.scn] = t.value; });
  if (d.scnInput) return commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); s.inputs[d.scnInput] = t.value; });
  if (d.rf != null) return applyRecords(t.closest('[data-records]'));
  if (d.scnState) return commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); s.expect.state ??= {}; s.expect.state[d.scnState] = t.value; });
  // Renaming an input or a state field carries every mention of it along, in the same commit, so
  // the guards keep working and one undo brings the old name back everywhere.
  const inputRow = t.closest('[data-input]');
  if (inputRow) return commit((doc) => {
    const i = doc.inputs[Number(inputRow.dataset.input)];
    const fieldRow = t.closest('[data-lf]');
    if (fieldRow) {
      const f = i.fields[Number(fieldRow.dataset.lf)];
      if (d.f === 'fname') f.name = t.value;
      else if (d.f === 'ftype') f.type = t.value;
      else if (d.f === 'fvalues') f.values = t.value.split(',').map((s) => s.trim()).filter(Boolean);
      return;
    }
    if (d.f === 'values') i.values = t.value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (d.f === 'name') { const from = i.name; i.name = t.value; follow(doc, from, t.value, i); }
    else if (d.f === 'type') { i.type = t.value; if (t.value === 'list') i.fields ??= [{ name: 'status', type: 'text' }]; }
    else i[d.f] = t.value;
  });
  const stateRow = t.closest('[data-state]');
  if (stateRow) return commit((doc) => {
    const f = doc.state[Number(stateRow.dataset.state)];
    if (d.f === 'initial') f.initial = t.value === '' ? null : t.value;
    else { const from = f.name; f.name = t.value; follow(doc, from, t.value, f); }
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

for (const r of roots) r.addEventListener('change', (ev) => {
  const t = ev.target;
  const d = t.dataset;
  if (d.insert != null) {
    // A pick goes into the condition beside the menu; the panel is not rebuilt, so the cursor stays put.
    const input = t.parentElement.querySelector('[data-edge="when"]');
    if (t.value && input) { insertAt(input, t.value); commit((doc) => { const e = doc.edges.find((e) => e.id === store.selection.id); e.when = input.value; }); }
    t.value = '';
    return;
  }
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

for (const r of roots) r.addEventListener('click', (ev) => {
  const step = ev.target.closest('[data-step]');
  if (step) return select({ type: 'node', id: step.dataset.step });
  const drop = ev.target.closest('[data-drop]');
  if (drop) return selectNodes(selectedNodeIds().filter((id) => id !== drop.dataset.drop));
  const one = ev.target.closest('[data-one]');
  if (one) return select({ type: 'node', id: one.dataset.one });
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const sel = store.selection;
  if (act === 'flow-settings') return openSettings();
  if (act === 'open-settings') return openSettings(b.dataset.focus);
  if (act === 'add-input-open') { commit((doc) => { doc.inputs.push({ name: `input${doc.inputs.length + 1}`, type: 'text' }); }); return openSettings('input:last'); }
  if (act === 'add-state-open') { commit((doc) => { doc.state.push({ name: `field${doc.state.length + 1}`, initial: null }); }); return openSettings('state:last'); }
  if (act === 'add-input') commit((doc) => { doc.inputs.push({ name: `input${doc.inputs.length + 1}`, type: 'text' }); });
  if (act === 'rm-input') commit((doc) => { doc.inputs.splice(Number(b.closest('[data-input]').dataset.input), 1); });
  if (act === 'add-rec') { const box = b.closest('[data-records]'), i = store.doc.inputs.find((x) => x.name === box.dataset.records), fields = (i?.fields ?? []).filter((f) => f.name); commit((doc) => { const s = doc.scenarios.find((s) => s.id === sel.id); const have = parseRecords(s.inputs[i.name], fields); have.push(Object.fromEntries(fields.map((f) => [f.name, f.type === 'enum' ? f.values?.[0] ?? '' : f.type === 'boolean' ? false : '']))); s.inputs[i.name] = recordsText(have, fields); }); }
  if (act === 'rm-rec') { const box = b.closest('[data-records]'), i = store.doc.inputs.find((x) => x.name === box.dataset.records), fields = (i?.fields ?? []).filter((f) => f.name), k = Number(b.closest('[data-rec]').dataset.rec); commit((doc) => { const s = doc.scenarios.find((s) => s.id === sel.id); const have = parseRecords(s.inputs[i.name], fields); have.splice(k, 1); s.inputs[i.name] = recordsText(have, fields); }); }
  if (act === 'records-text') recordsAsText.add(b.dataset.list);
  if (act === 'records-form') recordsAsText.delete(b.dataset.list);
  if (act === 'mv-input') commit((doc) => swap(doc.inputs, Number(b.closest('[data-input]').dataset.input), Number(b.dataset.dir)));
  if (act === 'mv-state') commit((doc) => swap(doc.state, Number(b.closest('[data-state]').dataset.state), Number(b.dataset.dir)));
  if (act === 'mv-field') commit((doc) => swap(doc.inputs[Number(b.closest('[data-input]').dataset.input)].fields, Number(b.closest('[data-lf]').dataset.lf), Number(b.dataset.dir)));
  if (act === 'add-field') commit((doc) => { const i = doc.inputs[Number(b.closest('[data-input]').dataset.input)]; i.fields ??= []; i.fields.push({ name: `field${i.fields.length + 1}`, type: 'text' }); });
  if (act === 'rm-field') commit((doc) => { const i = doc.inputs[Number(b.closest('[data-input]').dataset.input)]; i.fields.splice(Number(b.closest('[data-lf]').dataset.lf), 1); });
  if (act === 'add-state') commit((doc) => { doc.state.push({ name: `field${doc.state.length + 1}`, initial: null }); });
  if (act === 'rm-state') commit((doc) => { doc.state.splice(Number(b.closest('[data-state]').dataset.state), 1); });
  if (act === 'add-set') commit((doc) => { const n = doc.nodes.find((n) => n.id === sel.id); n.set ??= {}; const free = doc.state.find((f) => !(f.name in n.set)); if (free) n.set[free.name] = ''; });
  if (act === 'rm-set') commit((doc) => { const n = doc.nodes.find((n) => n.id === sel.id); const entries = Object.entries(n.set ?? {}); entries.splice(Number(b.closest('[data-set]').dataset.set), 1); n.set = Object.fromEntries(entries); });
  if (act === 'align-left') alignSelected('left');
  if (act === 'align-top') alignSelected('top');
  if (act === 'rm-group') return deleteSelectedNodes();
  if (act === 'rm-node') { commit((doc) => { doc.nodes = doc.nodes.filter((n) => n.id !== sel.id); doc.edges = doc.edges.filter((e) => e.from !== sel.id && e.to !== sel.id); }); select(null); }
  if (act === 'edge-shape') commit((doc) => { const e = doc.edges.find((e) => e.id === sel.id); if (b.dataset.shape === 'square') e.shape = 'square'; else delete e.shape; });
  if (act === 'edge-color') commit((doc) => { const e = doc.edges.find((e) => e.id === sel.id); if (b.dataset.color) e.color = b.dataset.color; else delete e.color; });
  if (act === 'rm-edge') { commit((doc) => { doc.edges = doc.edges.filter((e) => e.id !== sel.id); }); select(null); }
  if (act === 'rm-scn') { commit((doc) => { doc.scenarios = doc.scenarios.filter((s) => s.id !== sel.id); }); select(null); }
  if (act === 'dup-scn') { const id = uid('s'); commit((doc) => { const s = doc.scenarios.find((s) => s.id === sel.id); const i = doc.scenarios.indexOf(s); doc.scenarios.splice(i + 1, 0, { ...structuredClone(s), id, name: s.name + ' (copy)' }); }); select({ type: 'scenario', id }); }
  if (act === 'accept') acceptRun(sel.id);
  if (act === 'play') el.dispatchEvent(new CustomEvent('play', { bubbles: true }));
  b.blur();
  render();
});
