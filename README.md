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
npm start            # http://localhost:8095/
npm test             # the interpreter and the condition language
```

The page opens on the example, a order intake flow with four scenarios. One of them fails on
purpose: somebody assumed an wholesale order goes to post-processing, and the drawing says otherwise.

## What a flow is made of

| Piece | What it means |
|---|---|
| **Start** | Where a scenario enters. One per flow. |
| **Action** | Something that happens: a document created, an event published. A scenario expects a set of these. An action may also *set* a state field. |
| **Decision** | A fork. Each edge leaving it carries a condition; one edge may be *else*. |
| **End** | Where a scenario lands. A scenario may expect a particular one. |
| **Inputs** | What a scenario provides, declared once on the flow with a type: enum, boolean, number, text. Conditions can only mention declared inputs, so a typo is caught while drawing, not while running. |
| **State** | Fields an action may set along the way, and a scenario may check at the end. |

Conditions read like the sentence in the spreadsheet:

```
type in [Subscription, Preorder, Wholesale]
isExpress
amount > 100 and not blocked
deliveryDate == null
```

Enum values need no quotes. `and`, `or`, `not`, `in`, comparisons and arithmetic are all there is.

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

**Coverage** dims every node and edge that no scenario touches. In a review, "nobody wrote a
scenario for the else branch" is the sentence you want before the code exists.

## Keys

| Key | Does |
|---|---|
| drag empty canvas · wheel | pan · zoom |
| double-click empty canvas | add an action node there |
| drag from a node's ○ port onto a node | connect them |
| Delete / Backspace | remove the selected node, edge or scenario |
| ⌘Z · ⇧⌘Z | undo · redo |
| Space, with a scenario selected | play it step by step |
| F | fit the drawing to the window |
| Esc | clear the selection |
| ? | this table, in the page |
| drop a `.json` file on the page | open it |

## The file

**Save** downloads the flow as JSON; **Open…** reads one back, and so does dropping the file
anywhere on the page. The browser also keeps the current flow between reloads, but that is not a
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
ui/store.mjs     the document, selection, undo, autosave
ui/canvas.mjs    the SVG drawing and its pointer interactions
ui/inspector.mjs the side panel for whatever is selected
ui/table.mjs     the scenario spreadsheet
ui/app.mjs       header, keyboard, play, boot
serve.mjs        a static file server, because ES modules will not load over file://
```

`lib/` has no DOM in it and is what the tests exercise. Everything in `ui/` re-renders from the
document on every change; the drawings this is for have dozens of nodes, not thousands.

## License

Apache 2.0.
