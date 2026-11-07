import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { InputController } from './InputController.js';
import { Level0 } from './Level0.js';
import { Level94 } from './Level94.js';
import { LevelExclamation } from './LevelExclamation.js';
import { io } from 'socket.io-client';
import './style.css';

const canvas = document.querySelector('#game-canvas');
const experience = document.querySelector('#experience');
const startScreen = document.querySelector('#start-screen');
const enterButton = document.querySelector('#enter-button');
const touchInteractButton = document.querySelector('#touch-interact');
const roomCodeInput = document.querySelector('#room-code');
const stateLabel = document.querySelector('#state-label');
const positionLabel = document.querySelector('#position-label');
const transitionScreen = document.querySelector('#vhs-transition');
const transitionMessage = document.querySelector('#vhs-message');
const runResultScreen = document.querySelector('#run-result');
const runResultKicker = document.querySelector('#run-result-kicker');
const runResultTitle = document.querySelector('#run-result-title');
const restartButton = document.querySelector('#restart-button');

const scene = new THREE.Scene();
const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const camera = new THREE.PerspectiveCamera(76, 1, 0.08, 240);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = false;
renderer.shadowMap.autoUpdate = false;

const touchFirstDevice = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
let level0 = new Level0(scene, { pointLightCount: touchFirstDevice ? 2 : 4 });
let level94 = null;
let levelExclamation = null;
let activeLevel = 'level0';
let transitionBusy = false;
let endingAlarmStopped = false;

const controls = new PointerLockControls(camera, renderer.domElement);
controls.pointerSpeed = 0.75;
camera.position.set(level0.spawn.x, level0.playerGroundY, level0.spawn.z);
scene.add(controls.object);

const devIndicator = document.createElement('div');
devIndicator.textContent = 'DEVELOPER MODE  ·  P TO EXIT  ·  SPACE / SHIFT TO FLY';
devIndicator.style.cssText = 'position:absolute;z-index:5;top:92px;left:4.1vw;display:none;padding:9px 12px;border:1px solid rgba(135,208,168,.45);background:rgba(7,22,17,.72);color:#a4e4bd;font:10px monospace;letter-spacing:.08em;pointer-events:none;';
experience.append(devIndicator);

const input = new InputController(controls, camera, renderer.domElement, 4.2, (enabled) => {
  devIndicator.style.display = enabled ? 'block' : 'none';
  stateLabel.textContent = enabled ? 'DEVELOPER MODE' : getLevelLabel();
  experience.classList.toggle('is-dev-mode', enabled);
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, input.isMobile ? 1 : 1.5));
const clock = new THREE.Clock();
const previousPlayerPosition = new THREE.Vector3();
let networkSendAccumulator = 0;

// Prefer Vercel's configured tunnel URL. Socket.IO will use HTTPS polling and
// upgrade to WSS when the tunnel supports it.
const socketUrl = import.meta.env.VITE_SOCKET_URL?.trim() || 'https://9ae95c2410903153-31-223-92-198.serveousercontent.com';
const socket = io(socketUrl, {
  autoConnect: false,
  reconnection: true,
  transports: ['polling', 'websocket'],
  upgrade: true,
  timeout: 10000,
});
const initialRoom = new URLSearchParams(window.location.search).get('room') || 'lobby';
let currentRoomId = initialRoom.slice(0, 32);
let roomJoinRequested = false;
let roomJoined = false;
roomCodeInput.value = currentRoomId;

const remotePlayers = new Map();
const remoteAvatarGeometry = {
  torso: new THREE.BoxGeometry(0.78, 1.02, 0.44),
  head: new THREE.SphereGeometry(0.28, 12, 10),
  mask: new THREE.BoxGeometry(0.32, 0.2, 0.09),
  limb: new THREE.CylinderGeometry(0.13, 0.15, 0.78, 8),
  arm: new THREE.CylinderGeometry(0.12, 0.14, 0.88, 8),
  pack: new THREE.BoxGeometry(0.52, 0.65, 0.24),
  visor: new THREE.BoxGeometry(0.21, 0.045, 0.025),
};
const remoteAvatarMaterial = {
  suit: new THREE.MeshStandardMaterial({ color: 0xb4a544, roughness: 0.94, metalness: 0.02 }),
  mask: new THREE.MeshStandardMaterial({ color: 0x090b0c, roughness: 0.34, metalness: 0.16 }),
  visor: new THREE.MeshBasicMaterial({ color: 0x7d120d, toneMapped: false }),
  seam: new THREE.MeshStandardMaterial({ color: 0x554d28, roughness: 1 }),
};

