# Playthrough

**Draw the feature before it exists. Then play your scenarios through the drawing.**

A team designing a feature draws a flow on a whiteboard and lists the cases in a spreadsheet:
*if the order came from the app and there is a coupon, then…* The drawing and the spreadsheet
never meet, so nobody notices the case that no branch handles, or the two branches that both
claim the same case, until the code is written and a tester finds it.

Playthrough is the drawing and the spreadsheet in one page. The flow is a picture of nodes and
guarded edges. Each scenario is a row: inputs on the left, what should happen on the right. Every
row is played through the picture as you type, its path lights up node by node, and the row turns
green or red. Nothing about it is tied to code: it is a design-time tool, and the document it
produces is the spec.

No build step, no dependencies. Node 22 or newer and this checkout.

```bash
npm start                  # http://localhost:8095/, one flow at a time
npm start -- ./specs       # the same page over a project folder (see "A team and a folder")
npm run start:example      # the page over the Advanced preset: six flows in three groups
npm test                   # the interpreter, the condition language, the generator, the project folder, the presets
```

The page opens on a shop's checkout, a flow with four scenarios. One of them fails on purpose:
somebody assumed a phone order gets a confirmation email, and the drawing says it prints a
receipt. **Template ▾** holds the presets, a small shop and a bigger one (see "Templates").

## What a flow is made of

| Piece | What it means |
|---|---|
| **Start** | Where a scenario enters. One per flow. |
| **Action** | Something that happens: a document created, an event published. A scenario expects a set of these. An action may also *set* a state field. |
| **Decision** | A fork. Each edge leaving it carries a condition; one edge may be *else*. An edge may carry a short label, shown on the canvas in place of its condition, and a status colour: success, failed, warning or info. A wire is smooth or square; a small bar over the selected wire switches both. |
| **End** | Where a scenario lands. A scenario may expect a particular one. |
| **Inputs** | What a scenario provides, declared once on the flow with a type: enum, boolean, number, text, or a list of records with fields of their own. Conditions can only mention declared inputs, so a typo is caught while drawing, not while running. |
| **State** | Fields an action may set along the way, and a scenario may check at the end. An initial value is taken as written, unless it reads as an expression over the inputs: an input's name starts the field as a copy of that input. |

Conditions read like the sentence in the spreadsheet:

```
channel in [Web, App, Marketplace]
hasCoupon
amount > 100 and not blocked
deliveryDate == null
```

Enum values need no quotes. `and`, `or`, `not`, `in`, comparisons, arithmetic and `a ?? b` (b
when a is blank) are all there is, plus two words for lists.

A list input holds records: it is declared with its fields (`lines`, with `status` an enum of
PICKED, SHORT, CANCELLED and `gift` a boolean), and a scenario writes the records one per line,
`status=PICKED, gift=yes`, or just the values in field order, `PICKED, yes`. A state field whose
initial value is `lines` starts as a copy of it, and `lines where gift` as the gift lines only;
an action narrows it further with `where`, and a guard measures it with `count`:

```
kept = kept where status != CANCELLED         an action's set
count(kept) == 0                              a guard
count(kept where gift) > 1
```

Inside `where`, a bare word is first a field of the record being looked at. An empty list is
false, so `kept where gift` alone reads "some kept line is a gift". A scenario's expected
state for a list is a count, `*` for some, or `null` for none. The filters in the drawing are
then really exercised: how many lines remain is worked out, not typed in.

Beside the condition on an edge sits an *insert…* menu with every declared input and state
field, each enum's values and the operators: a pick lands at the cursor, so a guard is assembled
from what the flow declares rather than typed from memory.

The panel checks a condition or a set expression as you type: a name nobody declared or a
missing bracket shows up under the field at once. Renaming an input or a state field rewrites
every guard, set and scenario cell that mentioned it, in one undoable step.

## Drawing

The gear at the foot of the palette (or *Flow config…* in the right-click menu) shows the flow
in the side panel: itself, its inputs and its state. Its name and description are edited right
there, by clicking them. A pencil or a row opens the config drawer on that card alone: the
inputs are declared in one, the state in the other. The panel otherwise shows whatever is
selected and goes away when nothing is. The scenario table runs the full width of the window;
its top edge is a grip.

The palette on the left holds the four shapes: click one to add it in the middle of the view, or
drag it onto the canvas to put it exactly where it lands. The canvas has a zoom corner (−, +,
fit, 1:1, with the current percentage) and a **Tidy** button that lays the flow out left to right
from the start node, in one undoable step. Nodes snap to a 20px grid while dragging (hold Alt for
free placement); arrow keys nudge the selected nodes by one grid step, Shift by five.
Double-click a node to edit its label straight away.

