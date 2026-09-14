// The condition language. Small on purpose: a guard on an edge reads like the sentence a
// designer would have written in the spreadsheet, and every name in it is checked against the
// flow's declared inputs and state before anything runs.
//
//   channel in [Web, App, Marketplace]        channel in (Web, App, Marketplace)
//   hasCoupon
//   amount > 100 and not blocked              amount > 100 && !blocked
//   deliveryDate == null
//   lines.size >= 1
//   lines.count(status in (OPEN, HELD)) > 0
//   lines.filter(picked < qty)
//   amount ?? 0
//
// A bare word resolves, in order, to an input, a state field, or a declared enum value (so
// `Web` needs no quotes when some input lists it). Anything else is an error at authoring
// time, not a silent `undefined` at run time.
//
// A list answers `.size`, and is narrowed and measured with the methods below: `filter`, `count`,
// `any`, `all` and `none`, each taking one condition on a record. Inside that condition a bare word
// is a field of the record, so it reads `lines.any(status == OPEN)`.
//
// A field of the same name as an input hides it, which is a thing a reader cannot see. So the
// record can be named — `lines.any(o -> o.qty > qty)` — and then it is reachable only through that
// name: `o.qty` is the line's, a bare `qty` is the input's. Where a name would be read both ways at
// once, `ambiguous()` below says so and the panel shows it, because guessing is the one thing a
// specification must not do.
//
// The older spellings, `list where status == OPEN` and `count(list)`, mean the same and are not
// going anywhere: flows in people's repositories are written in them.

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'null', 'where']);

/**
 * What the language offers, in one place. `check` refuses a call that is not here, the evaluator
 * below is the thing each entry describes, and the "What you can write here" panel is this list
 * rendered — so a function cannot be added to one of the three and forgotten in the others.
 *
 * `form` is how it is written, `takes` what goes in it, `example` a line that would run against a
 * flow with a list input. `insert` is what the panel puts in the box; `…` in it marks where the
 * cursor lands.
 */
