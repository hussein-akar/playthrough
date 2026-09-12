import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, test, check, names, same } from '../lib/expr.mjs';

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
  assert.deepEqual(check('lines where bogus == PICKED', known, lists), ["unknown name 'bogus'"]);
  assert.match(check('status == PICKED', known, lists)[0], /field of a lines record.*lines where status/, 'a field is only a name inside where, and the message says so');
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
