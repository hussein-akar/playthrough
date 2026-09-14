// What the next version is, according to the commits since the last release.
//
// Conventional Commits, read the usual way: `feat:` is a minor, `fix:` and `perf:` are patches, and
// a `!` after the type or a `BREAKING CHANGE:` footer is a major. Everything else — docs, chore,
// refactor, test, build, ci, style, and any subject that is not a conventional commit at all — is
// not a release, which is the answer this prints most of the time and the one the workflow does
// nothing about.
//
// No dependencies, like the rest of this repository. It shells out to git and prints one JSON
// object, so the workflow reads it with `node .github/next-version.mjs` and nothing else.

import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// The commit range: everything since the last v-tag, or the whole history the first time.
let last = null;
try {
  last = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
} catch {
  // no tag yet — every commit counts, and the base below stays 0.0.0
}
const range = last ? `${last}..HEAD` : 'HEAD';

// %x00 between messages rather than a newline: a commit body is full of newlines and splitting on
// them would read every paragraph as its own subject.
const log = git('log', range, '--format=%B%x00', '--no-merges');
const commits = log.split('\0').map((c) => c.trim()).filter(Boolean);

// `type(optional scope)!: subject` — the `!` is the breaking marker, and the scope is ignored here
// because nothing in this repository releases per-component.
const HEADER = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s+\S/;
const MINOR = new Set(['feat']);
const PATCH = new Set(['fix', 'perf']);

let bump = null; // null | 'patch' | 'minor' | 'major'
const rank = { patch: 1, minor: 2, major: 3 };
const raise = (b) => { if (!bump || rank[b] > rank[bump]) bump = b; };
const considered = [];

for (const message of commits) {
  const [subject, ...rest] = message.split('\n');
  const m = HEADER.exec(subject);
  if (!m) { considered.push({ subject, type: null, bump: null }); continue; }
  const { type, breaking } = m.groups;
  // A footer counts as well as the `!`, because that is the half people remember.
  const footer = /^BREAKING[ -]CHANGE:/m.test(rest.join('\n'));
  const b = breaking || footer ? 'major'
    : MINOR.has(type) ? 'minor'
    : PATCH.has(type) ? 'patch'
    : null;
  if (b) raise(b);
  considered.push({ subject, type, bump: b });
}

const base = (last ?? 'v0.0.0').replace(/^v/, '');
const [major, minor, patch] = base.split('.').map((n) => Number.parseInt(n, 10) || 0);
const next = bump === 'major' ? `${major + 1}.0.0`
  : bump === 'minor' ? `${major}.${minor + 1}.0`
  : bump === 'patch' ? `${major}.${minor}.${patch + 1}`
  : null;

const result = {
  release: Boolean(bump),
  bump,
  from: base,
  version: next,
  since: last,
  commits: considered,
};

// The log first: which commits were read and what each one counted for, because "no release" with
// no explanation is the failure people file an issue about.
console.log(JSON.stringify(result, null, 2));

// And the step outputs, written here rather than parsed back out of that JSON by the workflow —
// the shell round-trip through `node -p` was the only fiddly part of this and it does not need to
// exist. `minor` is the floating `1.2` image tag, which rides on the same decision.
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `release=${result.release}`,
    `bump=${bump ?? ''}`,
    `version=${next ?? ''}`,
    `minor=${next ? next.split('.').slice(0, 2).join('.') : ''}`,
    `previous=${last ?? ''}`,
    '',
  ].join('\n'));
}
