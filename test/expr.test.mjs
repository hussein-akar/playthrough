import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, test, check, ambiguous, compile, evaluate, names, same, LIBRARY, METHODS, FUNCTIONS } from '../lib/expr.mjs';

const scope = {
  inputs: { channel: 'Web', hasCoupon: true, amount: 250, tags: ['a', 'b'], who: { role: 'clerk' } },
  state: { discount: null, count: 0 },
  enums: new Set(['Web', 'App', 'Phone', 'Kiosk']),
};

it('bare enum words need no quotes', () => {
  assert.equal(test('channel in [Web, App, Phone]', scope), true);
  assert.equal(test('channel == Kiosk', scope), false);
  assert.equal(test('channel not in [Kiosk]', scope), true);
});

it('booleans stand alone and negate', () => {
  assert.equal(test('hasCoupon', scope), true);
  assert.equal(test('not hasCoupon', scope), false);
  assert.equal(test('!hasCoupon', scope), false);
});

it('comparisons, arithmetic, precedence', () => {
  assert.equal(test('amount > 100 and amount <= 250', scope), true);
  assert.equal(test('amount + 50 == 300', scope), true);
  assert.equal(test('amount * 2 - 1 == 499', scope), true);
  assert.equal(test('amount > 1000 or (hasCoupon and channel == Web)', scope), true);
  assert.equal(test('not (amount > 1000 or hasCoupon)', scope), false);
});

it('state and dotted names resolve', () => {
  assert.equal(test('discount == null', scope), true);
  assert.equal(test('who.role == "clerk"', scope), true);
  assert.equal(test("count = 0", scope), true, 'a single = reads as ==');
});

it('empty means always', () => {
  assert.equal(test('', scope), true);
  assert.equal(test('   ', scope), true);
});

it('unknown names fail loudly, at run and at check', () => {
  assert.throws(() => test('typo == 1', scope), /unknown name 'typo'/);
  assert.deepEqual(check('typo == 1 and hasCoupon', new Set(['hasCoupon'])), ["unknown name 'typo'"]);
  assert.deepEqual(check('hasCoupon', new Set(['hasCoupon'])), []);
  assert.match(check('amount >', new Set())[0], /unexpected end/);
  assert.match(check('amount > 1 1', new Set())[0], /unexpected "1"/);
});

it('names lists what an expression touches', () => {
  assert.deepEqual(names(parse('a in [b, c] and not d.e')), ['a', 'b', 'c', 'd.e']);
});

it('same is spreadsheet-tolerant', () => {
  assert.equal(same(true, 'yes'), true);
  assert.equal(same(false, 'no'), true);
  assert.equal(same(1, '1'), true);
  assert.equal(same(1, '1x'), false);
  assert.equal(same(null, undefined), true);
  assert.equal(same('a', 'b'), false);
});

it('where narrows a list and count measures it', () => {
  const s = { ...scope, inputs: { ...scope.inputs, lines: [{ status: 'PICKED', gift: false }, { status: 'SHORT', gift: true }, { status: 'CANCELLED', gift: false }] }, enums: new Set([...scope.enums, 'PICKED', 'SHORT', 'CANCELLED']) };
  assert.equal(test('count(lines) == 3', s), true);
  assert.equal(test('count(lines where status != CANCELLED) == 2', s), true);
  assert.equal(test('count(lines where status != CANCELLED where not gift) == 1', s), true, 'where chains');
  assert.equal(test('lines where status == PICKED and gift', s), false, 'an empty list is false');
  assert.equal(test('lines where status == PICKED', s), true, 'a list with records is true');
  assert.equal(test('count(lines where status == PICKED) + 1 == 2', s), true, 'count sits inside arithmetic');
  assert.equal(test('count = 0', scope), true, 'count is still a plain name when not called');
  assert.throws(() => test('count(amount)', s), /needs a list/);
  assert.throws(() => test('amount where amount > 1', s), /needs a list/);
});

