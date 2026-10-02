// VR Calculator — 2 player, shared across headsets via WebRTC (no server).
// Local logic: js/calculator.js (pure). Signaling/message logic: js/net.js (pure).
// Left panel = YOU. Right panel = FRIEND (mirrors the peer; locally clickable
// only in solo mode). Desktop mouse works on your panel (and both in solo).

import * as THREE from 'three';
import { VRButton } from '../vendor/VRButton.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { press, createCalculator } from './calculator.js';
import { encodeCode, decodeCode, encodeMsg, decodeMsg, nextPhase, PHASES, applyRemoteState, isValidRoom, makeRoomCode } from './net.js';
import { RELAY_URL } from './config.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a14);
scene.fog = new THREE.Fog(0x070a14, 6, 14);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.6, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(0.5, 3, 2);
scene.add(dir);

const grid = new THREE.GridHelper(30, 60, 0x2a3350, 0x141a2e);
scene.add(grid);

// ---------- calculator panels ----------
const KEY_ROWS = [
  [{ t: 'AC', k: 'AC' }, { t: '±', k: '±' }, { t: '%', k: '%' }, { t: '÷', k: '/' }],
  [{ t: '7', k: '7' }, { t: '8', k: '8' }, { t: '9', k: '9' }, { t: '×', k: '*' }],
  [{ t: '4', k: '4' }, { t: '5', k: '5' }, { t: '6', k: '6' }, { t: '−', k: '-' }],
  [{ t: '1', k: '1' }, { t: '2', k: '2' }, { t: '3', k: '3' }, { t: '+', k: '+' }],
  [{ t: '⌫', k: '⌫' }, { t: '.', k: '.' }, { t: '0', k: '0' }, { t: '=', k: '=' }],
];
const OP_GLYPH = { '+': '+', '-': '−', '*': '×', '/': '÷' };

function textTexture(text, { w = 256, h = 128, font = 'bold 72px "SF Mono", Menlo, monospace', color = '#eaf2ff', bg = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function makePanel({ id, label, accent, x, yaw, remote }) {
  const group = new THREE.Group();
  group.position.set(x, 1.35, -1.5);
  group.rotation.y = yaw;
  scene.add(group);

  const bezel = new THREE.Mesh(
    new RoundedBoxGeometry(1.0, 0.82, 0.04, 3, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x161d33, roughness: 0.5, metalness: 0.25 })
  );
  group.add(bezel);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.015, 0.045),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.3, emissive: accent, emissiveIntensity: 0.35 })
  );
  trim.position.y = 0.4075;
  group.add(trim);

  const labelMat = new THREE.MeshBasicMaterial({ transparent: true });
  labelMat.map = textTexture(label, { w: 512, h: 128, font: 'bold 72px "SF Mono", Menlo, monospace', color: '#' + accent.toString(16).padStart(6, '0') });
  const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.11), labelMat);
  labelMesh.position.set(0, 0.52, 0.005);
  group.add(labelMesh);

  // status dot: red = solo/offline, green = connected
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff4444, emissiveIntensity: 0.8 })
  );
  dot.position.set(0.44, 0.52, 0.005);
  group.add(dot);

  // display
  const dc = document.createElement('canvas');
  dc.width = 1024; dc.height = 256;
  const dctx = dc.getContext('2d');
  const dtex = new THREE.CanvasTexture(dc);
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.23),
    new THREE.MeshBasicMaterial({ map: dtex })
  );
  display.position.set(0, 0.265, 0.023);
  group.add(display);

  const panel = {
    id, accent, group, remote, state: createCalculator(),
    buttons: [], keyToButton: new Map(),
    setLabel(text) {
      const old = labelMat.map;
      labelMat.map = textTexture(text, { w: 512, h: 128, font: 'bold 72px "SF Mono", Menlo, monospace', color: '#' + accent.toString(16).padStart(6, '0') });
      labelMat.needsUpdate = true;
      if (old) old.dispose();
    },
    setOnline(on) {
      const m = dot.material;
      m.color.setHex(on ? 0x3dff8a : 0xff4444);
      m.emissive.setHex(on ? 0x3dff8a : 0xff4444);
    },
    updateDisplay() {
      dctx.fillStyle = '#0a0f1e';
      dctx.fillRect(0, 0, 1024, 256);
      const s = panel.state;
      if (s.acc !== null && s.op) {
        dctx.fillStyle = '#5f6f96';
        dctx.font = '44px "SF Mono", Menlo, monospace';
        dctx.textAlign = 'left';
        dctx.textBaseline = 'top';
        dctx.fillText(`${s.acc} ${OP_GLYPH[s.op]}`, 24, 20);
      }
      const text = s.entry;
      dctx.fillStyle = text === 'Error' ? '#ff5d5d' : '#f2f7ff';
      let size = 110;
      dctx.font = `bold ${size}px "SF Mono", Menlo, monospace`;
      while (dctx.measureText(text).width > 980 && size > 40) {
        size -= 6;
        dctx.font = `bold ${size}px "SF Mono", Menlo, monospace`;
      }
      dctx.textAlign = 'right';
      dctx.textBaseline = 'middle';
      dctx.fillText(text, 1000, 140);
      dtex.needsUpdate = true;
    },
  };

  const btnGeo = new THREE.BoxGeometry(0.17, 0.08, 0.025);
  KEY_ROWS.forEach((row, r) => {
    row.forEach(({ t, k }, c) => {
      const isOp = '*/-+'.includes(k);
      const mat = new THREE.MeshStandardMaterial({
        color: k === 'AC' ? 0x3a2a3f : isOp ? 0x24345e : 0x1d2540,
        roughness: 0.45, metalness: 0.2,
        emissive: 0x000000,
      });
      const b = new THREE.Mesh(btnGeo, mat);
      b.position.set((c - 1.5) * 0.23, 0.075 - r * 0.105, 0.028);
      b.userData = { key: k, panel, pressT: -1 };
      const lbl = new THREE.Mesh(
        new THREE.PlaneGeometry(0.14, 0.068),
        new THREE.MeshBasicMaterial({ map: textTexture(t, { w: 256, h: 128, font: 'bold 84px "SF Mono", Menlo, monospace', color: isOp ? '#9fc4ff' : '#e8eeff' }), transparent: true })
      );
      lbl.position.z = 0.014;
      b.add(lbl);
      group.add(b);
      panel.buttons.push(b);
      panel.keyToButton.set(k, b);
    });
  });

  panel.updateDisplay();
  return panel;
}