function createRemoteAvatar() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  // Network positions are camera positions; offset the visible body so its feet sit on the floor.
  body.position.y = -1.63;
  const torso = new THREE.Mesh(remoteAvatarGeometry.torso, remoteAvatarMaterial.suit);
  torso.position.y = 1.2;
  const head = new THREE.Mesh(remoteAvatarGeometry.head, remoteAvatarMaterial.suit);
  head.position.y = 1.93;
  const mask = new THREE.Mesh(remoteAvatarGeometry.mask, remoteAvatarMaterial.mask);
  mask.position.set(0, 1.89, -0.255);
  const visor = new THREE.Mesh(remoteAvatarGeometry.visor, remoteAvatarMaterial.visor);
  visor.position.set(0, 1.96, -0.308);
  const pack = new THREE.Mesh(remoteAvatarGeometry.pack, remoteAvatarMaterial.seam);
  pack.position.set(0, 1.27, 0.32);
  body.add(torso, head, mask, visor, pack);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(remoteAvatarGeometry.arm, remoteAvatarMaterial.suit);
    arm.position.set(side * 0.51, 1.22, 0);
    arm.rotation.z = side * -0.08;
    const leg = new THREE.Mesh(remoteAvatarGeometry.limb, remoteAvatarMaterial.seam);
    leg.position.set(side * 0.2, 0.42, 0);
    body.add(arm, leg);
  }
  root.add(body);
  root.traverse((part) => {
    if (part.isMesh) {
      part.castShadow = false;
      part.receiveShadow = false;
    }
  });
  return root;
}

function removeRemotePlayer(playerId) {
  const remote = remotePlayers.get(playerId);
  if (!remote) return;
  scene.remove(remote.mesh);
  remotePlayers.delete(playerId);
}

function clearRemotePlayers() {
  for (const playerId of remotePlayers.keys()) removeRemotePlayer(playerId);
}

function syncRemotePlayer(state) {
  const player = state?.player ?? state;
  const playerId = player?.id ?? player?.playerId ?? player?.socketId;
  const position = player?.position ?? player?.coordinates ?? player;
  const rotation = player?.rotation ?? (Number.isFinite(player?.yaw) ? { y: player.yaw } : null);
  if (!playerId || !position || !rotation
    || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
    console.warn('Eksik/uyumsuz uzak oyuncu paketi alındı:', state);
    return;
  }
  const localLevel = activeLevel === 'levelExclamation' && levelExclamation?.endingPhase !== 'run'
    ? 'ending'
    : activeLevel;
  const remoteLevel = player.level ?? localLevel;
  if (remoteLevel !== localLevel) {
    removeRemotePlayer(playerId);
    return;
  }
  let remote = remotePlayers.get(playerId);
  if (!remote) {
    remote = { mesh: createRemoteAvatar(), position: new THREE.Vector3(), yaw: 0, initialized: false };
    scene.add(remote.mesh);
    remotePlayers.set(playerId, remote);
  }
  remote.position.set(position.x, position.y, position.z);
  // Everyone currently starts on the same Level 0 spawn tile. Keep a remote
  // avatar out of the local camera when both clients are standing at that spot.
  const overlapX = position.x - camera.position.x;
  const overlapZ = position.z - camera.position.z;
  if (overlapX * overlapX + overlapZ * overlapZ < 1.44) {
    if (activeLevel === 'level0' && level0?.grid) {
      const cell = level0.worldToGrid(camera.position);
      const openNeighbors = [
        { x: cell.x + 1, y: cell.y },
        { x: cell.x - 1, y: cell.y },
        { x: cell.x, y: cell.y + 1 },
        { x: cell.x, y: cell.y - 1 },
      ].filter((next) => level0.grid[next.y]?.[next.x] === 0);
      const forwardX = -Math.sin(camera.rotation.y);
      const forwardZ = -Math.cos(camera.rotation.y);
      const tileSize = level0.options.tileSize;
      openNeighbors.sort((a, b) => {
        const aScore = (a.x - cell.x) * tileSize * forwardX + (a.y - cell.y) * tileSize * forwardZ;
        const bScore = (b.x - cell.x) * tileSize * forwardX + (b.y - cell.y) * tileSize * forwardZ;
        return bScore - aScore;
      });
      if (openNeighbors.length) {
        remote.position.copy(level0.gridToWorld(openNeighbors[0].x, openNeighbors[0].y));
        remote.position.y = position.y;
      }
    }
    if (remote.position.x === position.x && remote.position.z === position.z) {
      let hash = 0;
      for (let index = 0; index < playerId.length; index += 1) {
        hash = (hash * 31 + playerId.charCodeAt(index)) >>> 0;
      }
      const angle = (hash / 0xffffffff) * Math.PI * 2;
      remote.position.x += Math.cos(angle) * 1.8;
      remote.position.z += Math.sin(angle) * 1.8;
    }
  }
  if (!remote.initialized) {
    remote.mesh.position.copy(remote.position);
    remote.initialized = true;
  }
  remote.yaw = Number.isFinite(rotation.y) ? rotation.y : 0;
}

