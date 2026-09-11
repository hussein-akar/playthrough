// The side panel: whatever is selected, editable. Nothing selected shows the flow itself, which
// is where inputs and state fields are declared, because the guards can only mention what is
// declared here.
import { store, commit, select, selectNodes, selectedNodeIds, uid, activeRun, renameName } from './store.mjs';
import { alignSelected, deleteSelectedNodes } from './canvas.mjs';
import { check } from '../lib/expr.mjs';
import { knownNames } from '../lib/run.mjs';

const el = document.getElementById('inspector');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** True while the user is typing in a control inside `node`; a focused button does not count. */
export const editing = (node) => { const a = document.activeElement; return node.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName); };
const opt = (v, cur, label = v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'null']);   // the words of the condition language, which a name cannot be

export function render() {
  // Never rebuild under the user's cursor: a keystroke commits, and the commit re-renders. What
  // must follow the keystroke anyway (the verdict, the messages under the expressions) is patched
  // into the existing markup instead.
  if (editing(el)) { patchLive(); return; }
  const { doc, selection } = store;
  if (!selection) el.innerHTML = flowView(doc);
  else if (selection.type === 'node' && selection.ids) el.innerHTML = groupView(doc, selection.ids);
  else if (selection.type === 'node') el.innerHTML = nodeView(doc, doc.nodes.find((n) => n.id === selection.id));
  else if (selection.type === 'edge') el.innerHTML = edgeView(doc, doc.edges.find((e) => e.id === selection.id));
  else if (selection.type === 'scenario') el.innerHTML = scenarioView(doc, doc.scenarios.find((s) => s.id === selection.id));
  patchLive();
}

el.addEventListener('focusout', () => setTimeout(() => { if (!el.contains(document.activeElement)) render(); }, 0));

// ---- views ------------------------------------------------------------------------------------
// A control with `data-check` is validated by `problemsOf`; its messages go into the `.errs` box
// that follows the control, or the `.row` it sits in. The views emit the boxes empty and
// `patchChecks` fills them, at build time and again on every keystroke.

function flowView(doc) {
  const inputs = doc.inputs.map((i, k) => `
    <div class="row" data-input="${k}">
      <input type="text" data-f="name" data-check value="${esc(i.name)}" placeholder="name">
      <select data-f="type">${['enum', 'boolean', 'number', 'text'].map((t) => opt(t, i.type)).join('')}</select>
      <button class="icon danger" data-act="rm-input" title="Remove">×</button>
    </div><div class="errs"></div>
    ${i.type === 'enum' ? `<div class="field" data-input="${k}"><input type="text" data-f="values" data-check value="${esc((i.values ?? []).join(', '))}" placeholder="values, comma separated"><div class="errs"></div></div>` : ''}`).join('');
  const state = doc.state.map((f, k) => `
    <div class="row" data-state="${k}">
      <input type="text" data-f="name" data-check value="${esc(f.name)}" placeholder="field">
      <input type="text" class="expr" data-f="initial" data-check value="${esc(f.initial ?? '')}" placeholder="initial value" title="The value before any action sets it. Blank means null.">
      <button class="icon danger" data-act="rm-state" title="Remove">×</button>
    </div><div class="errs"></div>`).join('');
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
  const setBlock = !doc.state.length ? 'Declare a state field on the flow first (click the empty canvas).' : doc.state.every((f) => f.name in (n.set ?? {})) ? 'Every state field is already set here.' : '';
  const sets = Object.entries(n.set ?? {}).map(([field, src], k) => `<div class="row" data-set="${k}">
      <select data-f="field">${doc.state.map((f) => opt(f.name, field)).join('')}${doc.state.some((f) => f.name === field) ? '' : opt(field, field)}</select>
      <input type="text" class="expr" data-f="src" data-check value="${esc(src)}" placeholder="expression">
      <button class="icon danger" data-act="rm-set" title="Remove">×</button>
    </div><div class="errs"></div>`).join('');
  return `
    <h2>${esc(n.kind)} node</h2>
    <div class="field"><label>Label</label><input type="text" data-node="label" value="${esc(n.label)}"></div>
    <div class="field"><label>Kind</label><select data-node="kind">${['start', 'action', 'decision', 'end'].map((k) => opt(k, n.kind)).join('')}</select></div>
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
      <input type="text" class="expr" data-edge="when" data-check value="${esc(e.when)}" placeholder="e.g. type in [Subscription, Refund]" ${e.else ? 'disabled' : ''}>
      <div class="errs"></div>
    </div>
    <div class="field checks"><label><input type="checkbox" data-edge="else" ${e.else ? 'checked' : ''}> <span>else: taken when no other branch matches</span></label></div>
    <div class="field"><label>Label <span class="muted">· shown when there is no condition</span></label><input type="text" data-edge="label" value="${esc(e.label ?? '')}"></div>
    <div class="actions"><button class="small danger" data-act="rm-edge">Delete edge</button></div>`;
}

