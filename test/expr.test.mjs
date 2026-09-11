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