export const LIBRARY = [
  { kind: 'method', group: 'Lists', name: 'size', form: 'list.size', insert: '.size', takes: 'nothing',
    what: 'How many records the list holds. `length` says the same thing.', example: 'lines.size == 0' },
  { kind: 'method', group: 'Lists', name: 'length', form: 'list.length', insert: '.length', takes: 'nothing',
    what: 'How many records the list holds. The other name for `size`.', example: 'lines.length >= 3' },
  { kind: 'method', group: 'Lists', name: 'filter', form: 'list.filter(…)', insert: '.filter(…)', takes: 'a condition on one record',
    what: 'The records the condition holds for, as a list. What is left out is gone, so a filter can be set on a state field and read later.', example: 'lines.filter(picked < qty)' },
  { kind: 'method', group: 'Lists', name: 'count', form: 'list.count(…)', insert: '.count(…)', takes: 'a condition, or nothing',
    what: 'How many records match. With nothing in the brackets, how many there are at all.', example: 'lines.count(fragile) > 0' },
  { kind: 'method', group: 'Lists', name: 'any', form: 'list.any(…)', insert: '.any(…)', takes: 'a condition, or nothing',
    what: 'True when at least one record matches. An empty list is false.', example: 'lines.any(status == HELD)' },
  { kind: 'method', group: 'Lists', name: 'all', form: 'list.all(…)', insert: '.all(…)', takes: 'a condition',
    what: 'True when every record matches. An empty list is true: there is none that does not.', example: 'lines.all(inStock)' },
  { kind: 'method', group: 'Lists', name: 'none', form: 'list.none(…)', insert: '.none(…)', takes: 'a condition, or nothing',
    what: 'True when no record matches. The opposite of `any`.', example: 'lines.none(picked == 0)' },
  { kind: 'function', group: 'Lists', name: 'count', form: 'count(list)', insert: 'count(…)', takes: 'a list',
    what: 'How many records the list holds. The older spelling of `list.size`.', example: 'count(lines) == 0' },
  { kind: 'word', group: 'Lists', name: 'where', form: 'list where …', insert: 'where ', takes: 'a condition on one record',
    what: 'The records the condition holds for. The older spelling of `list.filter(…)`, and read the same way.', example: 'lines where picked < qty' },
  { kind: 'word', group: 'Lists', name: '->', form: 'list.filter(o -> o.…)', insert: 'o -> ', takes: 'a name for the record, then a condition',
    what: 'Names the record, and then it is reachable only through that name: `o.qty` is the line\'s, a bare `qty` is the input of that name. Write it where a field and an input are called the same thing; without it a bare word is the field.', example: 'lines.any(o -> o.qty > qty)' },

  { kind: 'operator', group: 'Compare', name: '==', form: 'a == b', insert: '== ', takes: 'two values',
    what: 'The same value. A lone `=` is read as this. Text, numbers and yes/no compare across their spellings: `1` and `"1"` are the same, `yes` and `true` are the same.', example: 'channel == Web' },
  { kind: 'operator', group: 'Compare', name: '!=', form: 'a != b', insert: '!= ', takes: 'two values', what: 'Not the same value.', example: 'status != CANCELLED' },
  { kind: 'operator', group: 'Compare', name: '>', form: 'a > b', insert: '> ', takes: 'two numbers', what: 'Greater than.', example: 'amount > 100' },
  { kind: 'operator', group: 'Compare', name: '>=', form: 'a >= b', insert: '>= ', takes: 'two numbers', what: 'Greater than or the same.', example: 'lines.size >= 193' },
  { kind: 'operator', group: 'Compare', name: '<', form: 'a < b', insert: '< ', takes: 'two numbers', what: 'Less than.', example: 'attempts < 3' },
  { kind: 'operator', group: 'Compare', name: '<=', form: 'a <= b', insert: '<= ', takes: 'two numbers', what: 'Less than or the same.', example: 'daysSinceDelivery <= 30' },
  { kind: 'operator', group: 'Compare', name: 'in', form: 'a in (x, y)', insert: 'in (…)', takes: 'a value, then a list of values',
    what: 'One of these. Brackets or parentheses, whichever reads better; an enum value needs no quotes.', example: 'channel in (Web, App)' },
  { kind: 'operator', group: 'Compare', name: 'not in', form: 'a not in (x, y)', insert: 'not in (…)', takes: 'a value, then a list of values', what: 'None of these.', example: 'status not in (CLOSED, VOID)' },

  { kind: 'operator', group: 'Logic', name: '&&', form: 'a && b', insert: '&& ', takes: 'two conditions', what: 'Both. `and` is the same word.', example: '(paid && !refunded) || manualOverride' },
  { kind: 'operator', group: 'Logic', name: '||', form: 'a || b', insert: '|| ', takes: 'two conditions', what: 'Either. `or` is the same word.', example: 'faulty || damaged' },
  { kind: 'operator', group: 'Logic', name: '!', form: '!a', insert: '!', takes: 'a condition', what: 'Not. `not` is the same word.', example: '!blocked' },
  { kind: 'operator', group: 'Logic', name: 'and', form: 'a and b', insert: 'and ', takes: 'two conditions', what: 'Both. `&&` is the same word.', example: 'amount > 100 and not blocked' },
  { kind: 'operator', group: 'Logic', name: 'or', form: 'a or b', insert: 'or ', takes: 'two conditions', what: 'Either. `||` is the same word.', example: 'hasReceipt or faulty' },
  { kind: 'operator', group: 'Logic', name: 'not', form: 'not a', insert: 'not ', takes: 'a condition', what: 'Not. `!` is the same word.', example: 'not hasCoupon' },
  { kind: 'operator', group: 'Logic', name: '( )', form: '(a || b) && c', insert: '(…)', takes: 'a condition',
    what: 'Groups, so what is inside is worked out first. Without them `a || b && c` reads as `a || (b && c)`.', example: '(faulty || damaged) && hasReceipt' },

  { kind: 'value', group: 'Values', name: 'null', form: 'null', insert: 'null', takes: 'nothing', what: 'Nothing there. An input left blank is null, and so is a state field nothing has set.', example: 'deliveryDate == null' },
  { kind: 'value', group: 'Values', name: 'true', form: 'true', insert: 'true', takes: 'nothing', what: 'Yes. A boolean input set to yes is this.', example: 'hasCoupon == true' },
  { kind: 'value', group: 'Values', name: 'false', form: 'false', insert: 'false', takes: 'nothing', what: 'No.', example: 'blocked == false' },
  { kind: 'operator', group: 'Values', name: '??', form: 'a ?? b', insert: '?? ', takes: 'two values', what: 'The left one, unless it is null, and then the right one.', example: 'discount ?? 0' },
  { kind: 'operator', group: 'Values', name: '+', form: 'a + b', insert: '+ ', takes: 'two numbers', what: 'Added.', example: 'refund + postage' },
  { kind: 'operator', group: 'Values', name: '-', form: 'a - b', insert: '- ', takes: 'two numbers', what: 'Taken away.', example: 'amount - discount' },
  { kind: 'operator', group: 'Values', name: '*', form: 'a * b', insert: '* ', takes: 'two numbers', what: 'Multiplied.', example: 'qty * price' },
  { kind: 'operator', group: 'Values', name: '/', form: 'a / b', insert: '/ ', takes: 'two numbers', what: 'Divided.', example: 'total / lines.size' },
];

