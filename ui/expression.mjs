// "What you can write here": the dialog behind the ƒx beside every expression box — a guard on an
// edge, what an action sets, what a state field starts as.
//
// Writing one of these used to mean remembering what the flow declared. The names are two panels
// away, a list's fields are further still, and the box itself says nothing back until the drawing
// is played. So this shows, in one place: every name in scope here, every field of every list,
// every value an enum takes, the functions with what each takes and an example, and a builder for
// the shape that is hardest to type from memory — a question about the records of a list.
//
// The bar at the top is the box itself. It commits on every keystroke, as every other field in the
// app does, so ⌘Z takes it back; under it is what the expression comes to against a real scenario,
// which is the part no cheat sheet can give: `lines.count(picked < qty)` is right or wrong in a way
// you can see.
import { store } from './store.mjs';
import { LIBRARY, check, ambiguous, compile, evaluate, names } from '../lib/expr.mjs';
import { knownNames, listsOf, enumsOf, coerceInputs, initialState } from '../lib/run.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// What the box being written is, and how to read and write it. `kind` decides what is in scope:
// a state field's initial value is worked out before any action has run, so no state is in it.
let target = null;
let detail = null;        // what the right-hand pane is showing, kept across re-renders
let find = '';

/**
 * Open the dialog on one expression box.
 * `kind` is 'guard', 'set' or 'initial'; `what` is the line under the title saying which box it is;
 * `get` and `set` read and write the document.
 */
export function show({ kind, what, get, set }) {
  target = { kind, what, get, set };
  detail = null;
  find = '';
  $('writeFind').value = '';
  $('writeBar').value = get();
  render();
  $('writeDialog').showModal();
  $('writeBar').focus();
  const at = $('writeBar').value.length;
  $('writeBar').setSelectionRange(at, at);
}

/**
 * The scenario the preview is run against: the selected one, else the first whose inputs can be
 * read at all — a row with an unreadable list cell is not the one to judge an expression by, and
 * there is usually another.
 */
function sample() {
  const { doc } = store;
  const selected = store.selection?.type === 'scenario' && doc.scenarios.find((x) => x.id === store.selection.id);
  for (const s of selected ? [selected, ...doc.scenarios] : doc.scenarios) {
    try {
      const inputs = coerceInputs(doc, s.inputs);
      return { name: s.name || '(unnamed)', scope: { inputs, state: initialState(doc, inputs), enums: enumsOf(doc) } };
    } catch { /* this row cannot be read; the next one can say what the expression comes to */ }
  }
  return null;
}

/** The names this box may mention, and where each comes from. */
function scope() {
  const { doc } = store;
  const out = [];
  for (const i of doc.inputs) if (i.name) out.push({ name: i.name, group: 'In scope', role: `input · ${i.type}`, input: i });
  if (target.kind !== 'initial') for (const f of doc.state) if (f.name) out.push({ name: f.name, group: 'In scope', role: 'state field', state: f });
  for (const i of doc.inputs) {
    if (i.type !== 'list') continue;
    for (const f of i.fields ?? []) if (f.name) out.push({ name: `${i.name}.${f.name}`, group: 'Record fields', role: `a field of one ${i.name} record · ${f.type}`, field: f, of: i });
  }
  for (const i of doc.inputs) {
    if (i.type === 'enum') for (const v of i.values ?? []) out.push({ name: v, group: 'Values', role: `a value of ${i.name}`, value: v, of: i });
    if (i.type === 'list') for (const f of i.fields ?? []) if (f.type === 'enum') for (const v of f.values ?? []) out.push({ name: v, group: 'Values', role: `a value of ${i.name}.${f.name}`, value: v, of: i });
  }
  return out;
}

/** The lists a question can be asked about: the list inputs, and the state fields, which often hold one. */
const listables = () => store.doc.inputs.filter((i) => i.type === 'list' && i.name)
  .map((i) => ({ name: i.name, fields: i.fields ?? [] }))
  .concat(target.kind === 'initial' ? [] : store.doc.state.filter((f) => f.name).map((f) => ({ name: f.name, fields: fieldsOfState(f) })));

/** A state field's fields, when its initial value narrows a list input: `items where inStock` has items' fields. */
function fieldsOfState(f) {
  try {
    const root = names(compile(String(f.initial ?? '')))[0]?.split('.')[0];
    return store.doc.inputs.find((i) => i.name === root && i.type === 'list')?.fields ?? [];
  } catch { return []; }
}

// ---- rendering ---------------------------------------------------------------------------------

