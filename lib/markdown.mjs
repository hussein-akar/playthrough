// The flow as a Markdown spec: the same drawing and spreadsheet, but pasteable into a ticket, a
// wiki page or a pull request. Nothing here reads the DOM; the results come from `runAll`, so the
// pass/fail column is the one the page shows.
import { runAll } from './run.mjs';

const cell = (v) => (v == null ? '' : String(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const code = (v) => { const s = cell(v); return s ? `\`${s}\`` : ''; };
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const fmt = (v) => (v == null || v === '' ? '' : typeof v === 'string' ? v : JSON.stringify(v));

export function toMarkdown(doc, results = runAll(doc)) {
  const out = [`# ${cell(doc.name) || 'Untitled flow'}`];
  if (doc.description?.trim()) out.push('', doc.description.trim());

  const inputs = doc.inputs ?? [], state = doc.state ?? [];
  out.push('', '## Inputs', '');
  out.push(inputs.length
    ? table(['Name', 'Type', 'Values'], inputs.map((i) => [code(i.name), cell(i.type), i.type === 'enum' ? (i.values ?? []).map(code).join(', ') : '']))
    : '_None._');
  out.push('', '## State', '');
  out.push(state.length
    ? table(['Field', 'Initial'], state.map((f) => [code(f.name), code(fmt(f.initial) || 'null')]))
    : '_None._');

  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]));
  const decisions = (doc.nodes ?? []).filter((n) => n.kind === 'decision');
  out.push('', '## Decisions', '');
  if (!decisions.length) out.push('_None._');
  for (const d of decisions) {
    out.push(`- **${cell(d.label) || d.id}**`);
    for (const e of (doc.edges ?? []).filter((e) => e.from === d.id)) {
      const to = nodes.get(e.to)?.label ?? e.to;
      out.push(`  - ${e.else ? '_else_' : e.when?.trim() ? code(e.when) : '_(unguarded)_'} → ${cell(to)}`);
    }
  }

  const rs = results?.results ?? [];
  out.push('', '## Scenarios', '');
  if (!rs.length) out.push('_None._');
  else {
    out.push(`${results.passed} of ${rs.length} pass.`, '');
    const head = ['Scenario', ...inputs.map((i) => code(i.name)), 'Expected actions', 'Lands on', ...state.map((f) => code(f.name)), 'Result'];
    const rows = rs.map(({ scenario: s, verdict: v }) => [
      cell(s.name),
      ...inputs.map((i) => cell(fmt(s.inputs?.[i.name]))),
      (s.expect?.actions ?? []).map(cell).filter(Boolean).join(', '),
      cell(s.expect?.end),
      ...state.map((f) => cell(fmt(s.expect?.state?.[f.name]))),
      v.pass ? '✅ pass' : `❌ fail: ${v.issues.map((i) => cell(i.message)).join('; ')}`,
    ]);
    out.push(table(head, rows));
  }
  return out.join('\n') + '\n';
}
