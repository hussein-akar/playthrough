// The Presets dialog under Template ▾: Empty, Simple and Advanced, each a small project of flows
// kept under examples/ and listed in examples/presets.json. A card says what is in one, as the
// tree the sidebar would show; a flow's name opens just that flow on the page; Load it starts
// over from the preset; and in a project folder, Add to this one writes the preset's flows in
// beside what is already there.
import { store, load, setFile, emptyDoc } from './store.mjs';
import { ask, notice, toast } from './dialog.mjs';
import * as project from './project.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const folderOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let manifest = null;   // [{ id, name, description, dir?, flows: [{ file, doc }] }], fetched once

/** The presets with their flows read in. */
export async function presets() {
  if (manifest) return manifest;
  const { presets: list } = await (await fetch('examples/presets.json')).json();
  manifest = await Promise.all(list.map(async (p) => ({
    ...p,
    flows: await Promise.all((p.flows ?? []).map(async (file) => ({ file, doc: await (await fetch(`${p.dir}/${file}`)).json() }))),
  })));
  return manifest;
}

/** The flow the page opens on when there is no project and nothing else to show. */
export async function openDefault() {
  const doc = await (await fetch('examples/simple/checkout.json')).json();
  setFile(null); load(doc); project.hooks.fit();
}

export async function show() {
  let list;
  try { list = await presets(); } catch (e) { return notice('Could not read the presets', e.message); }
  render(list);
  $('presetsDialog').showModal();
}

const close = () => $('presetsDialog').close();

function render(list) {
  const inProject = !!project.project.info;
  $('presetsList').innerHTML = list.map((p) => {
    const groups = new Set();
    for (const f of p.flows) { let g = folderOf(f.file); while (g) { groups.add(g); g = folderOf(g); } }
    const meta = [plural(p.flows.length, 'flow'), groups.size && plural(groups.size, 'group')].filter(Boolean).join(', ');
    return `<div class="preset" data-preset="${esc(p.id)}">
      <div class="head"><h4>${esc(p.name)}</h4><span class="meta">${meta}</span></div>
      <p>${esc(p.description)}</p>
      ${tree(p)}
      <div class="buttons">
        <button type="button" class="primary" data-load="${esc(p.id)}">Load it</button>
        ${inProject && p.flows.length ? `<button type="button" data-add="${esc(p.id)}">Add to this one</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

/** The preset's flows as the sidebar would show them: groups as headings, flows under theirs, in the order listed. */
function tree(p) {
  if (!p.flows.length) return '';
  const seen = new Set();
  const rows = [];
  for (const f of p.flows) {
    const segs = folderOf(f.file).split('/').filter(Boolean);
    for (let i = 0; i < segs.length; i++) {
      const path = segs.slice(0, i + 1).join('/');
      if (seen.has(path)) continue;
      seen.add(path);
      rows.push(`<li class="group" style="--depth: ${i}"><span class="name">${esc(segs[i])}/</span></li>`);
    }
    const n = f.doc.scenarios?.length ?? 0;
    rows.push(`<li class="flow" style="--depth: ${segs.length}"><button type="button" class="link" data-open="${esc(p.id)}" data-file="${esc(f.file)}" title="Open just this flow on the page">${esc(f.doc.name || f.file)}</button><span class="n">${n ? plural(n, 'scenario') : 'no scenarios'}</span></li>`);
  }
  return `<ul class="tree">${rows.join('')}</ul>`;
}

/** One flow of a preset onto the page, not in any file: Save adds it to the folder, if there is one. */
async function openOne(p, file) {
  const f = p.flows.find((x) => x.file === file);
  if (!f) return;
  if (!await project.hooks.replaceable(`open "${f.doc.name}"`)) return;
  close();
  setFile(null); load(structuredClone(f.doc)); project.hooks.fit();
  toast(`Opened "${f.doc.name}" from the ${p.name} preset`);
}

/** Start over from the preset: the folder is emptied and refilled, or, without a folder, the page shows its first flow. */
async function loadPreset(p) {
  const info = project.project.info;
  if (!info) {
    if (!await project.hooks.replaceable(`load the ${p.name} preset`)) return;
    close();
    setFile(null);
    if (!p.flows.length) { load(emptyDoc()); project.hooks.fit(); return toast('A blank canvas'); }
    load(structuredClone(p.flows[0].doc)); project.hooks.fit();
    if (p.flows.length > 1) toast(`Opened "${p.flows[0].doc.name}". The other ${plural(p.flows.length - 1, 'flow')} of this preset need a project folder: npm start -- ./specs`, 6000);
    return;
  }
  const have = info.flows.length, groups = (info.folders ?? []).length;
  if (have || groups) {
    const inside = [have && plural(have, 'flow'), groups && plural(groups, 'group')].filter(Boolean).join(' and ');
    const ok = await ask({
      title: p.flows.length ? `Replace everything in ${info.dir} with the ${p.name} preset?` : `Empty ${info.dir}?`,
      body: `The ${inside} there now are deleted first${p.flows.length ? `, then the preset's ${plural(p.flows.length, 'flow')} are written in` : ''}. If the folder is in git, the history still has what is there now.`,
      ok: p.flows.length ? 'Replace' : 'Empty it', danger: true,
    });
    if (!ok) return;
  } else if (!await project.hooks.replaceable(`load the ${p.name} preset`)) return;
  close();
  try {
    await project.clearAll();
    await project.putFlows(p.flows);
    await project.refresh();
  } catch (e) { await project.refresh(); return notice('Could not load the preset', e.message); }
  if (p.flows.length) { await project.open(p.flows[0].file, { quiet: true, force: true }); toast(`Loaded the ${p.name} preset: ${plural(p.flows.length, 'flow')}`); }
  else { setFile(null); load(emptyDoc()); project.hooks.fit(); toast(`Emptied ${info.dir}`); }
}

/** The preset's flows beside what the folder already has; a file already there is left alone. */
async function addPreset(p) {
  close();
  try {
    const { written, skipped } = await project.putFlows(p.flows, { skipExisting: true });
    await project.refresh();
    toast(written.length ? `Added ${plural(written.length, 'flow')}${skipped.length ? `; ${skipped.length} already there, left as ${skipped.length === 1 ? 'it was' : 'they were'}` : ''}` : 'Every flow of the preset is already in the folder', 4000);
    if (written.length && !store.file && !store.doc.nodes.length) await project.open(written[0], { quiet: true });
  } catch (e) { await project.refresh(); notice('Could not add the preset', e.message); }
}

$('presetsList').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-open], [data-load], [data-add]');
  if (!b) return;
  const p = manifest?.find((x) => x.id === (b.dataset.open ?? b.dataset.load ?? b.dataset.add));
  if (!p) return;
  if (b.dataset.open) return openOne(p, b.dataset.file);
  if (b.dataset.load) return loadPreset(p);
  return addPreset(p);
});