function scenarioView(doc, s) {
  if (!s) return '';
  const actions = [...new Set(flowOrder(doc).filter((n) => n.kind === 'action').map((n) => n.label))];
  const ends = doc.nodes.filter((n) => n.kind === 'end').map((n) => n.label);
  const want = new Set(s.expect.actions ?? []);
  return `
    <h2>Scenario</h2>
    <div class="field"><label>Name</label><input type="text" data-scn="name" value="${esc(s.name)}"></div>
    <h2>Inputs</h2>
    ${doc.inputs.map((i) => `<div class="field"><label>${esc(i.name)}</label>${inputControl(i, s.inputs[i.name], `data-scn-input="${esc(i.name)}"`)}</div>`).join('') || '<div class="muted">The flow declares no inputs yet.</div>'}
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
  const known = knownNames(store.doc);
  const boxes = new Map();   // the .row (or the control itself) → every message for the controls in it
  for (const c of el.querySelectorAll('[data-check]')) {
    const ms = problemsOf(c, known);
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
function problemsOf(c, known) {
  const { doc } = store, d = c.dataset, v = c.value;
  if (d.edge === 'when') return c.disabled ? [] : check(v, known).map(err);
  if (d.f === 'src') {
    const field = c.closest('.row').querySelector('[data-f="field"]').value;
    return (doc.state.some((f) => f.name === field) ? [] : [err(`${field} is not a declared state field`)]).concat(check(v, known).map(err));
  }
  // The runner takes an initial value as it is written, not as an expression (see initialState in
  // lib/run.mjs), so `pending` is a fine initial value and there is nothing to check here.
  if (d.f === 'initial') return [];
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

el.addEventListener('input', (ev) => {
  const t = ev.target;
  const d = t.dataset;
  if (d.doc) return commit((doc) => { doc[d.doc] = t.value; });
  if (d.node) return commit((doc) => { const n = doc.nodes.find((n) => n.id === store.selection.id); n[d.node] = t.value; });
  if (d.edge === 'when' || d.edge === 'label') return commit((doc) => { const e = doc.edges.find((e) => e.id === store.selection.id); e[d.edge] = t.value; });
  if (d.scn) return commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); if (d.scn === 'end') s.expect.end = t.value; else s[d.scn] = t.value; });
  if (d.scnInput) return commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); s.inputs[d.scnInput] = t.value; });
  if (d.scnState) return commit((doc) => { const s = doc.scenarios.find((s) => s.id === store.selection.id); s.expect.state ??= {}; s.expect.state[d.scnState] = t.value; });
  // Renaming an input or a state field carries every mention of it along, in the same commit, so
  // the guards keep working and one undo brings the old name back everywhere.
  const inputRow = t.closest('[data-input]');
  if (inputRow) return commit((doc) => {
    const i = doc.inputs[Number(inputRow.dataset.input)];
    if (d.f === 'values') i.values = t.value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (d.f === 'name') { const from = i.name; i.name = t.value; follow(doc, from, t.value, i); }
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
  if (act === 'add-input') commit((doc) => { doc.inputs.push({ name: `input${doc.inputs.length + 1}`, type: 'text' }); });
  if (act === 'rm-input') commit((doc) => { doc.inputs.splice(Number(b.closest('[data-input]').dataset.input), 1); });
  if (act === 'add-state') commit((doc) => { doc.state.push({ name: `field${doc.state.length + 1}`, initial: null }); });
  if (act === 'rm-state') commit((doc) => { doc.state.splice(Number(b.closest('[data-state]').dataset.state), 1); });
  if (act === 'add-set') commit((doc) => { const n = doc.nodes.find((n) => n.id === sel.id); n.set ??= {}; const free = doc.state.find((f) => !(f.name in n.set)); if (free) n.set[free.name] = ''; });
  if (act === 'rm-set') commit((doc) => { const n = doc.nodes.find((n) => n.id === sel.id); const entries = Object.entries(n.set ?? {}); entries.splice(Number(b.closest('[data-set]').dataset.set), 1); n.set = Object.fromEntries(entries); });
  if (act === 'align-left') alignSelected('left');
  if (act === 'align-top') alignSelected('top');
  if (act === 'rm-group') return deleteSelectedNodes();
  if (act === 'rm-node') { commit((doc) => { doc.nodes = doc.nodes.filter((n) => n.id !== sel.id); doc.edges = doc.edges.filter((e) => e.from !== sel.id && e.to !== sel.id); }); select(null); }
  if (act === 'rm-edge') { commit((doc) => { doc.edges = doc.edges.filter((e) => e.id !== sel.id); }); select(null); }
  if (act === 'rm-scn') { commit((doc) => { doc.scenarios = doc.scenarios.filter((s) => s.id !== sel.id); }); select(null); }
  if (act === 'dup-scn') { const id = uid('s'); commit((doc) => { const s = doc.scenarios.find((s) => s.id === sel.id); const i = doc.scenarios.indexOf(s); doc.scenarios.splice(i + 1, 0, { ...structuredClone(s), id, name: s.name + ' (copy)' }); }); select({ type: 'scenario', id }); }
  if (act === 'accept') acceptRun(sel.id);
  if (act === 'play') el.dispatchEvent(new CustomEvent('play', { bubbles: true }));
  b.blur();
  render();
});