/** The list methods, and the free functions, as `check` and the evaluator know them. */
export const METHODS = new Set(LIBRARY.filter((e) => e.kind === 'method').map((e) => e.name));
export const FUNCTIONS = new Set(LIBRARY.filter((e) => e.kind === 'function').map((e) => e.name));
const SIZE = new Set(['size', 'length']);

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  const push = (type, value) => tokens.push({ type, value, at: i });
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?|^[0-9]+/i.exec(src.slice(i));
      push('number', Number(m[0])); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) j++; s += src[j++]; }
      if (j >= src.length) throw error(`unterminated string`, i);
      push('string', s); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
      const word = m[0];
      if (KEYWORDS.has(word)) push('kw', word); else push('name', word);
      i += word.length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||', '??', '->'].includes(two)) { push('op', two); i += 2; continue; }
    // `.` is an operator only where a name did not already swallow it, which is after a `)` or a
    // `]`: `who.role` is one name, `lines.filter(…).size` ends in one of these.
    if ('=<>!+-*/(),[].'.includes(c)) { push('op', c === '=' ? '==' : c); i++; continue; }
    throw error(`unexpected character ${JSON.stringify(c)}`, i);
  }
  push('eof', null);
  return tokens;
}

function error(message, at) {
  const e = new Error(message + (at == null ? '' : ` at ${at}`));
  e.at = at;
  return e;
}

// ---- parser -----------------------------------------------------------------------------------