function emitRoomJoin() {
  if (!socket?.connected || !roomJoinRequested) return;
  const roomId = String(roomCodeInput.value || 'lobby').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'lobby';
  currentRoomId = roomId;
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  window.history.replaceState({}, '', url);
  socket.emit('room:join', {
    roomId,
    level: activeLevel,
    position: camera.position,
    rotation: camera.rotation,
    grid: level0.grid,
    mobile: input.isMobile,
  });
}

if (socket) {
  socket.on('connect', emitRoomJoin);
  socket.on('connect', () => {
    console.info(`[multiplayer] connected: ${socketUrl} (${socket.id})`);
  });
  socket.on('connect_error', (error) => {
    console.error(`Socket.IO bağlantısı kurulamadı (${socketUrl}).`, error.message);
    stateLabel.textContent = 'SUNUCU BAĞLANTISI YOK';
  });
  socket.on('room:joined', ({ roomId }) => {
    roomJoined = true;
    currentRoomId = roomId;
    console.info(`[multiplayer] joined room "${roomId}"`);
    level0.setNetworked(true);
    levelExclamation?.setNetworked(true);
    stateLabel.textContent = `${getLevelLabel()} · ODA ${roomId}`;
  });
  socket.on('room:players', (players) => {
    clearRemotePlayers();
    if (Array.isArray(players)) players.forEach(syncRemotePlayer);
    console.info(`[multiplayer] room snapshot: ${Array.isArray(players) ? players.length : 0} remote player(s)`);
  });
  socket.on('player:joined', syncRemotePlayer);
  socket.on('player:update', syncRemotePlayer);
  socket.on('player:left', ({ playerId }) => removeRemotePlayer(playerId));
  socket.on('entity:update', (message) => {
    if (message.level === 'level0' && activeLevel === 'level0') level0.applySharedMonster(message.monster);
    if (message.level === 'levelExclamation' && activeLevel === 'levelExclamation') {
      levelExclamation?.applySharedHorde(message.horde);
    }
  });
  socket.on('player:caught', ({ level }) => {
    if (level === 'level0' && activeLevel === 'level0') level0.gameOver = true;
    if (level === 'levelExclamation' && activeLevel === 'levelExclamation' && levelExclamation) {
      levelExclamation.gameOver = true;
    }
  });
  socket.on('disconnect', () => {
    roomJoined = false;
    clearRemotePlayers();
    level0.setNetworked(false);
    levelExclamation?.setNetworked(false);
  });
}

const ambienceAudio = new Audio(
  'https://upload.wikimedia.org/wikipedia/commons/a/ab/Mains_hum_60_Hz.ogg',
);
ambienceAudio.loop = true;
ambienceAudio.volume = 0.055;
ambienceAudio.preload = 'none';

