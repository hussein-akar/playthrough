# Contributing

Playthrough is a design tool with **no dependencies**, whose documentation is its README, and whose
releases are decided by the subject line of a commit. Those three things shape what a contribution
looks like, so they come first.

Bugs, questions and flows that did not behave are as welcome as code. If you are here to report one,
skip to [Reporting a bug](#reporting-a-bug).

## The one rule: no dependencies

`package.json` has no `dependencies` and no `devDependencies`, and it is not going to grow any:

- **A checkout and Node 22 are the whole setup.** There is no install step to get wrong and nothing
  to audit before a colleague can open the page.
- **The image is stock Node plus this source.** The `Dockerfile` copies files in; there is no build.
- **The page is plain ES modules.** The browser loads `ui/*.mjs` as they are. There is no bundler,
  no framework and no transpiler between the file you edit and the file that runs.

A change that needs `npm install` is asking to give that up. It might be right, but the case for it
belongs in the pull request description, argued.

`node --test`, `node:http`, `node:fs` and the rest of the standard library are not dependencies. Use
them.

## Running it

Node 22 or newer, and this checkout:

```bash
npm start -- ./specs        # the page over a project folder at http://localhost:8095
npm run start:example       # the page over the Advanced preset's six flows
npm start                   # the page without a folder, one flow at a time
```

`specs/` is ignored by git, so it is a safe place to try things. There is no watch or reload step:
edit a file, reload the page. The server reads files from disk on every request.

To check the image as well:

```bash
docker build -t playthrough .
docker run --rm -p 8095:8095 -v "$PWD/specs:/app/specs" playthrough
```

## The tests

```bash
npm test        # node --test test/*.test.mjs, nothing to install
```

`lib/` has no DOM in it, and it is what the suite covers:

| Test | Holds |
|---|---|
| `test/expr.test.mjs` | the condition language: parsing, evaluation, the name check |
| `test/run.test.mjs` | the interpreter: paths, findings (ambiguous, nothing matched, loops), verdicts |
| `test/generate.test.mjs` | Generate…: the values taken from the drawing, ways through it, combinations |
| `test/markdown.test.mjs` | Copy as Markdown |
| `test/project.test.mjs` | the project folder: names to files, writes that do not clobber, groups |
| `test/rename.test.mjs` | renaming an input or state field everywhere it is mentioned |
| `test/tags.test.mjs` | tags and their tallies |
| `test/presets.test.mjs` | the presets: their flows draw cleanly, touch every node and edge, and pass, except the one that fails on purpose |

`ui/` has no tests. A change there is checked in the browser, in both modes (with a project folder
and without one), and the pull request says what you clicked.

## What a change looks like

- **ES modules (`.mjs`), the standard library with `node:` prefixes, no build step.** Match the file
  you are in.
- **Comments say why, not what.** The head of each module says what it is for and the constraint it
  is under; comments inside explain the decisions a reader would otherwise undo.
- **The README is the documentation.** A change somebody will notice (a button, a key, a field in
  the flow file) changes the README in the same commit. A new key also goes in the keys table in
  `index.html`, which is what **?** shows on the page.
- **The flow file is a promise.** Flows live in people's repositories. A change to its shape must
  still read older files: `ui/store.mjs` upgrades them when they load (an old scenario `note` is read
  as its `description`, for instance). Update `examples/` in the same commit.
- **Presets are shown to strangers first.** `examples/simple/` is the tour in the README, and one of
  its scenarios fails on purpose. `examples/advanced/` is where a new capability is shown off.
- **The page is one stylesheet.** All CSS is in `index.html`, built on the tokens at its top. Use the
  tokens rather than new colours or sizes.

## Where things are

```
lib/expr.mjs      the condition language: tokenizer, parser, evaluator, name check
lib/run.mjs       the interpreter: run, verdict, runAll (with coverage), lint
lib/generate.mjs  scenarios from the inputs: one per way through the drawing, or every combination
lib/markdown.mjs  the flow as a Markdown spec, for Copy as Markdown
lib/project.mjs   a folder of flows: list with pass counts, read, write without clobbering
ui/app.mjs        header, keyboard, play, boot
ui/store.mjs      the document, selection, undo, autosave, upgrading older files
ui/canvas.mjs     the SVG drawing and its pointer interactions
ui/inspector.mjs  the side panel for whatever is selected, and the config drawer
ui/table.mjs      the scenario table
ui/generate.mjs   the Generate… dialog
ui/project.mjs    the project sidebar and the calls to the folder API
ui/presets.mjs    the Presets dialog
ui/dialog.mjs     ask, notice, prompt, toast: the page's own dialogs
index.html        the page: its markup and all of its CSS
serve.mjs         a static file server, the folder API, and /health
examples/         the presets: presets.json lists them; simple/ and advanced/ are project folders
test/             the suite
Dockerfile        the image: Node 22 on Alpine with the source in it
.github/          the workflow that tests, builds and publishes the image, and the version script
```

## Commit messages, which cut releases

This repository uses [Conventional Commits](https://www.conventionalcommits.org/), and they are not
decoration: `.github/workflows/image.yml` reads the commits since the last `v*` tag and releases from
them. **The subject line is what cuts a release.**

| Subject starts with | Release |
|---|---|
| `feat: …` | minor: `1.2.0` → `1.3.0` |
| `fix: …`, `perf: …` | patch: `1.2.0` → `1.2.1` |
| `feat!: …`, or a `BREAKING CHANGE:` footer | major: `1.2.0` → `2.0.0` |
| `ui:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, or no prefix | none |

A scope is fine and is ignored: `fix(table): …` is a patch.

To see what your commits would release before you push them:

```bash
node .github/next-version.mjs
```

It prints every commit it read, what each one counted for, and the version they add up to. A `feat:`
on a rename ships a minor nobody meant, and a `fix:` typed as `chore:` ships nothing.

The house style for the rest, which you can read off `git log`: the **subject** is a lowercase
sentence saying what is now true (`a scenario row moves by a grip`), not an order (`add drag
handle`). The **body** says what was there before, why it was wrong, and what changed with it.

When a release goes out, the workflow tags the released commit `vX.Y.Z` and commits nothing. The tag
is the version: `package.json` in the repository says `0.0.0-development`, and only the published
image's copy says the real number.

## Pull requests

`main` is protected: nobody pushes to it directly, and every change arrives as a pull request.

1. Fork the repository (or, with write access, branch off `main`) and push your branch.
2. Open a pull request against `main`.
3. CI runs two checks side by side, and both must pass:
   - **The suite**, on Node 22, 24 and 26. 22 is what the image ships, so it is the one that must pass.
   - **The image**, built and run with a folder mounted as a Linux user would mount it: it must answer
     `/health`, serve the page and the presets, and write a flow into the folder.
4. The maintainer, the code owner in [`.github/CODEOWNERS`](.github/CODEOWNERS), approves it. A new
   push after an approval needs approving again, and every review conversation must be resolved.
5. It is merged, and the push to `main` publishes the image.

On a pull request from a fork, the workflow waits for the maintainer to approve running it. Small pull
requests with one argument each are read faster than large ones.

## What not to commit

| | |
|---|---|
| `specs/` | your local project folder; it is ignored for you |
| flows from your own product | they belong in your product's repository, not in `examples/` |
| `.DS_Store`, logs | ignored |

## Reporting a bug

Open an issue at <https://github.com/hussein-akar/playthrough/issues>. What makes one answerable:

- **The flow that shows it.** Use **Template → Export → Copy as JSON** and paste it, trimmed to the
  smallest flow that still goes wrong, with anything private removed.
- **What you did, what happened, and what you expected**: which scenario, which result, which
  button.
- **Where it ran**: `npm start` on Node *n*, or the image at tag *x*, and which browser.

Feature requests are welcome, and are best described as the flow you were trying to draw or the case
you were trying to catch.

## Security

Please do **not** open a public issue for a vulnerability. Use GitHub's private reporting instead:
**Security → Report a vulnerability** at
<https://github.com/hussein-akar/playthrough/security/advisories>.

Playthrough is a design tool meant for a laptop, a team's compose file or a trusted network. Its
HTTP API has no authentication and writes files into the project folder by design. Anything that lets
a request read or write **outside** that folder, or run code on the server, is a vulnerability and
worth reporting.

## License

[Apache 2.0](LICENSE). There is no contributor agreement to sign: by opening a pull request, you
contribute your work under the same license as the rest of the repository, including the patent grant
that license makes.

## Being decent about it

Review is about the code, not the person who wrote it. Say what is wrong and why it matters, and
assume the other person had a reason. Harassment, contempt and arguing to win have no place here.