export function parse(src) {
  const t = tokenize(src);
  let p = 0;
  const peek = () => t[p];
  const next = () => t[p++];
  const isOp = (v) => peek().type === 'op' && peek().value === v;
  const isKw = (v) => peek().type === 'kw' && peek().value === v;
  const expect = (v) => { if (!isOp(v)) throw error(`expected ${v}`, peek().at); next(); };

  // `list where condition`, the loosest binding of all: everything after `where` belongs to it.
  function filtered() {
    let left = or();
    while (isKw('where')) { next(); left = { op: 'where', left, right: or() }; }
    return left;
  }
  function or() {
    let left = and();
    while (isKw('or') || isOp('||')) { next(); left = { op: 'or', left, right: and() }; }
    return left;
  }
  function and() {
    let left = not();
    while (isKw('and') || isOp('&&')) { next(); left = { op: 'and', left, right: not() }; }
    return left;
  }
  function not() {
    if (isKw('not') || isOp('!')) { next(); return { op: 'not', value: not() }; }
    return cmp();
  }
  function cmp() {
    const left = sum();
    if (isKw('in')) { next(); return { op: 'in', left, right: list() }; }
    if (isKw('not')) {
      next();
      if (!isKw('in')) throw error(`expected 'in' after 'not'`, peek().at);
      next(); return { op: 'not', value: { op: 'in', left, right: list() } };
    }
    for (const o of ['==', '!=', '<=', '>=', '<', '>']) {
      if (isOp(o)) { next(); return { op: o, left, right: sum() }; }
    }
    return left;
  }
  function sum() {
    let left = term();
    while (isOp('+') || isOp('-')) { const op = next().value; left = { op, left, right: term() }; }
    return left;
  }
  function term() {
    let left = unary();
    while (isOp('*') || isOp('/')) { const op = next().value; left = { op, left, right: unary() }; }
    return left;
  }
  function unary() {
    if (isOp('-')) { next(); return { op: 'neg', value: unary() }; }
    // `a ?? b`: b when a is null. Binds tightest, so `amount ?? 0 * 2` reads (amount ?? 0) * 2.
    let left = primary();
    while (isOp('??')) { next(); left = { op: '??', left, right: primary() }; }
    return left;
  }
  // A list of values: `[Web, App]` or `(Web, App)`, whichever reads better where it stands.
  function list() {
    const close = isOp('(') ? ')' : ']';
    expect(close === ')' ? '(' : '[');
    const items = [];
    if (!isOp(close)) { items.push(filtered()); while (isOp(',')) { next(); items.push(filtered()); } }
    expect(close);
    return { op: 'list', items };
  }
  /** What goes in the brackets of a call: a condition, or a named one — `o -> o.status == OPEN`. */
  function argument() {
    if (peek().type === 'name' && !peek().value.includes('.') && t[p + 1]?.type === 'op' && t[p + 1].value === '->') {
      const param = next().value; next();
      return { op: 'lambda', param, body: filtered() };
    }
    return filtered();
  }
  function args() {
    const out = [];
    if (!isOp(')')) { out.push(argument()); while (isOp(',')) { next(); out.push(argument()); } }
    expect(')');
    return out;
  }
  /** `.size` and `.filter(…)` after a value. A dotted name is one token, so this is what follows a `)` or a `]`. */
  function after(node) {
    while (isOp('.')) {
      next();
      const tok = next();
      if (tok.type !== 'name' && tok.type !== 'kw') throw error('expected a name after .', tok.at);
      if (isOp('(')) { next(); node = { op: 'method', name: tok.value, recv: node, args: args(), at: tok.at }; }
      else node = { op: 'get', recv: node, name: tok.value, at: tok.at };
    }
    return node;
  }
  function primary() { return after(atom()); }
  function atom() {
    const tok = peek();
    if (tok.type === 'number') { next(); return { op: 'lit', value: tok.value }; }
    if (tok.type === 'string') { next(); return { op: 'lit', value: tok.value }; }
    if (tok.type === 'kw' && ['true', 'false', 'null'].includes(tok.value)) {
      next(); return { op: 'lit', value: tok.value === 'true' ? true : tok.value === 'false' ? false : null };
    }
    // A name with a `(` after it is a call, and a name is one token up to its last dot: `count(x)`
    // is the free function, `lines.filter(…)` is a method on what stands before the dot. A name with
    // nothing after it stays an ordinary name, so a field may be called `count` or `filter`.
    if (tok.type === 'name' && t[p + 1]?.type === 'op' && t[p + 1].value === '(') {
      next(); next();
      const cut = tok.value.lastIndexOf('.');
      if (cut < 0) return { op: 'call', name: tok.value, args: args(), at: tok.at };
      return { op: 'method', name: tok.value.slice(cut + 1), recv: { op: 'name', name: tok.value.slice(0, cut), at: tok.at }, args: args(), at: tok.at };
    }
    if (tok.type === 'name') { next(); return { op: 'name', name: tok.value, at: tok.at }; }
    // `(a)` groups; `(a, b)` is a list, so `status in (OPEN, HELD)` reads as it would in SQL.
    if (isOp('(')) {
      next();
      const first = filtered();
      if (!isOp(',')) { expect(')'); return first; }
      const items = [first];
      while (isOp(',')) { next(); items.push(filtered()); }
      expect(')');
      return { op: 'list', items };
    }
    if (isOp('[')) return list();
    throw error(tok.type === 'eof' ? 'unexpected end of expression' : `unexpected ${JSON.stringify(String(tok.value))}`, tok.at);
  }

  const ast = filtered();
  if (peek().type !== 'eof') throw error(`unexpected ${JSON.stringify(String(peek().value))}`, peek().at);
  return ast;
}

