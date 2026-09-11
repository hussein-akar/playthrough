// The condition language. Small on purpose: a guard on an edge reads like the sentence a
// designer would have written in the spreadsheet, and every name in it is checked against the
// flow's declared inputs and state before anything runs.
//
//   type in [Subscription, Preorder, Wholesale]
//   isExpress
//   amount > 100 and not blocked
//   deliveryDate == null
//
// A bare word resolves, in order, to an input, a state field, or a declared enum value (so
// `Subscription` needs no quotes when some input lists it). Anything else is an error at authoring
// time, not a silent `undefined` at run time.

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'null']);

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
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { push('op', two); i += 2; continue; }
    if ('=<>!+-*/(),[]'.includes(c)) { push('op', c === '=' ? '==' : c); i++; continue; }
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
    return primary();
  }
  function list() {
    expect('[');
    const items = [];
    if (!isOp(']')) { items.push(or()); while (isOp(',')) { next(); items.push(or()); } }
    expect(']');
    return { op: 'list', items };
  }
  function primary() {
    const tok = peek();
    if (tok.type === 'number') { next(); return { op: 'lit', value: tok.value }; }
    if (tok.type === 'string') { next(); return { op: 'lit', value: tok.value }; }
    if (tok.type === 'kw' && ['true', 'false', 'null'].includes(tok.value)) {
      next(); return { op: 'lit', value: tok.value === 'true' ? true : tok.value === 'false' ? false : null };
    }
    if (tok.type === 'name') { next(); return { op: 'name', name: tok.value, at: tok.at }; }
    if (isOp('(')) { next(); const e = or(); expect(')'); return e; }
    if (isOp('[')) return list();
    throw error(tok.type === 'eof' ? 'unexpected end of expression' : `unexpected ${JSON.stringify(String(tok.value))}`, tok.at);
  }

  const ast = or();
  if (peek().type !== 'eof') throw error(`unexpected ${JSON.stringify(String(peek().value))}`, peek().at);
  return ast;
}

// ---- names ------------------------------------------------------------------------------------

/** Every bare name an expression refers to, in order of first appearance. */
export function names(ast, out = []) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.op === 'name') { if (!out.includes(ast.name)) out.push(ast.name); return out; }
  for (const k of ['left', 'right', 'value']) if (ast[k]) names(ast[k], out);
  if (ast.items) for (const it of ast.items) names(it, out);
  return out;
}

// ---- evaluation -------------------------------------------------------------------------------

/**
 * A scope is what names resolve against:
 *   { inputs: {type:'Subscription'}, state: {deliveryDate:null}, enums: Set(['Subscription', ...]) }
 * `inputs` win over `state`, which wins over enum values. Dotted names walk into objects.
 */
export function resolve(name, scope) {
  const [head, ...rest] = name.split('.');
  let value;
  if (scope.inputs && head in scope.inputs) value = scope.inputs[head];
  else if (scope.state && head in scope.state) value = scope.state[head];
  else if (scope.enums && scope.enums.has(head)) value = head;
  else throw error(`unknown name '${head}'`);
  for (const k of rest) value = value == null ? undefined : value[k];
  return value;
}

export function evaluate(ast, scope) {
  switch (ast.op) {
    case 'lit': return ast.value;
    case 'name': return resolve(ast.name, scope);
    case 'list': return ast.items.map((it) => evaluate(it, scope));
    case 'neg': return -evaluate(ast.value, scope);
    case 'not': return !truthy(evaluate(ast.value, scope));
    case 'and': return truthy(evaluate(ast.left, scope)) ? truthy(evaluate(ast.right, scope)) : false;
    case 'or': return truthy(evaluate(ast.left, scope)) ? true : truthy(evaluate(ast.right, scope));
    case 'in': {
      const v = evaluate(ast.left, scope);
      return evaluate(ast.right, scope).some((x) => same(x, v));
    }
    case '==': return same(evaluate(ast.left, scope), evaluate(ast.right, scope));
    case '!=': return !same(evaluate(ast.left, scope), evaluate(ast.right, scope));
    case '<': return evaluate(ast.left, scope) < evaluate(ast.right, scope);
    case '<=': return evaluate(ast.left, scope) <= evaluate(ast.right, scope);
    case '>': return evaluate(ast.left, scope) > evaluate(ast.right, scope);
    case '>=': return evaluate(ast.left, scope) >= evaluate(ast.right, scope);
    case '+': return evaluate(ast.left, scope) + evaluate(ast.right, scope);
    case '-': return evaluate(ast.left, scope) - evaluate(ast.right, scope);
    case '*': return evaluate(ast.left, scope) * evaluate(ast.right, scope);
    case '/': return evaluate(ast.left, scope) / evaluate(ast.right, scope);
    default: throw error(`unknown operator ${ast.op}`);
  }
}

function truthy(v) { return !(v === false || v == null || v === '' || v === 0 || Number.isNaN(v)); }

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

/** Syntax and name errors for the editor: [] means the expression is sound against this schema. */
export function check(src, known) {
  if (!src || !src.trim()) return [];
  let ast;
  try { ast = compile(src); } catch (e) { return [e.message]; }
  return names(ast)
    .map((n) => n.split('.')[0])
    .filter((n) => !known.has(n))
    .map((n) => `unknown name '${n}'`);
}