const YOU = makePanel({ id: 'you', label: 'YOU', accent: 0x38e8ff, x: -0.95, yaw: 0.16, remote: false });
const THEM = makePanel({ id: 'them', label: 'PLAYER 2', accent: 0xffb13d, x: 0.95, yaw: -0.16, remote: true });

// ---------- WebRTC (glue; pure logic in net.js) ----------
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let pc = null, dc = null;
let phase = PHASES.IDLE;
let connected = false;
let lastCtrlSent = 0;

const $ = (id) => document.getElementById(id);
const statusEl = $('lobby-status');
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#ff8a8a' : '#8fd3ff';
}

function waitIceGathering(p, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (p.iceGatheringState === 'completed') return resolve();
    const to = setTimeout(resolve, timeoutMs);
    p.addEventListener('icegatheringstatechange', () => {
      if (p.iceGatheringState === 'completed') { clearTimeout(to); resolve(); }
    });
  });
}

function phaseEvent(e) {
  const n = nextPhase(phase, e);
  if (n !== null) phase = n;
  return n;
}

function localButtons() {
  return connected ? YOU.buttons : [...YOU.buttons, ...THEM.buttons];
}

// ---------- WebRTC core (shared by both join flows) ----------

function relayAvailable() {
  return typeof RELAY_URL === 'string' && RELAY_URL.length > 0;
}

function newPc() {
  pc = new RTCPeerConnection(ICE_CONFIG);
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'failed') onDisconnected();
  });
}