// ---- names ------------------------------------------------------------------------------------

/** Every bare name an expression refers to, in order of first appearance. */
export function names(ast, out = []) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.op === 'name') { if (!out.includes(ast.name)) out.push(ast.name); return out; }
  for (const k of ['left', 'right', 'value', 'recv', 'body']) if (ast[k]) names(ast[k], out);
  for (const each of [ast.items, ast.args]) if (each) for (const it of each) names(it, out);
  return out;
}

// ---- evaluation -------------------------------------------------------------------------------

/**
 * One step into a value. A record's own field is what a dotted name means, and only one it holds
 * itself, so `who.constructor` is nothing rather than a function. A list and a piece of text have
 * no fields, so there `size` (and `length`) is how much of it there is, which is what `lines.size
 * == 0` is asking; nothing at all answers 0, the way `count(null)` does, because how many of
 * nothing there are is none and not a puzzle.
 */
function member(value, key) {
  if (value == null) return SIZE.has(key) ? 0 : undefined;
  // A record's own field comes first, because a parcel may well have a `size` and that is the one
  // `o.size` is asking for; only where the value has no such field of its own does `size` mean how
  // much of it there is.
  const own = typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, key);
  if (own) return value[key];
  if (SIZE.has(key)) return Array.isArray(value) || typeof value === 'string' ? value.length : 0;
  return undefined;
}

/**
 * A scope is what names resolve against:
 *   { inputs: {channel:'Web'}, state: {discount:null}, enums: Set(['Web', ...]) }
 * `inputs` win over `state`, which wins over enum values. Inside a `where` or a method, the record
 * being looked at (`scope.record`) wins over all of them, and a name given to it by `o -> …`
 * (`scope.vars`) wins over that. Dotted names walk into objects.
 */
export function resolve(name, scope) {
  const [head, ...rest] = name.split('.');
  let value;
  if (scope.vars && head in scope.vars) value = scope.vars[head];
  else if (scope.record && typeof scope.record === 'object' && head in scope.record) value = scope.record[head];
  else if (scope.inputs && head in scope.inputs) value = scope.inputs[head];
  else if (scope.state && head in scope.state) value = scope.state[head];
  else if (scope.enums && scope.enums.has(head)) value = head;
  else throw error(`unknown name '${head}'`);
  for (const k of rest) value = member(value, k);
  return value;
}

/**
 * A condition on one record, as the argument of `filter` and its neighbours, in one of two
 * spellings that differ in exactly one way.
 *
 * `status == OPEN` reads the record's fields bare. It is the short way and the usual one, and a
 * bare word there is the field, which means a field hides an input of the same name.
 *
 * `o -> o.status == OPEN` names the record, and then the record is reachable **only** through that
 * name: `o.qty` is the line's, a bare `qty` is the input's. That is what makes the name an escape
 * rather than a decoration — it is how a flow says which `qty` it meant, and the only way to say
 * "the input" where a field is called the same thing.
 */
