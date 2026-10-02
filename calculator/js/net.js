// WebRTC signaling + message logic. Pure — no DOM, no RTCPeerConnection —
// unit-testable in node. The browser glue (RTCPeerConnection, DataChannel,
// ICE waiting) lives in main.js and uses these helpers.

import { press, createCalculator, VALID_KEYS } from './calculator.js';

// ---------- join codes: base64url of a JSON envelope {v, type, sdp} ----------

// btoa/atob are latin1-only, so go through UTF-8 bytes (TextEncoder works
// identically in node and browsers).
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(code) {
  if (typeof code !== 'string') return null;
  let b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*$/.test(b64)) return null;
  while (b64.length % 4) b64 += '=';
  let bin;
  try { bin = atob(b64); } catch { return null; }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeCode(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
  const { type, sdp } = env;
  if (type !== 'offer' && type !== 'answer') return null;
  if (typeof sdp !== 'string' || sdp.length === 0) return null;
  return b64urlEncode(JSON.stringify({ v: 1, type, sdp }));
}

// Returns {type, sdp} or null. Never throws.
export function decodeCode(code) {
  const raw = b64urlDecode(code);
  if (raw === null) return null;
  let env;
  try { env = JSON.parse(raw); } catch { return null; }
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
  if (env.v !== 1) return null;
  if (env.type !== 'offer' && env.type !== 'answer') return null;
  if (typeof env.sdp !== 'string' || env.sdp.length === 0) return null;
  return { type: env.type, sdp: env.sdp };
}

// ---------- DataChannel messages ----------

// {t:'hello', id, state:{entry,acc,op,expectEntry}}
// {t:'key', k}
// {t:'ctrl', i, p:[x,y,z], q:[x,y,z,w]}
// {t:'bye'}
export function encodeMsg(msg) {
  return JSON.stringify(msg);
}

function isNumArray(a, len) {
  return Array.isArray(a) && a.length === len && a.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function validState(s) {
  return s && typeof s === 'object' &&
    typeof s.entry === 'string' &&
    (s.acc === null || typeof s.acc === 'number') &&
    (s.op === null || typeof s.op === 'string') &&
    typeof s.expectEntry === 'boolean';
}

// Returns the validated message or null. Never throws.
export function decodeMsg(text) {
  if (typeof text !== 'string') return null;
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  switch (m.t) {
    case 'hello': {
      if (typeof m.id !== 'string') return null;
      if (!validState(m.state)) return null;
      return { t: 'hello', id: m.id, state: m.state };
    }
    case 'key': {
      if (typeof m.k !== 'string' || !VALID_KEYS.has(m.k)) return null;
      return { t: 'key', k: m.k };
    }
    case 'ctrl': {
      if (m.i !== 0 && m.i !== 1) return null;
      if (!isNumArray(m.p, 3)) return null;
      if (!isNumArray(m.q, 4)) return null;
      return { t: 'ctrl', i: m.i, p: m.p, q: m.q };
    }
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

// Apply an incoming hello/state to a panel state (validated shape).
export function applyRemoteState(local, remoteState) {
  return { ...createCalculator(), ...remoteState };
}

// ---------- room codes (4 digits, signaling-relay mode) ----------

export const ROOM_LEN = 4;

export function isValidRoom(code) {
  return typeof code === 'string' && new RegExp(`^\\d{${ROOM_LEN}}$`).test(code);
}

// 4 random digits via crypto.getRandomValues (browser + node).
export function makeRoomCode(rnd = (arr) => crypto.getRandomValues(arr)) {
  const bytes = new Uint8Array(4);
  rnd(bytes);
  let code = '';
  for (const b of bytes) code += (b % 10).toString();
  return code;
}

// ---------- connection phase state machine ----------
//
// Host:  idle --host--> hosting --offer-ready--> showing-offer
//          --answer-pasted--> connecting --open--> connected
// Join:  idle --join--> joining --offer-pasted--> answering
//          --answer-ready--> showing-answer --open--> connected
// Any non-idle state: --close--> idle, --error--> idle

export const PHASES = {
  IDLE: 'idle',
  HOSTING: 'hosting',
  SHOWING_OFFER: 'showing-offer',
  JOINING: 'joining',
  ANSWERING: 'answering',
  SHOWING_ANSWER: 'showing-answer',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
};

const TRANSITIONS = {
  idle: { host: 'hosting', join: 'joining' },
  hosting: { 'offer-ready': 'showing-offer' },
  'showing-offer': { 'answer-pasted': 'connecting' },
  joining: { 'offer-pasted': 'answering' },
  answering: { 'answer-ready': 'showing-answer' },
  'showing-answer': { open: 'connected' },
  connecting: { open: 'connected' },
  connected: {},
};

// Returns the next phase, or null for an invalid transition.
export function nextPhase(current, event) {
  if (!TRANSITIONS[current]) return null;
  if (event === 'close' || event === 'error') {
    return current === 'idle' ? null : 'idle';
  }
  return TRANSITIONS[current][event] ?? null;
}