// Host side: create the local offer. Returns the SDP.
async function createLocalOffer() {
  newPc();
  dc = pc.createDataChannel('game', { ordered: true });
  wireDataChannel(dc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceGathering(pc);
  return pc.localDescription.sdp;
}

// Join side: create the answer for a received offer. Returns the SDP.
async function createAnswerFromOffer(offerSdp) {
  newPc();
  pc.ondatachannel = (e) => wireDataChannel(e.channel);
  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceGathering(pc);
  return pc.localDescription.sdp;
}

// Host side: apply the friend's answer; connection opens via dc.onopen.
async function applyAnswerSdp(answerSdp) {
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  phaseEvent('answer-pasted');
  setStatus('Connecting…');
}

// ---------- flow 1: 4-digit rooms via the relay Worker ----------

let pollTimer = null;
let roomCode = null;

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

async function relayPost(room, role, sdp) {
  const r = await fetch(`${RELAY_URL}/room/${room}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, sdp }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || ('relay HTTP ' + r.status));
}

function pollRoom(room, want, onValue, onTimeout, timeoutMs = 120000) {
  stopPolling();
  const t0 = Date.now();
  const tick = async () => {
    let data = null;
    try {
      const r = await fetch(`${RELAY_URL}/room/${room}`);
      data = await r.json();
    } catch { /* transient network blip — keep polling */ }
    if (data && data[want]) return onValue(data[want]);
    if (Date.now() - t0 > timeoutMs) { stopPolling(); return onTimeout(); }
    pollTimer = setTimeout(tick, 1500);
  };
  pollTimer = setTimeout(tick, 700);
}

async function relayHost() {
  if (phase !== PHASES.IDLE) return;
  phaseEvent('host');
  roomCode = makeRoomCode();
  $('room-code').textContent = roomCode;
  try {
    const sdp = await createLocalOffer();
    await relayPost(roomCode, 'offer', sdp);
    phaseEvent('offer-ready');
    setStatus(`Room ${roomCode} is open — waiting for your friend…`);
    pollRoom(
      roomCode, 'answer',
      (answerSdp) => applyAnswerSdp(answerSdp).catch((err) => { teardownNet(); showModes(); setStatus('Connection failed: ' + err.message, true); }),
      () => { teardownNet(); showModes(); setStatus('Timed out waiting for your friend. Try again.', true); },
    );
  } catch (err) {
    teardownNet(); showModes();
    setStatus('Host failed: ' + err.message, true);
  }
}

async function relayJoin() {
  const room = $('room-input').value.trim();
  if (!isValidRoom(room)) return setStatus('Room code is 4 digits (e.g. 4721).', true);
  if (phase !== PHASES.IDLE) return;
  phaseEvent('join');
  setStatus(`Joining room ${room}…`);
  pollRoom(
    room, 'offer',
    async (offerSdp) => {
      try {
        const sdp = await createAnswerFromOffer(offerSdp);
        await relayPost(room, 'answer', sdp);
        phaseEvent('offer-pasted');
        phaseEvent('answer-ready');
        setStatus('Answer sent — connecting…');
      } catch (err) {
        teardownNet(); showModes();
        setStatus('Join failed: ' + err.message, true);
      }
    },
    () => { teardownNet(); showModes(); setStatus(`No host in room ${room}. Check the code with your friend.`, true); },
  );
}

// ---------- flow 2: copy-paste codes (no relay needed) ----------

async function pasteHost() {
  if (phase !== PHASES.IDLE) return;
  phaseEvent('host');
  try {
    const sdp = await createLocalOffer();
    $('host-code').value = encodeCode({ type: 'offer', sdp });
    phaseEvent('offer-ready');
    setStatus('Send the code above to your friend, then paste their answer below.');
  } catch (err) {
    teardownNet();
    setStatus('WebRTC failed to start: ' + err.message, true);
  }
}

async function pasteAnswer(code) {
  if (phase !== PHASES.SHOWING_OFFER) return;
  const dec = decodeCode(code);
  if (!dec || dec.type !== 'answer') return setStatus('Invalid code — check you pasted the full answer code.', true);
  try {
    await applyAnswerSdp(dec.sdp);
  } catch (err) {
    teardownNet();
    setStatus('Connection failed: ' + err.message, true);
  }
}

async function pasteJoin(code) {
  if (phase !== PHASES.IDLE) return;
  const dec = decodeCode(code);
  if (!dec || dec.type !== 'offer') return setStatus('Invalid code — check you pasted the full host code.', true);
  phaseEvent('join');
  setStatus('Creating your code…');
  try {
    const sdp = await createAnswerFromOffer(dec.sdp);
    $('join-code').value = encodeCode({ type: 'answer', sdp });
    $('join-code').hidden = false;
    $('join-code-label').hidden = false;
    phaseEvent('offer-pasted');
    phaseEvent('answer-ready');
    setStatus('Send the code above back to the host.');
  } catch (err) {
    teardownNet();
    setStatus('Join failed: ' + err.message, true);
  }
}

// Intro copy depends on which join flow is active.
{
  const sub = document.querySelector('#lobby .sub');
  if (sub) {
    sub.textContent = relayAvailable()
      ? 'Two headsets, one session — peer-to-peer over WebRTC. Host a game and share the 4-digit room code, your friend types it in. Or play solo. On desktop, clicking works.'
      : 'Two headsets, one session — peer-to-peer over WebRTC (no server). Host a code, send it to your friend, they paste it and send one back. Or play solo. On desktop, clicking works.';
  }
}

// Lobby entry points: relay mode when configured, copy-paste otherwise.
function startHost() { relayAvailable() ? relayHost() : pasteHost(); }
function startJoinView() {
  $('relay-join-box').hidden = !relayAvailable();
  $('paste-join-box').hidden = relayAvailable();
}

function wireDataChannel(channel) {
  channel.onopen = onConnected;
  channel.onclose = onDisconnected;
  channel.onmessage = (e) => {
    const m = decodeMsg(e.data);
    if (!m) return; // hostile/malformed — ignore
    switch (m.t) {
      case 'hello':
        THEM.state = applyRemoteState(THEM.state, m.state);
        THEM.updateDisplay();
        break;
      case 'key':
        remotePress(m.k);
        break;
      case 'ctrl':
        setFriendController(m.i, m.p, m.q);
        break;
      case 'bye':
        onDisconnected();
        break;
    }
  };
}

function sendMsg(obj) {
  if (dc && dc.readyState === 'open') {
    try { dc.send(encodeMsg(obj)); } catch { /* channel closing */ }
  }
}

function onConnected() {
  connected = true;
  phaseEvent('open');
  THEM.setOnline(true);
  THEM.setLabel('FRIEND');
  $('lobby').style.display = 'none';
  sendMsg({ t: 'hello', id: 'you', state: YOU.state });
  hapticAll(0.6);
}

function teardownNet() {
  connected = false;
  phase = PHASES.IDLE;
  try { if (dc) dc.close(); } catch { /* already closed */ }
  try { if (pc) pc.close(); } catch { /* already closed */ }
  dc = null; pc = null;
  friendRays.forEach((r) => { r.visible = false; r.tip.visible = false; });
}

function showModes() {
  stopPolling();
  roomCode = null;
  $('lobby-modes').hidden = false;
  $('host-view').hidden = true;
  $('join-view').hidden = true;
  $('host-code').value = '';
  $('answer-input').value = '';
  $('offer-input').value = '';
  $('join-code').value = '';
  $('join-code').hidden = true;
  $('join-code-label').hidden = true;
  $('room-code').textContent = '';
  $('room-input').value = '';
  setStatus('');
}

function cancelNet() {
  teardownNet();
  showModes();
  setStatus('Cancelled.');
}

function onDisconnected() {
  if (!connected && !pc) return;
  connected = false;
  phase = PHASES.IDLE;
  THEM.setOnline(false);
  THEM.setLabel('PLAYER 2');
  THEM.state = createCalculator();
  THEM.updateDisplay();
  teardownNet();
  $('lobby').style.display = '';
  showModes();
  setStatus('Disconnected. Host or join again.');
}

// ---------- friend controller presence ----------
const friendRays = [];
{
  const mat = new THREE.LineBasicMaterial({ color: 0xffb13d, transparent: true, opacity: 0.85 });
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.4)]);
  for (let i = 0; i < 2; i++) {
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb13d })
    );
    tip.visible = false;
    scene.add(line);
    scene.add(tip);
    friendRays.push({ line, tip });
  }
}

function setFriendController(i, p, q) {
  const f = friendRays[i];
  if (!f) return;
  f.line.visible = true;
  f.tip.visible = true;
  f.line.position.set(p[0], p[1], p[2]);
  f.line.quaternion.set(q[0], q[1], q[2], q[3]);
  f.tip.position.set(p[0], p[1], p[2]);
}

function sendControllerPoses(now) {
  if (!connected || now - lastCtrlSent < 66) return;
  lastCtrlSent = now;
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  controllers.forEach((c, i) => {
    c.getWorldPosition(v);
    c.getWorldQuaternion(q);
    sendMsg({
      t: 'ctrl', i,
      p: [v.x, v.y, v.z].map((n) => +n.toFixed(4)),
      q: [q.x, q.y, q.z, q.w].map((n) => +n.toFixed(4)),
    });
  });
}

// ---------- input: controllers (VR) ----------
const raycaster = new THREE.Raycaster();
const tmpMat = new THREE.Matrix4();

function raycastFrom(originObj) {
  tmpMat.identity().extractRotation(originObj.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(originObj.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
  return raycaster.intersectObjects(localButtons(), false);
}

function haptic(inputSource, strength = 0.5) {
  try { inputSource?.gamepad?.hapticActuators?.[0]?.pulse(strength, 45); } catch { /* not all devices */ }
}

function hapticAll(strength) {
  const session = renderer.xr.getSession?.();
  if (session) for (const src of session.inputSources) haptic(src, strength);
}

function pressLocal(btn) {
  const p = btn.userData.panel;
  p.state = press(p.state, btn.userData.key);
  p.updateDisplay();
  btn.userData.pressT = performance.now();
  if (p === YOU) sendMsg({ t: 'key', k: btn.userData.key });
}

function remotePress(key) {
  const btn = THEM.keyToButton.get(key);
  if (!btn) return;
  THEM.state = press(THEM.state, key);
  THEM.updateDisplay();
  btn.userData.pressT = performance.now();
}

const controllers = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  c.addEventListener('selectstart', (e) => {
    const hits = raycastFrom(c);
    if (hits.length) {
      pressLocal(hits[0].object);
      haptic(e.data?.inputSource);
    }
  });
  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]),
    new THREE.LineBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.7 })
  );
  ray.visible = false; // only in VR
  c.add(ray);
  scene.add(c);
  controllers.push(c);
}

// ---------- input: mouse (desktop preview) ----------
const mouse = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(localButtons(), false);
  if (hits.length) pressLocal(hits[0].object);
});

// ---------- lobby wiring ----------
function showHostView() {
  $('lobby-modes').hidden = true;
  $('join-view').hidden = true;
  $('host-view').hidden = false;
  $('relay-host-box').hidden = !relayAvailable();
  $('paste-host-box').hidden = relayAvailable();
}

$('btn-host').addEventListener('click', () => { showHostView(); startHost(); });
$('btn-join').addEventListener('click', () => {
  $('lobby-modes').hidden = true;
  $('host-view').hidden = true;
  $('join-view').hidden = false;
  startJoinView();
});
$('btn-solo').addEventListener('click', () => {
  $('lobby').style.display = 'none';
});
$('btn-relay-join').addEventListener('click', relayJoin);
$('btn-make-answer').addEventListener('click', () => pasteJoin($('offer-input').value));
$('btn-paste-answer').addEventListener('click', () => pasteAnswer($('answer-input').value));
$('btn-cancel-host').addEventListener('click', cancelNet);
$('btn-cancel-join').addEventListener('click', cancelNet);
// Escapes into copy-paste mode when the relay is configured.
$('paste-toggle-host').addEventListener('click', () => {
  $('relay-host-box').hidden = true;
  $('paste-host-box').hidden = false;
  pasteHost();
});
$('paste-toggle-join').addEventListener('click', () => {
  $('relay-join-box').hidden = true;
  $('paste-join-box').hidden = false;
});

// ---------- hover + render loop ----------
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const presenting = renderer.xr.isPresenting;
  for (const c of controllers) c.children[0].visible = presenting;

  const hover = new Set();
  if (presenting) {
    for (const c of controllers) {
      const hits = raycastFrom(c);
      if (hits.length) hover.add(hits[0].object);
    }
  }
  for (const b of [...YOU.buttons, ...THEM.buttons]) {
    const p = b.userData.panel;
    b.material.emissive.setHex(hover.has(b) ? p.accent : 0x000000);
    b.material.emissiveIntensity = hover.has(b) ? 0.28 : 0;
    const dt = now - b.userData.pressT;
    b.scale.z = dt < 120 ? 1.45 : 1.0;
  }
  sendControllerPoses(now);
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug/test handle (also used by the headless browser checks).
window.__vrCalc = {
  panels: [YOU, THEM], camera, renderer,
  api: {
    host: startHost, relayHost, relayJoin, pasteHost, pasteJoin, pasteAnswer,
    solo: () => { $('lobby').style.display = 'none'; },
    status: () => ({ phase, connected, room: roomCode, you: { ...YOU.state }, friend: { ...THEM.state } }),
  },
  screenPos(btn) {
    const v = new THREE.Vector3();
    btn.getWorldPosition(v);
    v.project(camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, z: v.z };
  },
};