const predicate = (arg, scope) => (record) => (arg.op === 'lambda'
  ? truthy(evaluate(arg.body, { ...scope, vars: { ...scope.vars, [arg.param]: record } }))
  : truthy(evaluate(arg, { ...scope, record })));

function called(ast, scope) {
  if (ast.name !== 'count') throw error(`unknown function '${ast.name}'`);
  if (ast.args.length !== 1) throw error('count takes one list');
  const v = evaluate(ast.args[0], scope);
  if (v == null) return 0;
  if (!Array.isArray(v)) throw error('count needs a list');
  return v.length;
}

function method(ast, scope) {
  const recv = evaluate(ast.recv, scope);
  if (SIZE.has(ast.name)) return recv == null ? 0 : Array.isArray(recv) || typeof recv === 'string' ? recv.length : 0;
  if (!METHODS.has(ast.name)) throw error(`a list has no '${ast.name}'; it has ${[...METHODS].join(', ')}`);
  if (recv != null && !Array.isArray(recv)) throw error(`${ast.name} needs a list`);
  const all = recv ?? [];
  if (ast.args.length > 1) throw error(`${ast.name} takes one condition`);
  if (!ast.args.length && (ast.name === 'filter' || ast.name === 'all')) throw error(`${ast.name} takes a condition`);
  const kept = ast.args.length ? all.filter(predicate(ast.args[0], scope)) : all;
  switch (ast.name) {
    case 'filter': return kept;
    case 'count': return kept.length;
    case 'any': return kept.length > 0;
    case 'none': return kept.length === 0;
    case 'all': return kept.length === all.length;
    default: throw error(`unknown function '${ast.name}'`);
  }
}

export function evaluate(ast, scope) {
  switch (ast.op) {
    case 'lit': return ast.value;
    case 'name': return resolve(ast.name, scope);
    case 'get': return member(evaluate(ast.recv, scope), ast.name);
    case 'call': return called(ast, scope);
    case 'method': return method(ast, scope);
    case 'lambda': throw error(`'${ast.param} -> …' belongs in the brackets of filter, count, any, all or none`);
    case 'list': return ast.items.map((it) => evaluate(it, scope));
    case 'neg': return -evaluate(ast.value, scope);
    case 'not': return !truthy(evaluate(ast.value, scope));
    case 'and': return truthy(evaluate(ast.left, scope)) ? truthy(evaluate(ast.right, scope)) : false;
    case 'or': return truthy(evaluate(ast.left, scope)) ? true : truthy(evaluate(ast.right, scope));
    case 'in': {
      const v = evaluate(ast.left, scope);
      return evaluate(ast.right, scope).some((x) => same(x, v));
    }
    case 'where': {
      const list = evaluate(ast.left, scope);
      if (list == null) return [];
      if (!Array.isArray(list)) throw error('where needs a list on its left');
      return list.filter((record) => truthy(evaluate(ast.right, { ...scope, record })));
    }
    case '==': return same(evaluate(ast.left, scope), evaluate(ast.right, scope));
    case '!=': return !same(evaluate(ast.left, scope), evaluate(ast.right, scope));
    case '<': return evaluate(ast.left, scope) < evaluate(ast.right, scope);
    case '<=': return evaluate(ast.left, scope) <= evaluate(ast.right, scope);
    case '>': return evaluate(ast.left, scope) > evaluate(ast.right, scope);
    case '>=': return evaluate(ast.left, scope) >= evaluate(ast.right, scope);
    case '??': { const v = evaluate(ast.left, scope); return v == null ? evaluate(ast.right, scope) : v; }
    case '+': return evaluate(ast.left, scope) + evaluate(ast.right, scope);
    case '-': return evaluate(ast.left, scope) - evaluate(ast.right, scope);
    case '*': return evaluate(ast.left, scope) * evaluate(ast.right, scope);
    case '/': return evaluate(ast.left, scope) / evaluate(ast.right, scope);
    default: throw error(`unknown operator ${ast.op}`);
  }
}

