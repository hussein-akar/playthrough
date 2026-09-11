// No native confirm()/alert()/prompt(): one <dialog> for questions, errors and a single line of
// input, and a toast for "it worked". Everything here resolves a promise, so callers await it.
const $ = (id) => document.getElementById(id);

// The dialog settles its promise when it closes, whichever way the browser announces that: some
// fire `close`, some only `toggle`, and Escape fires `cancel` first. One resolver at a time.
let pending = null;
const settle = () => { if (!pending || $('modal').open) return; const r = pending; pending = null; r($('modal').returnValue === 'ok'); };
for (const t of ['close', 'toggle', 'cancel']) $('modal').addEventListener(t, () => setTimeout(settle, 0));

/** A yes/no question. Resolves true on OK. */
export function ask({ title, body = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
  const dlg = $('modal');
  if (dlg.open) dlg.close('');   // a question on top of a question: the first one is answered "no"
  settle();
  $('modalTitle').textContent = title;
  $('modalBody').textContent = body;
  $('modalOk').textContent = ok; $('modalOk').classList.toggle('danger', danger);
  $('modalCancel').textContent = cancel; $('modalCancel').hidden = cancel == null;
  dlg.returnValue = '';
  return new Promise((resolve) => { pending = resolve; dlg.showModal(); $('modalOk').focus(); });
}

/** Something to read, with one button. `text`, if given, is shown in a textarea to copy from. */
export function notice(title, body = '', text = null) {
  const p = ask({ title, body, ok: 'Close', cancel: null });
  if (text != null) { const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true }); $('modalBody').append(ta); ta.select(); }
  return p;
}

/**
 * One line of input. Resolves the trimmed text, or null when cancelled or left empty. Enter is
 * OK: the OK button is first in the markup, so it is the form's default button, and the keydown
 * handler closes the dialog the same way for a browser that does not submit on it. The button
 * that opened the prompt loses focus first, so the dialog closing cannot hand the tail of the
 * Enter keystroke back to it and open the prompt again.
 */
export async function prompt({ title, body = '', value = '', placeholder = '', ok = 'OK' }) {
  document.activeElement?.blur?.();
  const p = ask({ title, body, ok });
  const input = Object.assign(document.createElement('input'), { type: 'text', value, placeholder });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); $('modal').close('ok'); } });
  $('modalBody').append(input);
  input.focus(); input.select();
  const yes = await p;
  return yes && input.value.trim() ? input.value.trim() : null;
}

export function toast(message, ms = 2200) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: message });
  $('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

export const dialogOpen = () => Boolean(document.querySelector('dialog[open]'));
