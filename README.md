# Playthrough

**Draw the feature before it exists. Then play your scenarios through the drawing.**

A team designing a feature draws a flow on a whiteboard and lists the cases in a spreadsheet:
*if the order type is Subscription and there is express shipping, then…* The drawing and the spreadsheet
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
npm test                   # the interpreter, the condition language, the project folder
```

The page opens on the example, a order intake flow with four scenarios. One of them fails on
purpose: somebody assumed an wholesale order goes to post-processing, and the drawing says otherwise.

## What a flow is made of

| Piece | What it means |
|---|---|
| **Start** | Where a scenario enters. One per flow. |
| **Action** | Something that happens: a document created, an event published. A scenario expects a set of these. An action may also *set* a state field. |
| **Decision** | A fork. Each edge leaving it carries a condition; one edge may be *else*. An edge may carry a short label, shown on the canvas in place of its condition, and a status colour: success, failed, warning or info. A wire is smooth or square; a small bar over the selected wire switches both. |
| **End** | Where a scenario lands. A scenario may expect a particular one. |
| **Inputs** | What a scenario provides, declared once on the flow with a type: enum, boolean, number, text, or a list of records with fields of their own. Conditions can only mention declared inputs, so a typo is caught while drawing, not while running. |
| **State** | Fields an action may set along the way, and a scenario may check at the end. |

Conditions read like the sentence in the spreadsheet:

```
type in [Subscription, Preorder, Wholesale]
isExpress
amount > 100 and not blocked
deliveryDate == null
```

Enum values need no quotes. `and`, `or`, `not`, `in`, comparisons and arithmetic are all there is,
plus two words for lists.

A list input holds records: it is declared with its fields (`notices`, with `status` an enum of
OPEN, CLOSED, CANCELLED and `linked` a boolean), and a scenario writes the records one per line,
`status=OPEN, linked=yes`, or just the values in field order, `OPEN, yes`. An action narrows a
list with `where` into a state field, and a guard measures it with `count`:

```
kept = notices where status != CANCELLED       an action's set
count(kept) == 0                              a guard
count(kept where linked) > 1
```

Inside `where`, a bare word is first a field of the record being looked at. An empty list is
false, so `kept where linked` alone reads "some kept notice is linked". A scenario's expected
state for a list is a count, `*` for some, or `null` for none. The filters in the drawing are
then really exercised: how many notices remain is worked out, not typed in.

Beside the condition on an edge sits an *insert…* menu with every declared input and state
field, each enum's values and the operators: a pick lands at the cursor, so a guard is assembled
from what the flow declares rather than typed from memory.

The panel checks a condition or a set expression as you type: a name nobody declared or a
missing bracket shows up under the field at once. Renaming an input or a state field rewrites
every guard, set and scenario cell that mentioned it, in one undoable step.

## Drawing

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
means *any value but null*, `null` means null, anything else is compared to the value.

In the scenario panel, expected actions are listed in the order the flow meets them, each marked
✓ or ✗ for the last run, and every step of the result path is a link to its node. When a
scenario fails and it is the drawing that is right, **Use this run as the expectation** (or
*accept run* in the row) copies what actually happened into the expectation. In the table, Enter
on the last row starts the next scenario and *+N more* opens the full list of issues.

A scenario can carry **tags**, comma-separated in its row or its panel: `edge`, a ticket number,
whose case it is. Every tag shows above the table with its pass count, and clicking one narrows
the table to it (a row added while narrowed gets the tag). The Markdown export carries the tags
and ends the scenario table with a tally per tag.

**Coverage** dims every node and edge that no scenario touches. In a review, "nobody wrote a
scenario for the else branch" is the sentence you want before the code exists.

## Keys

| Key | Does |
|---|---|
| click or drag a shape from the palette | add a node · place it where it drops |
| drag empty canvas | rubber-band select (Shift adds to the selection) |
| Space-drag · middle button · wheel | pan |
| ⌘-wheel · pinch | zoom |
| drag from a dot on a node's side to a dot on another node | connect them, on those sides |
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

Every `*.json` in the folder is a flow. A sidebar lists them with their pass count (`3/4`), a ⚠
when the drawing has problems, and *no scenarios* when nobody has written any yet. Click one to
open it. **+ Flow** starts a new file; **Save** (or ⌘S) writes the open flow back to its file,
and a flow that came in through **New**, **Open…**, **Example** or a link is added to the folder
the first time it is saved. On a row, ✎ renames the file (the flow keeps its own name) and × deletes it. An optional `project.json` with a
`name` names the project; otherwise the folder does. **Flows** in the header hides the sidebar.

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
saved or opened, and the page will say so before you close it or replace it with **New** or
**Example**.

**Share ▾** has two ways out that need no file. *Copy as Markdown* puts the flow on the clipboard
as a spec: inputs, state, every decision with its branches, and the scenario table with each row's
current pass or fail, ready for a ticket or a pull request. *Copy link* puts the whole flow in the
URL (compressed, nothing leaves the browser); whoever opens the link gets the flow, and the page
drops the hash once it has read it. Flows too big for a link are told so; use **Save**.

The shape is small enough to write by hand or generate:

```json
{
  "name": "Order intake",
  "inputs": [{ "name": "type", "type": "enum", "values": ["Subscription", "Refund"] },
             { "name": "isExpress", "type": "boolean" }],
  "state":  [{ "name": "deliveryDate", "initial": null }],
  "nodes":  [{ "id": "start", "kind": "start", "label": "Order Placed", "x": 80, "y": 220 },
             { "id": "setdate", "kind": "action", "label": "Set express delivery date",
               "x": 800, "y": 120, "set": { "deliveryDate": "'today'" } }],
  "edges":  [{ "id": "e3", "from": "express", "to": "setdate", "when": "isExpress" },
             { "id": "e4", "from": "express", "to": "keepnull", "else": true }],
  "scenarios": [{ "name": "Subscription with express shipping",
                  "tags": ["happy path"],
                  "inputs": { "type": "Subscription", "isExpress": true },
                  "expect": { "actions": ["Create Shipment", "Set express delivery date"],
                              "end": "Done", "state": { "deliveryDate": "*" } } }]
}
```

See `examples/order.json` for the whole thing.

## Layout of the code

```
lib/expr.mjs     the condition language: tokenizer, parser, evaluator, name check
lib/run.mjs      the interpreter: run, verdict, runAll (with coverage), lint
lib/markdown.mjs the flow as a Markdown spec, for Share ▾
lib/project.mjs  a folder of flows: list with pass counts, read, write without clobbering
ui/store.mjs     the document, selection, undo, autosave, which project file is open
ui/canvas.mjs    the SVG drawing and its pointer interactions
ui/inspector.mjs the side panel for whatever is selected
ui/table.mjs     the scenario spreadsheet
ui/project.mjs   the project sidebar and the calls to the folder API
ui/dialog.mjs    ask, notice, prompt, toast: the page's own dialogs
ui/app.mjs       header, keyboard, play, boot
serve.mjs        a static file server, plus GET/PUT/POST/DELETE /api/flows over the folder
```

`lib/` has no DOM in it and is what the tests exercise. Everything in `ui/` re-renders from the
document on every change; the drawings this is for have dozens of nodes, not thousands.

## License

Apache 2.0.