export function truthy(v) { return Array.isArray(v) ? v.length > 0 : !(v === false || v == null || v === '' || v === 0 || Number.isNaN(v)); }

/** Loose enough that the spreadsheet's "yes"/"true"/true all agree, strict enough that 1 != "1x". */
export function same(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'boolean' || typeof b === 'boolean') return toBool(a) === toBool(b);
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a), nb = Number(b);
    return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb;
  }
  return String(a) === String(b);
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['true', 'yes', 'y', '1'].includes(v.trim().toLowerCase());
  return truthy(v);
}

// ---- the two calls the rest of the program makes ----------------------------------------------

const cache = new Map();

/** Parse once, keep the tree. Throws on a syntax error. */
export function compile(src) {
  const key = src.trim();
  if (!cache.has(key)) cache.set(key, parse(key));
  return cache.get(key);
}

/** Evaluate a source string in a scope; `''` is "always". */
export function test(src, scope) {
  if (!src || !src.trim()) return true;
  return truthy(evaluate(compile(src), scope));
}

/** The list a name, a `where` or a chain of methods ultimately stands on: `lines` in `lines.filter(…).size`. */
const rootOf = (a) => (a?.op === 'where' ? rootOf(a.left) : a?.op === 'method' || a?.op === 'get' ? rootOf(a.recv) : a?.op === 'name' ? a.name.split('.')[0] : null);

/**
 * Syntax, name and function errors for the editor: [] means the expression is sound against this
 * schema. `lists` maps each list's name to its field names; inside `list.filter(…)` and `list where
 * …` those fields are names too, as is whatever `o -> …` calls the record. A list held in a state
 * field has no declared fields, so there any list's field will do.
 */
export function check(src, known, lists = new Map()) {
  if (!src || !src.trim()) return [];
  let ast;
  try { ast = compile(src); } catch (e) { return [e.message]; }
  const any = new Set([...lists.values()].flatMap((f) => [...f]));
  const bad = [], msgs = [];
  // `fields` are the record fields readable bare here, and `of` the list they belong to, so an
  // unknown word inside `lines.any(…)` is told it is not a field of a lines record rather than
  // that nobody has heard of it. `binds` maps a name given by `o -> …` to the fields that record is
  // known to have, or null where the list was not declared with any.
  const walk = (a, fields, binds, of, named = null) => {
    if (!a || typeof a !== 'object') return;
    switch (a.op) {
      case 'name': {
        const [head, field] = a.name.split('.');
        if (binds.has(head)) {
          const rec = binds.get(head);
          if (rec && field && !rec.fields.has(field)) msgs.push(`a ${rec.list} record has no '${field}'; it has ${[...rec.fields].join(', ')}`);
          return;
        }
        if (!known.has(head) && !fields.has(head) && !bad.some((b) => b.name === head)) bad.push({ name: head, of: of && lists.has(of) ? of : null, named });
        return;
      }
      case 'where': {
        walk(a.left, fields, binds, of, named);
        const list = rootOf(a.left);
        walk(a.right, new Set([...fields, ...(lists.get(list) ?? any)]), binds, lists.has(list) ? list : of);
        return;
      }
      case 'method': {
        walk(a.recv, fields, binds, of);
        if (!METHODS.has(a.name)) msgs.push(`a list has no '${a.name}'; it has ${[...METHODS].join(', ')}`);
        const list = rootOf(a.recv), own = lists.get(list) ?? null;
        const within = own ? list : of;
        for (const arg of a.args) {
          // Naming the record takes the fields out of the bare names: inside `o -> …` the record is
          // `o` and only `o`, which is what lets a bare name there mean the input of that name.
          const rec = own ? { list, fields: own } : null;
          if (arg.op === 'lambda') walk(arg.body, fields, new Map([...binds, [arg.param, rec]]), of, rec && { ...rec, param: arg.param });
          else walk(arg, new Set([...fields, ...(own ?? any)]), binds, within);
        }
        return;
      }
      case 'call':
        if (!FUNCTIONS.has(a.name)) msgs.push(`there is no '${a.name}' function; there is ${[...FUNCTIONS].join(', ')}, and a list has ${[...METHODS].join(', ')}`);
        for (const arg of a.args) walk(arg, fields, binds, of, named);
        return;
      case 'lambda': walk(a.body, fields, new Map([...binds, [a.param, null]]), of, named); return;
      case 'get': walk(a.recv, fields, binds, of, named); return;
      default:
        for (const k of ['left', 'right', 'value']) if (a[k]) walk(a[k], fields, binds, of, named);
        if (a.items) for (const it of a.items) walk(it, fields, binds, of, named);
    }
  };
  walk(ast, new Set(), new Map(), null, null);
  // A field used outside a filter is the commonest slip: say how a list is narrowed.
  const listOf = (n) => [...lists].find(([, fs]) => fs.has(n))?.[0];
  const out = msgs.concat(bad.map(({ name, of, named }) => {
    // Inside `o -> …` the record is `o`, so a field reached bare there is asking for the name it
    // has outside; say how to reach the field instead rather than that nobody declared it.
    if (named?.fields.has(name)) return `'${name}' is a field of a ${named.list} record, and this names that record \`${named.param}\`; write \`${named.param}.${name}\``;
    if (of) return `a ${of} record has no '${name}'; it has ${[...lists.get(of)].join(', ')}`;
    if (listOf(name)) return `'${name}' is a field of a ${listOf(name)} record; narrow a list with filter, as in \`${listOf(name)}.filter(${name} == …)\``;
    return `unknown name '${name}'`;
  }));
  return [...new Set(out)];
}