const soundCredit = document.createElement('a');
soundCredit.href = 'https://commons.wikimedia.org/wiki/File:Mains_hum_60_Hz.ogg';
soundCredit.target = '_blank';
soundCredit.rel = 'noopener noreferrer';
soundCredit.textContent = 'Ses: Omegatron / Wikimedia Commons · CC BY-SA';
soundCredit.style.cssText = 'position:absolute;z-index:4;right:14px;bottom:64px;color:rgba(241,238,228,.4);font:9px monospace;text-decoration:none;';
experience.append(soundCredit);

let alarmAudio = null;
function getAlarmAudio() {
  if (alarmAudio) return alarmAudio;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  try {
    const context = new AudioContextClass({ latencyHint: 'interactive' });
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const mainTone = context.createOscillator();
    const mainGain = context.createGain();
    mainTone.type = 'sawtooth';
    mainTone.frequency.value = 420;
    mainGain.gain.value = 0.32;
    mainTone.connect(mainGain).connect(master);

    const overtone = context.createOscillator();
    const overtoneGain = context.createGain();
    overtone.type = 'square';
    overtone.frequency.value = 690;
    overtoneGain.gain.value = 0.06;
    overtone.connect(overtoneGain).connect(master);

    const sirenLfo = context.createOscillator();
    const sirenDepth = context.createGain();
    sirenLfo.type = 'sine';
    sirenLfo.frequency.value = 0.48;
    sirenDepth.gain.value = 270;
    sirenLfo.connect(sirenDepth).connect(mainTone.frequency);

    mainTone.start();
    overtone.start();
    sirenLfo.start();

    alarmAudio = {
      context,
      master,
      unlock() { context.resume().catch(() => {}); },
      start() {
        context.resume().catch(() => {});
        const now = context.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.2, now + 0.3);
      },
      stop() {
        const now = context.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + 0.18);
      },
    };
    return alarmAudio;
  } catch (error) {
    console.warn('Synthesized alarm audio is unavailable in this browser.', error);
    return null;
  }
}

function startAlarmAudio() {
  try { getAlarmAudio()?.start(); }
  catch (error) { console.warn('Could not start the Level ! alarm.', error); }
}
function stopAlarmAudio() {
  try { alarmAudio?.stop(); }
  catch (error) { console.warn('Could not stop the Level ! alarm.', error); }
}

function switchToLevel94() {
  if (activeLevel !== 'level0') return;
  ambienceAudio.pause();
  ambienceAudio.currentTime = 0;
  level94 = new Level94(scene);
  level0.dispose();
  activeLevel = 'level94';
  clearRemotePlayers();
  ambientLight.intensity = 0.08;
  camera.position.copy(level94.spawn);
  camera.rotation.set(0, 0, 0);
  stateLabel.textContent = input.isDeveloperMode ? 'DEVELOPER MODE' : 'LEVEL 94 · SESSİZLİK';
}

function getLevelLabel() {
  if (activeLevel === 'level0') return 'ORTAM AKTİF';
  if (activeLevel === 'level94' && level94?.isInterior) return 'LEVEL 94 · BEACON HOUSE';
  if (activeLevel === 'level94') return 'LEVEL 94 · SESSİZLİK';
  if (activeLevel === 'levelExclamation') return 'LEVEL ! · RUN FOR YOUR LIFE';
  if (activeLevel === 'result') return 'SIGNAL LOST';
  return 'LEVEL ! · RUN FOR YOUR LIFE';
}

function runVhsTransition(message, action, holdMilliseconds = 340) {
  if (transitionBusy) return;
  transitionBusy = true;
  transitionMessage.textContent = message;
  transitionScreen.setAttribute('aria-hidden', 'false');
  transitionScreen.classList.add('is-visible');
  window.setTimeout(() => {
    action();
    transitionScreen.classList.remove('is-visible');
    transitionScreen.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => { transitionBusy = false; }, 400);
  }, holdMilliseconds);
}

function enterBeaconInterior() {
  runVhsTransition('BEACON HOUSE · İÇ MEKÂNA GEÇİLİYOR', () => {
    camera.position.copy(level94.enterInterior());
    camera.rotation.set(0, 0, 0);
    stateLabel.textContent = input.isDeveloperMode ? 'DEVELOPER MODE' : getLevelLabel();
  }, 180);
}