Moving around works as in Figma: the wheel (or two fingers on a trackpad) pans, ⌘-wheel or a
pinch zooms, and holding Space or the middle button turns a drag into a pan. A wire, a node or a
selection band dragged to the edge of the window pans the view that way, so a far-off node can be
reached without letting go.

Several nodes can be selected at once: dragging on empty canvas draws a band that catches every
node it touches, Shift-drag adds to what is already selected, Shift-click adds a node or takes it
out, and ⌘A takes them all. ⌘C, ⌘X and ⌘V copy, cut and paste the selection with the edges
between its nodes, and ⌘D duplicates it. A right-click on the canvas opens a small menu with the
same, plus the four shapes on empty canvas. Dragging any node of the
selection moves the whole of it, the arrow keys nudge it, Delete removes it with the edges that
touched it, and the panel offers *Align left* and *Align top*. Each of these is one undo step.

## Playing a scenario

At each node the runner looks at the edges leaving it. Exactly one must match: the one whose
condition holds, or the *else* edge when none does. Two matching edges is a finding
(*ambiguous*), no matching edge is a finding (*nothing matched*), a node with no way out is a
finding (*leads nowhere*), and so is a loop. The path up to the trouble is kept and the node
where it stopped is painted red, because "it got stuck here" is exactly what the design review
needs to see.

A scenario passes when every expected action happened, nothing unexpected happened, it landed
where it said it would, and each expected state field holds. In the expected-state cell, `*`
means *any value but null*, `null` means null, and a plain value is compared to the value. A
cell can also be a check: `== 1` or `> 100` on the value (for a list, on how many records it
has), `size == 1`, `count(lines where gift) == 1`, `lines where status == PICKED` (some
record matches), or the name of an input, meaning "the same as that input". Inside a check,
`it`, `value`, `size` and `count` name the field's value and its count.

A click on a row selects the scenario and shows its path; a double-click opens it in the side
panel, where the rest of it is edited, and ↑ and ↓ go through the scenarios. In the scenario
panel, expected actions are listed in the order the flow meets them, each marked ✓ or ✗ for the
last run, and every step of the result path is a link to its node. When a scenario fails and it
is the drawing that is right, **Use this run as the expectation** (or *accept run* in the row)
copies what actually happened into the expectation. In the table, Enter on the last row starts
the next scenario and *+N more* opens the full list of issues.

A scenario can carry **tags**, comma-separated in its panel: `edge`, a ticket number, whose case
it is. The table grows a tags column once any scenario has one. Every tag shows above the table
with its pass count, and clicking one narrows the table to it (a row added while narrowed gets
the tag). The Markdown export carries the tags
and ends the scenario table with a tally per tag.

A scenario can also carry a **description**, a few lines saying why it exists. It is shown in the
scenario's panel only, never in the table. (An older file's scenario *note* is read as its description.)

**Generate…** beside *+ Scenario* writes scenarios from the inputs. The values come from the
drawing: an enum's values, yes and no for a boolean, and for a number or a text the constants the
guards hold it against, one on each side of the line (`amount > 100` gives 100 and 101;
`attempts >= 3`, with `attempts` starting as the input `attempt`, gives `attempt` 2 and 3). A
list gets no records, one record of each kind its fields allow (`picked < qty` inside a `where`
gives `picked` 0 and 1) and one of each together. The dialog lists every input with its values as
chips. Click a value to leave it out, or bring it back; ⌥-click keeps only that one (again, and
they all come back); an input's checkbox takes all its values or none. An input with nothing
picked holds its usual value. To start with, every value of every input some guard reads is
picked, since only those change the path.

Every combination of the picked values is then played through the drawing, and by default a
scenario is written for each **way through the drawing**, not for each combination: combinations
that take the same edges to the same end, or get stuck at the same place, are written once. When a
guard only treats `UK` differently, `DE`, `FR` and `US` share a row, and which of them a row
holds takes turns across the rows, so each turns up somewhere. A row's name leaves out the inputs
that make no difference to its way (the order with nothing in stock is `items=none`, whatever its
coupon), and its description says so, and which other values would have gone the same way. On the
Advanced checkout that is 15 rows instead of 96, and they touch every node and edge the 96 would.
*One for every combination* writes all of them instead.