it('the checker knows the fields of a list inside where', () => {
  const known = new Set(['lines', 'kept', 'amount', 'PICKED']);
  const lists = new Map([['lines', new Set(['status', 'gift'])]]);
  assert.deepEqual(check('count(lines where status == PICKED and gift) > 0', known, lists), []);
  assert.deepEqual(check('lines where bogus == PICKED', known, lists), ["a lines record has no 'bogus'; it has status, gift"]);
  assert.match(check('status == PICKED', known, lists)[0], /field of a lines record.*lines\.filter\(status/, 'a field is only a name inside a filter, and the message says so');
  assert.deepEqual(check('kept where status == PICKED', known, lists), [], 'a list held in state may use any list field');
  assert.deepEqual(check('count(nothing)', known, lists), ["unknown name 'nothing'"]);
});

it('?? falls back when the left is blank, and binds tightly', () => {
  const s = { ...scope, inputs: { ...scope.inputs, blank: null, lines: null } };
  assert.equal(test('blank ?? 5 == 5', s), true);
  assert.equal(test('amount ?? 0 == 250', s), true);
  assert.equal(test('(blank ?? 1) * 2 == 2', s), true);
  assert.equal(test('count(lines ?? []) == 0', s), true, 'an empty list literal is a fine fallback');
});

const listScope = {
  inputs: {
    lines: [{ status: 'PICKED', qty: 2, picked: 2, gift: false }, { status: 'SHORT', qty: 3, picked: 1, gift: true }],
    amount: 250, paid: true, refunded: false, manualOverride: false,
  },
  state: {},
  enums: new Set(['PICKED', 'SHORT', 'CANCELLED']),
};
const listKnown = new Set(['lines', 'amount', 'paid', 'refunded', 'manualOverride', 'PICKED', 'SHORT', 'CANCELLED']);
const listFields = new Map([['lines', new Set(['status', 'qty', 'picked', 'gift'])]]);

it('the connectives have the spelling code uses, and brackets group', () => {
  assert.equal(test('paid && !refunded', listScope), true);
  assert.equal(test('(paid && refunded) || manualOverride', listScope), false);
  assert.equal(test('paid && (refunded || manualOverride) == false', listScope), true);
  assert.equal(test('amount > 100 && amount <= 250', listScope), true);
  assert.equal(test('paid and not refunded', listScope), true, 'the words still mean the same');
  assert.deepEqual(check('(paid || refunded) && !manualOverride', listKnown, listFields), []);
});

it('a list of values takes brackets or parentheses', () => {
  assert.equal(test('lines.any(status in (PICKED, CANCELLED))', listScope), true);
  assert.equal(test('lines.any(status in [PICKED, CANCELLED])', listScope), true);
  assert.equal(test('amount in (100, 250)', listScope), true);
  assert.equal(test('(amount) == 250', listScope), true, 'one thing in parentheses is still grouping, not a list');
});

it('a list answers size, and the methods ask about its records', () => {
  assert.equal(test('lines.size == 2', listScope), true);
  assert.equal(test('lines.length >= 1', listScope), true);
  assert.equal(test('lines.size >= 193', listScope), false);
  assert.equal(test('lines.count(picked < qty) == 1', listScope), true);
  assert.equal(test('lines.any(status == SHORT)', listScope), true);
  assert.equal(test('lines.all(qty > 0)', listScope), true);
  assert.equal(test('lines.none(status == CANCELLED)', listScope), true);
  assert.equal(test('lines.filter(gift).size == 1', listScope), true, 'a filter is a list, and chains');
  assert.equal(test('lines.count() == 2', listScope), true, 'nothing in the brackets counts them all');
  assert.equal(test('lines.count(o -> o.picked < o.qty) == 1', listScope), true, 'the record may be named instead');
  assert.equal(test('lines.any(o -> o.status == SHORT)', listScope), true);
  assert.throws(() => test('lines.any(o -> status == SHORT)', listScope), /unknown name 'status'/, 'named, the record is reachable only by that name');
});

it('an empty or missing list answers rather than throwing', () => {
  const s = { ...listScope, inputs: { ...listScope.inputs, lines: [], nothing: null } };
  assert.equal(test('lines.size == 0', s), true);
  assert.equal(test('lines.any(gift)', s), false);
  assert.equal(test('lines.all(gift)', s), true, 'every one of none of them does');
  assert.equal(test('nothing.size == 0', s), true);
  assert.throws(() => test('amount.any(gift)', listScope), /needs a list/);
});

it('the old spellings and the new ones are the same expression', () => {
  const pairs = [
    ['count(lines)', 'lines.size'],
    ['count(lines where status != CANCELLED)', 'lines.count(status != CANCELLED)'],
    ['lines where picked < qty', 'lines.filter(picked < qty)'],
    ['lines.filter(picked < qty)', 'lines.filter(o -> o.picked < o.qty)'],
    ['channel in [PICKED]', 'channel in (PICKED)'],
    ['paid and not refunded', 'paid && !refunded'],
  ];
  const s = { ...listScope, inputs: { ...listScope.inputs, channel: 'PICKED' } };
  for (const [was, now] of pairs) assert.equal(test(was, s), test(now, s), `${was} === ${now}`);
});

it('a function nobody has, and a field no record has, are caught before anything runs', () => {
  assert.deepEqual(check('lines.frobnicate(qty)', listKnown, listFields), ["a list has no 'frobnicate'; it has size, length, filter, count, any, all, none"]);
  assert.match(check('sum(lines)', listKnown, listFields)[0], /no 'sum' function/);
  const missing = ["a lines record has no 'typo'; it has status, qty, picked, gift"];
  assert.deepEqual(check('lines.any(typo == 1)', listKnown, listFields), missing);
  assert.deepEqual(check('lines.any(o -> o.typo == 1)', listKnown, listFields), missing, 'named or bare, the same field is missing');
  assert.deepEqual(check('lines.any(status == PICKED)', listKnown, listFields), []);
  assert.deepEqual(check('kept.any(status == PICKED)', new Set([...listKnown, 'kept', 'PICKED']), listFields), [], 'a list in state declares no fields of its own, so any list\'s field will do');
  assert.deepEqual(check('kept.any(o -> o.anything)', new Set([...listKnown, 'kept']), listFields), [], 'and a named record there is not second-guessed at all');
  assert.deepEqual(check('lines.any(amount > 1)', listKnown, listFields), [], 'an input is still in scope inside the brackets');
});

it('a name can still be called count or filter, and a record field is its own', () => {
  const s = { inputs: { count: 3, filter: 'on', who: { role: 'clerk' } }, state: {}, enums: new Set() };
  assert.equal(test('count == 3', s), true);
  assert.equal(test('filter == "on"', s), true);
  assert.equal(test('who.role == "clerk"', s), true);
  assert.equal(test('who.constructor == null', s), true, 'only what the record holds itself is a field');
});

it('the library, the checker and the evaluator say the same thing', () => {
  for (const e of LIBRARY) {
    assert.ok(e.name && e.group && e.form && e.takes && e.what && e.example && e.insert, `${e.name} is missing a part`);
    assert.doesNotThrow(() => parse(e.example), `the example for ${e.name} does not parse: ${e.example}`);
  }
  assert.deepEqual([...METHODS], ['size', 'length', 'filter', 'count', 'any', 'all', 'none']);
  assert.deepEqual([...FUNCTIONS], ['count']);
  // Every method the library lists is one the evaluator answers, not one it refuses as unknown.
  for (const m of METHODS) assert.doesNotThrow(() => test(`lines.${m}(gift) != 99`, listScope), m);
});

it('a record field called size is the field, not how many there are', () => {
  const s = { inputs: { parcels: [{ size: 3, name: 'a' }, { size: 9, name: 'b' }] }, state: {}, enums: new Set() };
  assert.equal(test('parcels.any(size > 5)', s), true, 'bare, it is the field');
  assert.equal(test('parcels.any(o -> o.size > 5)', s), true, 'named, it is still the field');
  assert.equal(test('parcels.size == 2', s), true, 'the list itself has no fields, so there it is the count');
});

// A list of lines, each with a `qty`, in a flow that also has an input called `qty`: the quantity
// the customer asked for. Both names are live in the same expression, which is the whole problem.
const shadowScope = {
  inputs: { lines: [{ qty: 2, picked: 1 }, { qty: 5, picked: 5 }], qty: 99, picked: true },
  state: {}, enums: new Set(),
};
const shadowKnown = new Set(['lines', 'qty', 'picked']);
const shadowLists = new Map([['lines', new Set(['qty', 'picked'])]]);

it('naming the record is what reaches past it, and it reaches all the way', () => {
  const kept = (src) => evaluate(compile(src), shadowScope);
  // Bare, or under its name: `o.qty` is the line's.
  assert.deepEqual(kept('lines.filter(qty > 4)'), [{ qty: 5, picked: 5 }]);
  assert.deepEqual(kept('lines.filter(o -> o.qty > 4)'), [{ qty: 5, picked: 5 }]);
  // Named, a bare word is the input: the record is `o` and nothing else.
  assert.deepEqual(kept('lines.filter(o -> o.qty > qty)'), [], 'no line asks for more than the 99 ordered');
  assert.deepEqual(kept('lines.filter(o -> qty > 50)'), shadowScope.inputs.lines, '99 > 50 holds for every line');
  assert.equal(test('lines.any(o -> picked)', shadowScope), true, 'the boolean input, not the number field');
  assert.equal(test('lines.none(o -> o.picked > 4)', shadowScope), false, 'and the field is still there under its name');
});

it('a name that would be read two ways is said out loud', () => {
  const [first, second] = ambiguous('lines.filter(picked < qty)', shadowKnown, shadowLists);
  assert.match(first, /'picked' is both a field of a lines record and a name the flow declares/);
  assert.match(first, /`lines\.filter\(o -> o\.picked …\)` is the field/);
  assert.match(second, /'qty' is both/);
  assert.deepEqual(ambiguous('lines.filter(o -> o.picked < o.qty)', shadowKnown, shadowLists), [], 'named, there is nothing left to guess');
  assert.deepEqual(ambiguous('lines.filter(o -> picked < qty)', shadowKnown, shadowLists), [], 'either way round');
  assert.deepEqual(ambiguous('lines.filter(picked < 2)', new Set(['lines']), shadowLists), [], 'a field nothing else is called is not ambiguous');
  assert.equal(ambiguous('lines where picked < qty', shadowKnown, shadowLists).length, 2, 'the older spelling has always had it too');
  assert.deepEqual(ambiguous('lines.filter(', shadowKnown, shadowLists), [], 'a syntax error is check to report, not this');
  // It is a warning, not an error: the expression runs, it just does not say which it meant.
  assert.deepEqual(check('lines.filter(picked < qty)', shadowKnown, shadowLists), []);
});

it('a field reached bare under a name is told how to reach it', () => {
  assert.deepEqual(check('lines.any(o -> qty > 1)', shadowKnown, shadowLists), [], 'a bare name is the input, which is declared');
  assert.deepEqual(check('lines.any(o -> picked)', shadowKnown, shadowLists), []);
  assert.deepEqual(check('lines.any(o -> picked)', new Set(['lines']), shadowLists),
    ["'picked' is a field of a lines record, and this names that record `o`; write `o.picked`"]);
});
