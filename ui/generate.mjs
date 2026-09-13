// The Generate… dialog beside + Scenario: scenarios made from the picked values, one for each way
// through the drawing (combinations that go the same way are written once) or one for every
// combination. Each input is listed with the values the drawing gives it, one chip each. A chip is clicked to
// leave that value out or bring it back, ⌥-clicked to keep only it; the checkbox takes all of an
// input's values or none. An input with nothing picked holds its usual value. To start with,
// every value is picked for the inputs some guard reads, since only those change the path. The
// count of rows follows the picks, and what a scenario already has (its way, or its combination)
// is left out, so it is safe to press twice.
import { store, commit, select, uid, parseTags } from './store.mjs';
import { toast } from './dialog.mjs';
import { candidates, plan, ways, generate, count, MAX_SCENARIOS, MAX_COMBINATIONS } from '../lib/generate.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const TOO_MANY = 5000;   // combinations, before they are even listed

let cands = [];
let picks = new Map();   // input name → Set of the labels picked for it
let ready = false;       // whether the count says the generate button may go
let cache = new Map();   // the runs of the combinations, kept while the dialog is open: the drawing cannot change under it

export function show() {
  cands = candidates(store.doc);
  cache = new Map();
  picks = new Map(cands.map((c) => [c.name, new Set(c.mentioned ? c.values.map((v) => v.label) : [])]));
  $('generateBody').innerHTML = cands.length
    ? cands.map((c) => `<div class="row" data-input="${esc(c.name)}">
        <label class="pick"><input type="checkbox" data-all title="All of its values, or none"><span class="name">${esc(c.name)}<span class="muted" data-note></span></span></label>
        <span class="vals">${c.values.map((v) => `<button type="button" class="chip" data-val="${esc(v.label)}" title="${esc(v.value === '' ? 'blank' : String(v.value))} · click to leave it out or bring it back · ⌥-click for only this one">${esc(v.label)}</button>`).join('')}</span>
      </div>`).join('')
    : '<div class="muted">The flow declares no inputs yet. Declare them in Flow settings, the gear at the foot of the palette: the combinations are made from them.</div>';
  update();
  const dlg = $('generateDialog');
  dlg.returnValue = '';
  dlg.showModal();
}

const options = () => ({
  mode: $('generateDialog').querySelector('[name="generateMode"]:checked')?.value ?? 'ways',
  pick: picks,
  skipCovered: $('generateSkip').checked,
  expect: $('generateDialog').querySelector('[name="generateExpect"]:checked')?.value ?? 'drawing',
  tags: parseTags($('generateTags').value),   // what was typed last stays in the box while the page is open
});