const chip = (name, key) => `<button type="button" class="tok" data-pick="${esc(key)}">${esc(name)}</button>`;
/** A function's chip reads as what typing it looks like, so the method `count` and the older `count()` are told apart. */
const label = (e) => (e.kind === 'method' ? `.${e.name}` : e.kind === 'function' ? `${e.name}()` : e.name);
const band = (title, n, body) => `<div class="band"><span class="k">${esc(title)}</span><span class="n">${n}</span></div>${body}`;

function render() {
  $('writeWhat').textContent = target.what;
  renderList();
  renderDetail();
  renderBar();
}

function renderList() {
  const q = find.trim().toLowerCase();
  const hit = (s) => !q || String(s).toLowerCase().includes(q);
  const out = [];
  for (const group of ['In scope', 'Record fields', 'Values']) {
    const items = scope().filter((e) => e.group === group && (hit(e.name) || hit(e.role)));
    if (items.length) out.push(band(group, items.length, `<div class="toks">${items.map((e) => chip(e.name, `name:${e.name}:${e.group}`)).join('')}</div>`));
  }
  if (!q) out.push(band('Build a question about a list', '', builder()));
  const groups = [...new Set(LIBRARY.map((e) => e.group))];
  const fns = LIBRARY.filter((e) => hit(e.name) || hit(label(e)) || hit(e.form) || hit(e.what));
  if (fns.length) out.push(band('Functions and operators', fns.length, groups.map((g) => {
    const items = fns.filter((e) => e.group === g);
    return items.length ? `<div class="sub">${esc(g)}</div><div class="toks">${items.map((e) => chip(label(e), `fn:${e.group}:${e.kind}:${e.name}`)).join('')}</div>` : '';
  }).join('')));
  if (!out.length) out.push('<div class="muted empty">Nothing here is called that.</div>');
  $('writeList').innerHTML = out.join('');
}

/**
 * The one shape nobody types right from memory: a question about the records of a list. Pick the
 * list, what is being asked, and the field it turns on, and the sentence under it is the expression
 * — which is also the point, because reading it back is how the shape gets learnt.
 */
const ASKS = [
  { v: 'any', label: 'is there one where…', form: (l, c) => `${l}.any(${c})` },
  { v: 'none', label: 'is there none where…', form: (l, c) => `${l}.none(${c})` },
  { v: 'all', label: 'are they all…', form: (l, c) => `${l}.all(${c})` },
  { v: 'count', label: 'how many where…', form: (l, c) => `${l}.count(${c})` },
  { v: 'filter', label: 'the ones where…', form: (l, c) => `${l}.filter(${c})` },
  { v: 'size', label: 'how many there are', form: (l) => `${l}.size`, whole: true },
];
const OPS = ['==', '!=', '>', '>=', '<', '<=', 'in'];

