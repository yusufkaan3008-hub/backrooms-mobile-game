import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server as SocketServer } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT) || 3000;
const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.join(rootDirectory, 'dist');
const io = new SocketServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000,
});

const rooms = new Map();
const TICK_MS = 1000 / 30;
const VALID_LEVELS = new Set(['level0', 'level94', 'levelExclamation', 'ending', 'result']);

app.disable('x-powered-by');
app.get('/healthz', (_request, response) => response.status(200).type('text').send('ok'));
app.use(express.static(distDirectory, {
  index: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  etag: true,
}));
app.get(/.*/, (_request, response) => response.sendFile(path.join(distDirectory, 'index.html')));

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = { players: new Map(), grid: null, entity0: null, horde: null };
    rooms.set(roomId, room);
  }
  return room;
}

function numberOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function safePosition(value) {
  return {
    x: Math.max(-10000, Math.min(10000, numberOr(value?.x))),
    y: Math.max(-1000, Math.min(10000, numberOr(value?.y))),
    z: Math.max(-10000, Math.min(10000, numberOr(value?.z))),
  };
}

function safeRotation(value) {
  return {
    x: numberOr(value?.x),
    y: numberOr(value?.y),
    z: numberOr(value?.z),
  };
}

function readGrid(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64) return null;
  if (!value.every((row) => Array.isArray(row) && row.length === value.length)) return null;
  if (!value.every((row) => row.every((cell) => cell === 0 || cell === 1))) return null;
  return value.map((row) => row.slice());
}

function worldToCell(position, grid) {
  const size = grid.length;
  const half = (size - 1) / 2;
  return {
    x: Math.max(1, Math.min(size - 2, Math.round(position.x / 3.2 + half))),
    y: Math.max(1, Math.min(size - 2, Math.round(position.z / 3.2 + half))),
  };
}

function cellToWorld(cell, size) {
  const half = (size - 1) / 2;
  return { x: (cell.x - half) * 3.2, y: 0, z: (cell.y - half) * 3.2 };
}

function bfsNextCell(grid, start, goal) {
  const size = grid.length;
  const startId = start.y * size + start.x;
  const goalId = goal.y * size + goal.x;
  const previous = new Int32Array(size * size).fill(-2);
  const queue = new Int32Array(size * size);
  let read = 0;
  let write = 0;
  queue[write++] = startId;
  previous[startId] = -1;
  while (read < write) {
    const current = queue[read++];
    if (current === goalId) break;
    const x = current % size;
    const y = Math.floor(current / size);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= size - 1 || ny >= size - 1 || grid[ny][nx] !== 0) continue;
      const next = ny * size + nx;
      if (previous[next] !== -2) continue;
      previous[next] = current;
      queue[write++] = next;
    }
  }
  if (previous[goalId] === -2) return start;
  let current = goalId;
  while (previous[current] !== startId && previous[current] >= 0) current = previous[current];
  return { x: current % size, y: Math.floor(current / size) };
}

function activePlayers(room, level) {
  return [...room.players.values()].filter((player) => player.level === level && !player.dead);
}

function chooseTarget(players, origin) {
  let selected = null;
  let bestScore = Infinity;
  for (const player of players) {
    const distance = Math.hypot(player.position.x - origin.x, player.position.z - origin.z);
    const score = distance - Math.min(player.speed, 18) * 0.65;
    if (score < bestScore) {
      bestScore = score;
      selected = player;
    }
  }
  return selected;
}

function spawnEntity0(room, target, now) {
  if (!room.grid) return;
  const playerCell = worldToCell(target.position, room.grid);
  let spawnCell = playerCell;
  let farthest = -1;
  for (let y = 1; y < room.grid.length - 1; y += 1) {
    for (let x = 1; x < room.grid.length - 1; x += 1) {
      if (room.grid[y][x] !== 0) continue;
      const distance = (x - playerCell.x) ** 2 + (y - playerCell.y) ** 2;
      if (distance > farthest) {
        farthest = distance;
        spawnCell = { x, y };
      }
    }
  }
  room.entity0 = {
    ...cellToWorld(spawnCell, room.grid.length),
    aware: false,
    target: null,
    nextPathAt: now,
    spawnAt: null,
  };
}