function switchToLevelExclamation() {
  runVhsTransition('GERÇEKLİK BAĞLANTISI KOPUYOR... LEVEL ! YÜKLENİYOR...', () => {
    level94?.dispose();
    level94 = null;
    levelExclamation = new LevelExclamation(scene, { isMobile: input.isMobile });
    levelExclamation.setNetworked(Boolean(socket?.connected && roomJoined));
    endingAlarmStopped = false;
    activeLevel = 'levelExclamation';
    clearRemotePlayers();
    ambientLight.intensity = 0.025;
    camera.position.copy(levelExclamation.spawn);
    camera.rotation.set(0, 0, 0);
    startAlarmAudio();
    stateLabel.textContent = input.isDeveloperMode ? 'DEVELOPER MODE' : getLevelLabel();
  }, 390);
}

function finishRun(outcome) {
  if (activeLevel !== 'levelExclamation') return;
  activeLevel = 'result';
  clearRemotePlayers();
  stopAlarmAudio();
  camera.rotation.z = 0;
  camera.fov = 76;
  camera.updateProjectionMatrix();
  if (outcome === 'ending') {
    runResultKicker.textContent = 'HIGHWAY INCIDENT · SIGNAL LOST';
    runResultTitle.textContent = 'GERÇEKLİĞE GERİ DÖNDÜN. AMA GERÇEKLİK DE SENİ İSTEMEDİ.';
    restartButton.innerHTML = 'YENİDEN DENE <span>↻</span>';
  } else {
    runResultKicker.textContent = outcome === 'escaped' ? 'SIGNAL RESTORED · EXIT FOUND' : 'ENTITY CONTACT · RUN TERMINATED';
    runResultTitle.textContent = outcome === 'escaped' ? 'DIŞARI ÇIKTIN.' : 'YAKALANDIN.';
    restartButton.innerHTML = 'BAŞTAN BAŞLA <span>↻</span>';
  }
  runResultScreen.classList.add('is-visible');
  runResultScreen.setAttribute('aria-hidden', 'false');
  if (controls.isLocked) controls.unlock();
}

function finishLevel0GameOver() {
  if (activeLevel !== 'level0') return;
  activeLevel = 'result';
  clearRemotePlayers();
  ambienceAudio.pause();
  runResultKicker.textContent = 'ENTITY 0 · CONNECTION LOST';
  runResultTitle.textContent = 'YAKALANDIN.';
  restartButton.innerHTML = 'YENİDEN DENE <span>↻</span>';
  runResultScreen.classList.add('is-visible');
  runResultScreen.setAttribute('aria-hidden', 'false');
  if (controls.isLocked) controls.unlock();
}