function builder() {
  const lists = listables();
  if (!lists.length) return '<div class="muted empty">No list input yet. Declare one in Flow config and its records can be asked about here.</div>';
  const pick = (id, options, cur) => `<select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const list = lists.find((l) => l.name === built.list) ?? lists[0];
  const ask = ASKS.find((a) => a.v === built.ask) ?? ASKS[0];
  return `<div class="builder">
    <label>List ${pick('bList', lists.map((l) => [l.name, l.name]), list.name)}</label>
    <label>Asking ${pick('bAsk', ASKS.map((a) => [a.v, a.label]), ask.v)}</label>
    ${ask.whole ? '' : `<label>Field ${pick('bField', [['', '(every record)']].concat(list.fields.filter((f) => f.name).map((f) => [f.name, f.name])), built.field)}</label>
      ${built.field ? `<label>Is ${pick('bOp', OPS.map((o) => [o, o]), built.op)}</label>
      <label>Value ${valueControl(list, built.field)}</label>` : ''}`}
    <div class="out"><code>${esc(builtExpression()) || '—'}</code><button type="button" class="small" data-act="insert-built" ${builtExpression() ? '' : 'disabled'}>Insert</button></div>
  </div>`;
}

let built = { list: '', ask: 'any', field: '', op: '==', value: '' };

function valueControl(list, field) {
  const f = list.fields.find((x) => x.name === field);
  if (f?.type === 'enum' && f.values?.length) return `<select id="bValue">${f.values.map((v) => `<option ${v === built.value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  if (f?.type === 'boolean') return `<select id="bValue">${['true', 'false'].map((v) => `<option ${v === built.value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  return `<input type="text" id="bValue" value="${esc(built.value)}" placeholder="${f?.type === 'number' ? '1' : 'a value'}" spellcheck="false">`;
}

/** What the builder's picks add up to, or '' when it is not a whole question yet. */
function builtExpression() {
  const lists = listables();
  const list = lists.find((l) => l.name === built.list) ?? lists[0];
  if (!list) return '';
  const ask = ASKS.find((a) => a.v === built.ask) ?? ASKS[0];
  if (ask.whole) return ask.form(list.name);
  if (!built.field) return ask.v === 'filter' || ask.v === 'all' ? '' : ask.form(list.name, '');
  const f = list.fields.find((x) => x.name === built.field);
  const v = built.value.trim();
  if (!v) return '';
  // An enum value and a number stand as they are written; anything else is quoted, so a value with
  // a space in it is still one value and not a syntax error in the box.
  const lit = built.op === 'in' ? `(${v})` : f?.type === 'number' || f?.type === 'boolean' || /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? v : JSON.stringify(v);
  return ask.form(list.name, `${built.field} ${built.op} ${lit}`);
}

function renderDetail() {
  $('writeDetail').innerHTML = detail ? detailHtml(detail) : `<p class="lead">Pick a name or a function to see what it is, what it takes and an example run against this flow. Clicking one puts it in the bar; clicking an example replaces what is there, and ⌘Z brings it back.</p>`;
}

function detailHtml(key) {
  const [what, ...rest] = key.split(':');
  if (what === 'fn') {
    const [group, kind, name] = rest;
    const e = LIBRARY.find((x) => x.group === group && x.kind === kind && x.name === name);
    if (!e) return '';
    return `<h4>${esc(e.form)}</h4>
      <div class="role">takes ${esc(e.takes)}</div>
      <p>${esc(e.what)}</p>
      ${example(e.example)}`;
  }
  const name = rest.slice(0, -1).join(':'), group = rest[rest.length - 1];
  const e = scope().find((x) => x.name === name && x.group === group);
  if (!e) return '';
  const lines = [];
  if (e.input?.type === 'enum') lines.push(`one of ${(e.input.values ?? []).join(', ') || 'nothing yet'}`);
  if (e.input?.type === 'list') lines.push(`records of ${(e.input.fields ?? []).map((f) => f.name).join(', ') || 'no declared fields'}`);
  if (e.field?.type === 'enum') lines.push(`one of ${(e.field.values ?? []).join(', ') || 'nothing yet'}`);
  if (e.state) lines.push(e.state.initial == null || String(e.state.initial).trim() === '' ? 'null until an action sets it' : `${e.state.initial} until an action sets it`);
  return `<h4>${esc(name)}</h4>
    <div class="role">${esc(e.role)}</div>
    ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
    ${e.field ? `<p class="muted">A field is read inside a question about its list: <code>${esc(recordAsk(e, 'any'))}</code>.</p>` : ''}
    ${valueNow(e)}
    ${example(exampleFor(e))}`;
}

/** What this name holds in the scenario the preview runs against: the answer to "what is in it again?". */
function valueNow(e) {
  const s = sample();
  if (!s || e.value) return '';
  const src = e.field ? e.of.name : e.name;
  try {
    const v = evaluate(compile(src), s.scope);
    return `<div class="now"><span class="k">in “${esc(s.name)}”</span><code>${esc(shown(v))}</code></div>`;
  } catch { return ''; }
}

const shown = (v) => (v == null ? 'null' : Array.isArray(v) ? `${v.length} record${v.length === 1 ? '' : 's'}` : typeof v === 'string' ? `"${v}"` : String(v));

/** A question about one list's field, shaped for what the field holds: a boolean stands alone. */
const recordAsk = (e, method) => `${e.of.name}.${method}(${e.field.name}${e.field.type === 'number' ? ' > 0' : e.field.type === 'boolean' ? '' : ' == …'})`;

function exampleFor(e) {
  if (e.value) return e.of.type === 'list' ? `${e.of.name}.any(${(e.of.fields ?? []).find((f) => (f.values ?? []).includes(e.value))?.name} == ${e.value})` : `${e.of.name} == ${e.value}`;
  if (e.field) return recordAsk(e, 'count');
  const t = e.input?.type ?? (typeof e.state?.initial === 'string' && /^\d+$/.test(e.state.initial) ? 'number' : 'text');
  if (t === 'list') return `${e.name}.size > 0`;
  if (t === 'boolean') return `${e.name} && !blocked`;
  if (t === 'number') return `${e.name} >= 1`;
  if (t === 'enum') return `${e.name} in (${(e.input.values ?? []).slice(0, 2).join(', ') || '…'})`;
  return `${e.name} != null`;
}

/** An example, and what it comes to when it is run: the part a cheat sheet cannot give. */
function example(src) {
  if (!src) return '';
  const s = sample();
  let ran = '';
  if (s) {
    try { ran = `<span class="ran">→ ${esc(shown(evaluate(compile(src), s.scope)))} <span class="muted">in “${esc(s.name)}”</span></span>`; }
    catch { ran = ''; }
  }
  return `<div class="eg"><div class="k">Example</div><button type="button" class="line" data-example="${esc(src)}" title="Put this in the bar">${esc(src)}</button>${ran}</div>`;
}

/** Under the bar: what is wrong with it, or what it comes to. */
function renderBar() {
  const src = $('writeBar').value;
  const { doc } = store;
  const known = knownNames(doc);
  if (target.kind === 'initial') for (const f of doc.state) known.delete(f.name);
  const errs = check(src, known, listsOf(doc));
  const out = $('writeVerdict');
  if (errs.length) { out.className = 'verdict bad'; out.textContent = errs[0]; return; }
  const unclear = ambiguous(src, known, listsOf(doc));
  if (unclear.length) { out.className = 'verdict warn'; out.textContent = unclear[0]; return; }
  if (!src.trim()) { out.className = 'verdict'; out.textContent = target.kind === 'guard' ? 'blank means always' : 'blank leaves it as it is'; return; }
  const s = sample();
  if (!s) { out.className = 'verdict'; out.textContent = 'it reads; add a scenario and this says what it comes to'; return; }
  try { out.className = 'verdict ok'; out.textContent = `${shown(evaluate(compile(src), s.scope))} — in “${s.name}”, with the state as it starts`; }
  catch (e) { out.className = 'verdict bad'; out.textContent = e.message; }
}

// ---- the bar, which is the box ------------------------------------------------------------------

/** Put `token` in at the cursor, spaced from what is around it, and leave the cursor in its gap. */
function insert(token) {
  const bar = $('writeBar');
  const v = bar.value, a = bar.selectionStart ?? v.length, b = bar.selectionEnd ?? a;
  // A method or a property joins what stands before it with no space at all: `lines` and `.size`.
  const before = token.startsWith('.') ? v.slice(0, a).replace(/\s+$/, '') : v.slice(0, a), after = v.slice(b);
  const glue = token.startsWith('.') || !before || /[\s([.]$/.test(before) ? '' : ' ';
  const tail = /\s$/.test(token) || /^[\s)\],.]/.test(after) ? '' : ' ';
  // The … in a token is not typed, it is where the cursor lands: `in (…)` leaves it in the brackets.
  const gap = token.indexOf('…');
  const text = gap < 0 ? token : token.slice(0, gap) + token.slice(gap + 1);
  bar.value = before + glue + text + tail + after;
  bar.focus();
  bar.setSelectionRange((before + glue).length + (gap < 0 ? text.length : gap), (before + glue).length + (gap < 0 ? text.length : gap));
  apply();
}

function apply() {
  target.set($('writeBar').value);
  renderBar();
}

$('writeBar').addEventListener('input', apply);
// The dialog's only button closes it, so Enter in the bar means "done". In the find box and the
// builder's value it would mean the same, which is never what was meant there.
$('writeDialog').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ['writeFind', 'bValue'].includes(ev.target.id)) ev.preventDefault(); });
$('writeFind').addEventListener('input', (ev) => { find = ev.target.value; renderList(); });

$('writeDialog').addEventListener('click', (ev) => {
  const pick = ev.target.closest('[data-pick]');
  if (pick) {
    detail = pick.dataset.pick;
    const [what, ...rest] = detail.split(':');
    const token = what === 'fn' ? LIBRARY.find((e) => e.group === rest[0] && e.kind === rest[1] && e.name === rest[2])?.insert : rest.slice(0, -1).join(':');
    renderDetail();
    if (token) insert(token);
    return;
  }
  const eg = ev.target.closest('[data-example]');
  if (eg) { $('writeBar').value = eg.dataset.example; apply(); $('writeBar').focus(); return; }
  if (ev.target.closest('[data-act="insert-built"]')) { const e = builtExpression(); if (e) insert(e); return; }
});

$('writeDialog').addEventListener('change', (ev) => {
  const id = ev.target.id;
  if (!['bList', 'bAsk', 'bField', 'bOp', 'bValue'].includes(id)) return;
  const key = { bList: 'list', bAsk: 'ask', bField: 'field', bOp: 'op', bValue: 'value' }[id];
  built = { ...built, [key]: ev.target.value };
  if (key === 'list') built.field = '';
  if (key === 'field') built.value = '';
  renderList();
});
$('writeDialog').addEventListener('input', (ev) => { if (ev.target.id === 'bValue') { built = { ...built, value: ev.target.value }; $('writeDialog').querySelector('.builder .out code').textContent = builtExpression() || '—'; $('writeDialog').querySelector('[data-act="insert-built"]').disabled = !builtExpression(); } });