function tickLevel0(room, delta, now) {
  const players = activePlayers(room, 'level0');
  if (!players.length) return;
  if (!room.entity0) {
    const explorer = players.find((player) => Math.hypot(
      player.position.x - player.spawnPosition.x,
      player.position.z - player.spawnPosition.z,
    ) > 2.2);
    if (explorer && explorer.spawnAt === null) explorer.spawnAt = now + 10000 + Math.random() * 5000;
    const due = players.find((player) => player.spawnAt !== null && player.spawnAt <= now);
    if (due) spawnEntity0(room, due, now);
    if (!room.entity0) return;
  }

  const entity = room.entity0;
  const target = chooseTarget(players, entity);
  if (!target) return;
  const distance = Math.hypot(target.position.x - entity.x, target.position.z - entity.z);
  if (!entity.aware && distance <= 30) entity.aware = true;
  if (entity.aware && room.grid) {
    if (now >= entity.nextPathAt) {
      const start = worldToCell(entity, room.grid);
      const goal = worldToCell(target.position, room.grid);
      const next = bfsNextCell(room.grid, start, goal);
      entity.target = cellToWorld(next, room.grid.length);
      entity.nextPathAt = now + 320;
    }
    if (entity.target) {
      const dx = entity.target.x - entity.x;
      const dz = entity.target.z - entity.z;
      const remaining = Math.hypot(dx, dz);
      const step = Math.min(remaining, 2.5 * delta);
      if (remaining > 0.001) {
        entity.x += (dx / remaining) * step;
        entity.z += (dz / remaining) * step;
        entity.rotation = Math.atan2(target.position.x - entity.x, target.position.z - entity.z);
      }
    }
  }
  for (const player of players) {
    if (player.dead) continue;
    if (Math.hypot(player.position.x - entity.x, player.position.z - entity.z) <= 1.25) {
      player.dead = true;
      io.to(player.id).emit('player:caught', { level: 'level0', entity: 0 });
    }
  }
  for (const player of players) io.to(player.id).emit('entity:update', { level: 'level0', monster: entity });
}

function tickHorde(room, delta) {
  const players = activePlayers(room, 'levelExclamation');
  if (!players.length) {
    room.horde = null;
    return;
  }
  const origin = chooseTarget(players, { x: 0, z: players[0].position.z + 30 });
  if (!room.horde) {
    room.horde = players.map((player, index) => ({
      x: [-1.5, 1.45, -2.35, 2.3][index],
      z: player.position.z + 28 + index * 10,
      speed: 9.25 + index * 0.06,
      laneBias: [-0.27, 0.26, -0.42, 0.41][index],
    }));
  }
  for (const monster of room.horde) {
    const desiredX = Math.max(-3.7, Math.min(3.7, origin.position.x * 0.72 + monster.laneBias));
    monster.x += (desiredX - monster.x) * Math.min(1, delta * 1.35);
    monster.z -= monster.speed * delta;
    for (const player of players) {
      if (player.dead) continue;
      const gap = monster.z - player.position.z;
      if (gap < 1.25 && Math.abs(monster.x - player.position.x) < 0.92) {
        player.dead = true;
        io.to(player.id).emit('player:caught', { level: 'levelExclamation', entity: 0 });
      }
    }
  }
  for (const player of players) io.to(player.id).emit('entity:update', { level: 'levelExclamation', horde: room.horde });
}

io.on('connection', (socket) => {
  socket.emit('session:ready', { playerId: socket.id });

  socket.on('room:join', (payload = {}) => {
    const roomId = String(payload.roomId || 'lobby').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'lobby';
    if (socket.data.roomId) leaveRoom(socket);
    const room = getRoom(roomId);
    if (!room.grid) room.grid = readGrid(payload.grid);
    const position = safePosition(payload.position);
    const player = {
      id: socket.id,
      level: VALID_LEVELS.has(payload.level) ? payload.level : 'level0',
      position,
      rotation: safeRotation(payload.rotation),
      spawnPosition: { ...position },
      spawnAt: null,
      speed: 0,
      dead: false,
      mobile: Boolean(payload.mobile),
      updatedAt: Date.now(),
    };
    room.players.set(socket.id, player);
    socket.data.roomId = roomId;
    socket.data.lastUpdateAt = 0;
    socket.join(roomId);
    socket.emit('room:joined', { roomId, playerId: socket.id });
    socket.emit('room:players', [...room.players.values()].filter((other) => other.id !== socket.id));
    socket.to(roomId).emit('player:joined', player);
  });

  socket.on('player:update', (payload = {}) => {
    const now = Date.now();
    if (now - (socket.data.lastUpdateAt || 0) < 30) return;
    socket.data.lastUpdateAt = now;
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    const player = room?.players.get(socket.id);
    if (!player) return;
    const nextPosition = safePosition(payload.position);
    const elapsed = Math.max(0.001, (now - player.updatedAt) / 1000);
    player.speed = Math.hypot(nextPosition.x - player.position.x, nextPosition.z - player.position.z) / elapsed;
    player.position = nextPosition;
    player.rotation = safeRotation(payload.rotation);
    player.level = VALID_LEVELS.has(payload.level) ? payload.level : 'level0';
    player.mobile = Boolean(payload.mobile);
    player.updatedAt = now;
    socket.to(roomId).emit('player:update', player);
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.delete(socket.id);
  socket.to(roomId).emit('player:left', { playerId: socket.id });
  socket.leave(roomId);
  socket.data.roomId = null;
  if (!room.players.size) rooms.delete(roomId);
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const delta = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  for (const room of rooms.values()) {
    tickLevel0(room, delta, now);
    tickHorde(room, delta);
  }
}, TICK_MS).unref();

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Backrooms Socket.IO server listening on port ${port}`);
});