/**
 * Names that would be read two ways at once: a bare word inside a condition on a record that is
 * both a field of that record and something the flow declares. It runs as the field — a record in
 * scope wins — but a person reading `lines.filter(picked < qty)` cannot tell that from the page,
 * and a specification whose meaning depends on which declaration you happen to remember is not
 * one. So it is said out loud, with the two ways to mean it on purpose.
 *
 * Kept apart from `check` because this is not an expression that cannot run; it is one that can be
 * read two ways. `check` decides whether a thing is an expression at all (an initial value leans on
 * that), and this decides whether it is a clear one.
 */
export function ambiguous(src, known, lists = new Map()) {
  if (!src || !src.trim()) return [];
  let ast;
  try { ast = compile(src); } catch { return []; }   // a syntax error is check's to report, not this
  const found = [];
  const walk = (a, record, named) => {
    if (!a || typeof a !== 'object') return;
    switch (a.op) {
      case 'name': {
        const head = a.name.split('.')[0];
        // Under a name for the record there is no ambiguity left: `o.qty` and `qty` say which.
        if (!named && record && lists.get(record)?.has(head) && known.has(head) && !found.some((f) => f.name === head)) found.push({ name: head, of: record });
        return;
      }
      case 'where': { walk(a.left, record, named); const l = rootOf(a.left); walk(a.right, lists.has(l) ? l : record, null); return; }
      case 'method': {
        walk(a.recv, record, named);
        const l = rootOf(a.recv), within = lists.has(l) ? l : record;
        for (const arg of a.args) (arg.op === 'lambda' ? walk(arg.body, within, arg.param) : walk(arg, within, null));
        return;
      }
      case 'lambda': walk(a.body, record, a.param); return;
      default:
        for (const k of ['left', 'right', 'value', 'recv']) if (a[k]) walk(a[k], record, named);
        for (const each of [a.items, a.args]) if (each) for (const it of each) walk(it, record, named);
    }
  };
  walk(ast, null, null);
  return found.map(({ name, of }) => `'${name}' is both a field of a ${of} record and a name the flow declares; here it reads as the field. Name the record to say which you mean: \`${of}.filter(o -> o.${name} …)\` is the field, \`${of}.filter(o -> ${name} …)\` is the other`);
}
