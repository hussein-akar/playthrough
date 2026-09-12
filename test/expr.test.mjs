import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, test, check, names, same } from '../lib/expr.mjs';

const scope = {
  inputs: { type: 'Subscription', isExpress: true, amount: 250, tags: ['a', 'b'], who: { role: 'clerk' } },
  state: { deliveryDate: null, count: 0 },
  enums: new Set(['Subscription', 'Preorder', 'Wholesale', 'Refund']),
};

it('bare enum words need no quotes', () => {
  assert.equal(test('type in [Subscription, Preorder, Wholesale]', scope), true);
  assert.equal(test('type == Refund', scope), false);
  assert.equal(test('type not in [Refund]', scope), true);
});

it('booleans stand alone and negate', () => {
  assert.equal(test('isExpress', scope), true);
  assert.equal(test('not isExpress', scope), false);
  assert.equal(test('!isExpress', scope), false);
});

it('comparisons, arithmetic, precedence', () => {
  assert.equal(test('amount > 100 and amount <= 250', scope), true);
  assert.equal(test('amount + 50 == 300', scope), true);
  assert.equal(test('amount * 2 - 1 == 499', scope), true);
  assert.equal(test('amount > 1000 or (isExpress and type == Subscription)', scope), true);
  assert.equal(test('not (amount > 1000 or isExpress)', scope), false);
});

it('state and dotted names resolve', () => {
  assert.equal(test('deliveryDate == null', scope), true);
  assert.equal(test('who.role == "clerk"', scope), true);
  assert.equal(test("count = 0", scope), true, 'a single = reads as ==');
});

it('empty means always', () => {
  assert.equal(test('', scope), true);
  assert.equal(test('   ', scope), true);
});

it('unknown names fail loudly, at run and at check', () => {
  assert.throws(() => test('typo == 1', scope), /unknown name 'typo'/);
  assert.deepEqual(check('typo == 1 and isExpress', new Set(['isExpress'])), ["unknown name 'typo'"]);
  assert.deepEqual(check('isExpress', new Set(['isExpress'])), []);
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
  const s = { ...scope, inputs: { ...scope.inputs, notices: [{ status: 'OPEN', linked: false }, { status: 'CLOSED', linked: true }, { status: 'CANCELLED', linked: false }] }, enums: new Set([...scope.enums, 'OPEN', 'CLOSED', 'CANCELLED']) };
  assert.equal(test('count(notices) == 3', s), true);
  assert.equal(test('count(notices where status != CANCELLED) == 2', s), true);
  assert.equal(test('count(notices where status != CANCELLED where not linked) == 1', s), true, 'where chains');
  assert.equal(test('notices where status == OPEN and linked', s), false, 'an empty list is false');
  assert.equal(test('notices where status == OPEN', s), true, 'a list with records is true');
  assert.equal(test('count(notices where status == OPEN) + 1 == 2', s), true, 'count sits inside arithmetic');
  assert.equal(test('count = 0', scope), true, 'count is still a plain name when not called');
  assert.throws(() => test('count(amount)', s), /needs a list/);
  assert.throws(() => test('amount where amount > 1', s), /needs a list/);
});

it('the checker knows the fields of a list inside where', () => {
  const known = new Set(['notices', 'kept', 'amount', 'OPEN']);
  const lists = new Map([['notices', new Set(['status', 'linked'])]]);
  assert.deepEqual(check('count(notices where status == OPEN and linked) > 0', known, lists), []);
  assert.deepEqual(check('notices where bogus == OPEN', known, lists), ["unknown name 'bogus'"]);
  assert.match(check('status == OPEN', known, lists)[0], /field of a notices record.*notices where status/, 'a field is only a name inside where, and the message says so');
  assert.deepEqual(check('kept where status == OPEN', known, lists), [], 'a list held in state may use any list field');
  assert.deepEqual(check('count(nothing)', known, lists), ["unknown name 'nothing'"]);
});

it('?? falls back when the left is blank, and binds tightly', () => {
  const s = { ...scope, inputs: { ...scope.inputs, blank: null, notices: null } };
  assert.equal(test('blank ?? 5 == 5', s), true);
  assert.equal(test('amount ?? 0 == 250', s), true);
  assert.equal(test('(blank ?? 1) * 2 == 2', s), true);
  assert.equal(test('count(notices ?? []) == 0', s), true, 'an empty list literal is a fine fallback');
});