function requestMobileFullscreen() {
  if (!input.isMobile) return;
  const root = document.documentElement;
  if (typeof root.requestFullscreen === 'function') {
    try {
      const result = root.requestFullscreen({ navigationUI: 'hide' });
      result?.catch(() => {
        try { root.requestFullscreen(); } catch { /* Fullscreen is best-effort on mobile browsers. */ }
      });
    } catch {
      try { root.requestFullscreen(); } catch { /* Fullscreen is best-effort on mobile browsers. */ }
    }
  } else if (typeof root.webkitRequestFullscreen === 'function') {
    try { root.webkitRequestFullscreen(); } catch { /* iOS support varies by browser version. */ }
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  networkSendAccumulator += Math.min(delta, 0.1);
  previousPlayerPosition.copy(camera.position);
  if (!transitionBusy) {
    if (activeLevel === 'levelExclamation' && levelExclamation
      && (input.isPlaying || levelExclamation.endingPhase !== 'run')) {
      const outcome = levelExclamation.update(delta, camera, input.getLevelKeys());
      if (levelExclamation.endingPhase !== 'run' && !endingAlarmStopped) {
        stopAlarmAudio();
        endingAlarmStopped = true;
        clearRemotePlayers();
      }
      if (outcome) finishRun(outcome);
    } else if (activeLevel === 'level0' || activeLevel === 'level94') {
      const groundY = activeLevel === 'level0' ? level0.playerGroundY : level94.playerGroundY;
      input.update(delta, groundY);
    }
  }

  if (activeLevel === 'level0') {
    if (!input.isDeveloperMode) level0.resolveCollision(camera.position, previousPlayerPosition);
    level0.update(delta, camera.position, input.isPlaying);
    if (level0.gameOver) finishLevel0GameOver();
    else if (level0.isNearSecretTrigger(camera.position)) switchToLevel94();
  } else if (activeLevel === 'level94' && level94) {
    level94.update(delta, camera.position);
    if (!transitionBusy) {
      if (level94.shouldEnterInterior(camera.position)) enterBeaconInterior();
      else if (!input.isDeveloperMode) level94.resolveCollision(camera.position, previousPlayerPosition);
    }
    if (!transitionBusy && level94.isTouchingBasementDoor(camera.position)) switchToLevelExclamation();
  }

  const lookBlend = Math.min(1, delta * 14);
  for (const remote of remotePlayers.values()) {
    remote.mesh.position.lerp(remote.position, lookBlend);
    const yawDelta = Math.atan2(Math.sin(remote.yaw - remote.mesh.rotation.y), Math.cos(remote.yaw - remote.mesh.rotation.y));
    remote.mesh.rotation.y += yawDelta * lookBlend;
  }

  if (networkSendAccumulator >= 1 / 30) {
    networkSendAccumulator %= 1 / 30;
    if (socket.connected && roomJoined) {
      const level = activeLevel === 'levelExclamation' && levelExclamation?.endingPhase !== 'run'
        ? 'ending'
        : activeLevel;
      socket.emit('player:update', {
        level,
        position: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        rotation: {
          x: camera.rotation.x,
          y: camera.rotation.y,
          z: camera.rotation.z,
        },
        mobile: input.isMobile,
      });
    }
  }

  renderer.render(scene, camera);
  const { x, y, z } = controls.object.position;
  positionLabel.innerHTML = `X ${x.toFixed(1)}&nbsp;&nbsp; Y ${y.toFixed(1)}&nbsp;&nbsp; Z ${z.toFixed(1)}`;
}

enterButton.addEventListener('click', (event) => {
  event.preventDefault();
  requestMobileFullscreen();
  try { getAlarmAudio()?.unlock(); } catch { /* Audio must never block pointer lock. */ }
  if (socket) {
    roomJoinRequested = true;
    if (socket.connected) emitRoomJoin();
    else socket.connect();
  }
  if (activeLevel === 'level0') {
    ambienceAudio.play().catch((error) => console.warn('Fluorescent ambience could not start.', error));
  }
  if (input.isMobile) {
    input.startMobile();
    startScreen.style.display = 'none';
    experience.classList.add('is-active');
    stateLabel.textContent = getLevelLabel();
  } else {
    controls.lock();
  }
});

touchInteractButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (activeLevel === 'level94' && level94?.tryOpenBasement(camera.position)) {
    switchToLevelExclamation();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyL' && activeLevel === 'level0') {
    event.preventDefault();
    switchToLevel94();
  }
  if (event.code === 'KeyE' && !event.repeat && activeLevel === 'level94'
    && level94?.tryOpenBasement(camera.position)) {
    event.preventDefault();
    switchToLevelExclamation();
  }
});

restartButton.addEventListener('click', () => window.location.reload());

controls.addEventListener('lock', () => {
  startScreen.style.display = 'none';
  stateLabel.textContent = input.isDeveloperMode
    ? 'DEVELOPER MODE'
    : getLevelLabel();
  experience.classList.add('is-active');
});

controls.addEventListener('unlock', () => {
  startScreen.style.display = 'grid';
  stateLabel.textContent = input.isDeveloperMode ? 'DEVELOPER MODE' : (activeLevel === 'level0' ? 'SİSTEM HAZIR' : getLevelLabel());
  experience.classList.remove('is-active');
  ambienceAudio.pause();
});

window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => {
  input.dispose();
  if (activeLevel === 'level0') level0.dispose();
  else if (activeLevel === 'level94') level94?.dispose();
  else levelExclamation?.dispose();
  ambienceAudio.pause();
  alarmAudio?.context.close().catch(() => {});
  renderer.dispose();
}, { once: true });

resize();
animate();