/** Each row's chips, checkbox and note from the picks; then the count in the foot, and whether Generate may go. */
function update() {
  for (const c of cands) {
    const row = $('generateBody').querySelector(`.row[data-input="${CSS.escape(c.name)}"]`), got = picks.get(c.name);
    for (const chip of row.querySelectorAll('.chip')) { const on = got.has(chip.dataset.val); chip.classList.toggle('on', on); chip.setAttribute('aria-pressed', String(on)); }
    const n = c.values.filter((v) => got.has(v.label)).length;
    const box = row.querySelector('[data-all]');
    box.checked = n > 0; box.indeterminate = n > 0 && n < c.values.length;
    row.classList.toggle('off', n === 0);
    const note = n === 0 ? `held at ${c.fallback.label}` : n === c.values.length ? `all ${c.values.length}` : `${n} of ${c.values.length}`;
    row.querySelector('[data-note]').textContent = `${c.type} · ${note}${c.mentioned ? '' : ' · no branch reads it'}`;
  }

  const o = options(), out = $('generateCount');
  $('generateSkipText').textContent = o.mode === 'all' ? 'Leave out combinations some scenario already holds' : 'Leave out ways some scenario already goes';
  const total = count(cands, picks);
  let text, ok = false;
  if (!cands.length) text = 'nothing to combine';
  else if (o.mode !== 'all') {
    if (total > MAX_COMBINATIONS) text = `${total} combinations: too many to play through; leave some values out`;
    else {
      const w = ways(store.doc, { pick: picks, skipCovered: o.skipCovered, cands, cache });
      const n = w.combos.length, among = `${plural(w.found, 'way')} among ${plural(w.explored, 'combination')}`;
      const taken = w.skipped ? `, ${w.skipped} already taken` : '';
      if (!n) text = `nothing new: ${among}, every one already taken by a scenario`;
      else if (n > MAX_SCENARIOS) text = `${plural(n, 'new scenario')}: more than ${MAX_SCENARIOS} in one go; leave some values out`;
      else { text = `${plural(n, 'new scenario')} · ${among}${taken}`; ok = true; }
    }
  } else if (total > TOO_MANY) text = `${total} combinations: too many to list; leave some values out`;
  else {
    const p = plan(store.doc, { pick: picks, skipCovered: o.skipCovered, cands });
    const n = p.combos.length;
    const covered = p.skipped ? ` · ${p.skipped} already ${p.skipped === 1 ? 'has a scenario' : 'have scenarios'}` : '';
    if (!n) text = `nothing new: every combination${covered.replace(' · ', ' ')}`;
    else if (n > MAX_SCENARIOS) text = `${plural(n, 'new scenario')}: more than ${MAX_SCENARIOS} in one go; leave some values out`;
    else { text = `${plural(n, 'new scenario')}${covered}`; ok = true; }
  }
  out.textContent = text;
  out.classList.toggle('bad', cands.length > 0 && !ok);
  $('generateOk').disabled = !ok;
  ready = ok;
}

$('generateBody').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  const c = cands.find((x) => x.name === chip.closest('.row').dataset.input), got = picks.get(c.name), val = chip.dataset.val;
  // ⌥-click keeps only this value; on the value that is already the only one, it brings them all back.
  if (ev.altKey) picks.set(c.name, got.size === 1 && got.has(val) ? new Set(c.values.map((v) => v.label)) : new Set([val]));
  else if (got.has(val)) got.delete(val); else got.add(val);
  update();
});
// The checkbox takes every value when some are left out, and none when all are in.
$('generateBody').addEventListener('change', (ev) => {
  const box = ev.target.closest('[data-all]');
  if (!box) return;
  const c = cands.find((x) => x.name === box.closest('.row').dataset.input);
  picks.set(c.name, picks.get(c.name).size === c.values.length ? new Set() : new Set(c.values.map((v) => v.label)));
});
$('generateDialog').addEventListener('change', update);
$('generateCancel').addEventListener('click', () => $('generateDialog').close(''));
// Generate does its work on the click itself (Enter in the dialog presses it too): whether and when a
// dialog announces that it closed differs between browsers, and in a hidden tab it may not at all.
$('generateOk').addEventListener('click', (ev) => {
  ev.preventDefault();
  if (!ready) return;
  const o = options();
  $('generateDialog').close('ok');
  const { scenarios, skipped } = generate(store.doc, { ...o, cache, uid });
  if (!scenarios.length) return;
  if (store.tagFilter && !o.tags.includes(store.tagFilter)) store.tagFilter = null;   // else the new rows would be hidden
  commit((doc) => { doc.scenarios.push(...scenarios); });
  select({ type: 'scenario', id: scenarios[0].id });
  const stuck = store.results.results.filter((r) => scenarios.some((s) => s.id === r.scenario.id) && r.result.error).length;
  toast(`Generated ${plural(scenarios.length, 'scenario')}${o.mode === 'all' ? '' : ', one for each way'}${skipped ? `, ${skipped} already there` : ''}${stuck ? ` · ${stuck} stuck: no branch handles ${stuck === 1 ? 'that one' : 'those'}` : ''}`, stuck ? 4000 : 2600);
});