What a scenario already has is left out, its way or its combination, so pressing it again after a
value was added to an enum adds only what is new. Each row is tagged `generated` (or whatever you
type in the dialog's Tags box, comma-separated; empty for none) and described in its panel with
the branches it took. What the drawing did with it becomes its expectation, so the table documents
the drawing branch by branch and you edit the rows the drawing gets wrong; or leave the
expectations blank and fill them in by hand. A combination no branch handles comes out *stuck*, in
red: the case nobody drew.

**Coverage** dims every node and edge that no scenario touches. In a review, "nobody wrote a
scenario for the else branch" is the sentence you want before the code exists.

## Keys

| Key | Does |
|---|---|
| click or drag a shape from the palette | add a node · place it where it drops |
| drag empty canvas | rubber-band select (Shift adds to the selection) |
| Space-drag · middle button · wheel | pan |
| ⌘-wheel · pinch | zoom |
| drag from a dot on the selected node's side to another node | connect them, on those sides; the dots show on the selected node, and under the pointer while a wire is out |
| drag an end of the selected wire | move that end to another dot or node |
| drag a wire | pull it through that point, out of the way; double-click straightens it |
| drag a wire's pill | slide the label along the wire; double-click puts it back in the middle |
| Shift-click a node | add it to the selection, or take it out |
| ⌘A | select every node |
| ⌘C · ⌘X · ⌘V · ⌘D | copy · cut · paste (at the pointer) · duplicate the selected nodes |
| right-click | a menu: add a shape or paste on empty canvas; copy, cut, duplicate or delete a node |
| drag a selected node | move the whole selection together |
| Delete / Backspace | remove the selected nodes, edge or scenario |
| ⌘Z · ⇧⌘Z | undo · redo |
| click · double-click a scenario row | select it, its path on the canvas · open it in the side panel |
| ↑ · ↓, with a scenario selected | the scenario above · below; in a text cell, the same cell a row up · down |
| Space, with a scenario selected | play it step by step |
| F | fit the drawing to the window |
| arrow keys · ⇧ arrow keys | nudge the selected node one grid step · five |
| Alt while dragging a node | place it off the grid |
| double-click a node | edit its label |
| Esc | clear the selection |
| ? | this table, in the page |
| ⌘S | save |
| drop a `.json` file on the page | open it |

## A team and a folder

A team has more than one feature, and every feature has a flow. Give the server a folder and the
page becomes a project:

```bash
npm start -- ./specs       # or PLAYTHROUGH_DIR=./specs npm start; npm run start:example for a demo
```

Every `*.json` in the folder, and in its subfolders, is a flow. A sidebar shows them as a tree:
a group (a subfolder on disk) keeps related flows together, its `+`/`−` folds it, and a flow or
a group dragged onto another group moves there, a group with everything in it; dropped on the
list's empty space it goes back to the root. Each flow shows its pass count (`3/4`), a ⚠ when the drawing
has problems, and *no scenarios* when nobody has written any yet. Click one to open it. **+ Flow**
starts a new file, and a `/` in its name puts it in a group, made if it is not there yet
(`Billing/refund intake`); a group's own + starts one inside it; **+ Group** makes an empty
group, named as you type it; **Save** (or ⌘S) writes the open flow back to its file, and a flow that came in through
**New**, **Open…**, **Import**, a preset or a link is added to the folder the first time it is saved. On a
row, ✎ renames the file, as typed with `.json` at the end (a `/` moves it; the flow keeps its own name) and × deletes it; a group's
✎ renames the folder, with everything in it coming along (a `/` moves it under other groups), and
its × deletes it with everything in it, after saying how much that is. The project's name sits in the header, in place of the flow's: type there
to name it once, and it is kept in `project.json`; until then the folder's name is used. The « at the top left of the drawing, beside the sidebar,
hides it; the same button, now », brings it back.

Put the folder in git. That is the whole collaboration story, on purpose: the pull request is
the review, `git log` is the history, and a merge conflict in a flow file is a real disagreement
about the design. The page notices when a file changed on disk since it was opened, a pull for
instance, and asks before writing over it. The server is only ever a way for the page to reach
the folder; it holds nothing itself. There are no accounts, and two people editing the same flow
at the same moment will find out when the second one saves.

## The file

Without a project folder, **Save** downloads the flow as JSON; **Open…** reads one back, and so
does dropping the file anywhere on the page. In a project, Save writes the file in place and
*Download as JSON* under **Share ▾** does what Save used to. The browser also keeps the current flow between reloads, but that is not a
file: a dot next to **Save** (and in the tab title) means the flow has changed since it was last
saved or opened, and the page will say so before you close it or replace it with **New**, an
**Import** or a preset.

**Share ▾** has two ways out that need no file. *Copy as Markdown* puts the flow on the clipboard
as a spec: inputs, state, every decision with its branches, and the scenario table with each row's
current pass or fail, ready for a ticket or a pull request. *Copy link* puts the whole flow in the
URL (compressed, nothing leaves the browser); whoever opens the link gets the flow, and the page
drops the hash once it has read it. Flows too big for a link are told so; use **Save**.

The shape is small enough to write by hand or generate:

```json
{
  "name": "Checkout",
  "inputs": [{ "name": "channel", "type": "enum", "values": ["Web", "App", "Phone"] },
             { "name": "hasCoupon", "type": "boolean" }],
  "state":  [{ "name": "discount", "initial": null }],
  "nodes":  [{ "id": "start", "kind": "start", "label": "Order placed", "x": 80, "y": 220 },
             { "id": "apply", "kind": "action", "label": "Apply coupon",
               "x": 800, "y": 120, "set": { "discount": "10" } }],
  "edges":  [{ "id": "e3", "from": "coupon", "to": "apply", "when": "hasCoupon" },
             { "id": "e4", "from": "coupon", "to": "full", "else": true }],
  "scenarios": [{ "name": "Web order with a coupon",
                  "description": "The common case; the coupon takes ten off",
                  "tags": ["happy path"],
                  "inputs": { "channel": "Web", "hasCoupon": true },
                  "expect": { "actions": ["Reserve stock", "Apply coupon"],
                              "end": "Done", "state": { "discount": "*" } } }]
}
```

See `examples/simple/checkout.json` for the whole thing, and `examples/advanced/` for flows
with list inputs, state set along the way and edges with labels and colours.

## Templates

**Template ▾** in the header has three items.

*Presets* opens a list of starting points, each a small project of flows kept under `examples/`:

| Preset | What is in it |
|---|---|
| **Empty** | Nothing: a blank canvas. In a project folder, loading it empties the folder. |
| **Simple** | A shop in two flows, *Checkout* and *Returns*, at the root of the folder. |
| **Advanced** | The same shop in six flows and three groups: `orders/` (checkout, payment), `fulfilment/` (pick and pack, delivery) and `after-sale/` (returns, refunds). List inputs, `where`, `count`, state, labelled and coloured edges, and a scenario for every branch. |

Each card shows its flows as the tree the sidebar would show. In a folder a preset lands under a
group of its own name, so the Advanced one is `advanced/orders/checkout.json` and so on, and two
presets, or a preset and your own flows, keep apart. A flow's name opens just that flow on the
page, not in any file. **Load it** starts over from the preset: without a project folder the page
shows the preset's first flow; with one, the folder is emptied, after a question that says how much
is in it, and the preset's flows are written in, groups and all. **Add to this one** (only with a
folder) writes the preset's flows in beside what is there, leaving alone any file that already
exists.

