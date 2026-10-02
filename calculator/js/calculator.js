// Pure calculator core. No DOM, no THREE — unit-testable in node.
// Keys (strings): '0'-'9', '.', '+', '-', '*', '/', '=', 'AC', '±', '%', '⌫'
// Anything else is a no-op (returns an unchanged copy).

export const MAX_DIGITS = 12;
export const ERROR = 'Error';

export const VALID_KEYS = new Set([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.',
  '+', '-', '*', '/', '=', 'AC', '±', '%', '⌫',
]);

export function createCalculator() {
  return { entry: '0', acc: null, op: null, expectEntry: true };
}

function isDigit(k) { return k !== null && k !== undefined && /^[0-9]$/.test(k); }

function toNumber(s) {
  if (s === ERROR) return NaN;
  return parseFloat(s);
}

function applyOp(a, op, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? NaN : a / b;
    default: return NaN;
  }
}

function format(n) {
  if (!Number.isFinite(n)) return ERROR;
  const rounded = parseFloat(n.toPrecision(12)); // kill float noise (0.1+0.2)
  if (Math.abs(rounded) >= 1e12 || (Math.abs(rounded) < 1e-9 && rounded !== 0)) {
    return rounded.toExponential(6).replace(/\.?0+e/, 'e');
  }
  return String(rounded);
}

function negate(s) {
  if (s === ERROR || s === '0' || s === '0.') return s;
  return s.startsWith('-') ? s.slice(1) : '-' + s;
}

function countDigits(s) { return s.replace(/[^0-9]/g, '').length; }

// Returns a NEW state; never mutates input.
export function press(state, key) {
  const s = { ...state };

  // Hostile input: not a string, or a key we don't know → no-op.
  if (typeof key !== 'string' || !VALID_KEYS.has(key)) return state;

  // Any key after an error: only AC clears; digits also restart.
  if (s.entry === ERROR) {
    if (key === 'AC') return createCalculator();
    if (isDigit(key)) { s.entry = key; s.expectEntry = false; s.acc = null; s.op = null; return s; }
    return state;
  }

  switch (key) {
    case 'AC':
      return createCalculator();

    case '±':
      s.entry = negate(s.entry);
      return s;

    case '%':
      s.entry = format(toNumber(s.entry) / 100);
      return s;

    case '⌫':
      if (s.expectEntry) return state;
      s.entry = s.entry.length > 1 ? s.entry.slice(0, -1) : '0';
      if (s.entry === '-' || s.entry === '') s.entry = '0';
      return s;

    case '.':
      if (s.expectEntry) { s.entry = '0.'; s.expectEntry = false; return s; }
      if (!s.entry.includes('.')) s.entry += '.';
      return s;

    case '+': case '-': case '*': case '/': {
      const cur = toNumber(s.entry);
      if (s.op !== null && s.acc !== null && !s.expectEntry) {
        s.entry = format(applyOp(s.acc, s.op, cur));
        s.acc = toNumber(s.entry);
      } else if (s.acc === null || s.expectEntry) {
        s.acc = cur;
        s.entry = format(cur);
      }
      s.op = key;
      s.expectEntry = true;
      return s;
    }

    case '=': {
      if (s.op !== null && s.acc !== null) {
        s.entry = format(applyOp(s.acc, s.op, toNumber(s.entry)));
        s.acc = null;
        s.op = null;
      }
      s.expectEntry = true;
      return s;
    }

    default:
      if (isDigit(key)) {
        if (s.expectEntry) {
          s.entry = key;
          s.expectEntry = false;
        } else if (s.entry === '0' || s.entry === '-0') {
          s.entry = (s.entry === '-0' ? '-' : '') + key;
        } else if (countDigits(s.entry) < MAX_DIGITS) {
          s.entry += key;
        }
      }
      return s;
  }
}