*Import* takes a flow's JSON pasted into a box and puts it on the page. *Export* shows the flow
on the page as JSON, and puts it on the clipboard, to paste into another page's Import or into a
file in a project folder.

## Layout of the code

```
lib/expr.mjs     the condition language: tokenizer, parser, evaluator, name check
lib/run.mjs      the interpreter: run, verdict, runAll (with coverage), lint
lib/markdown.mjs the flow as a Markdown spec, for Share ▾
lib/generate.mjs scenarios from the inputs: one per way through the drawing, or every combination
lib/project.mjs  a folder of flows: list with pass counts, read, write without clobbering
ui/store.mjs     the document, selection, undo, autosave, which project file is open
ui/canvas.mjs    the SVG drawing and its pointer interactions
ui/inspector.mjs the side panel for whatever is selected
ui/table.mjs     the scenario spreadsheet
ui/project.mjs   the project sidebar and the calls to the folder API
ui/presets.mjs   the Presets dialog under Template ▾
ui/generate.mjs  the Generate… dialog beside + Scenario
ui/dialog.mjs    ask, notice, prompt, toast: the page's own dialogs
ui/app.mjs       header, keyboard, play, boot
serve.mjs        a static file server, plus GET/PUT/POST/DELETE /api/flows over the folder
examples/        the presets: presets.json lists them; simple/ and advanced/ are project folders
```

`lib/` has no DOM in it and is what the tests exercise. Everything in `ui/` re-renders from the
document on every change; the drawings this is for have dozens of nodes, not thousands.

## License

Apache 2.0.
