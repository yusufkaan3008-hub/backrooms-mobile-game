import * as THREE from 'three';

const DEFAULTS = {
  gridSize: 41,
  tileSize: 3.2,
  wallHeight: 4.1,
  ceilingHeight: 4,
  seed: 8042,
  roomCount: 8,
  loopCount: 34,
  lampCount: 36,
  pointLightCount: 4,
  shadowLightCount: 2,
};

const FLICKER_COUNT = 3;
const MONSTER_DELAY_MIN = 10;
const MONSTER_DELAY_MAX = 15;
const MONSTER_NOTICE_DISTANCE = 30;
const MONSTER_TOUCH_DISTANCE = 1.25;
const GRID_DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** Procedural Level 0. Repeated environment geometry and fixtures are instanced. */
export class Level0 {
  constructor(scene, options = {}) {
    const { seed = DEFAULTS.seed } = options;
    this.scene = scene;
    this.options = { ...DEFAULTS, ...options, seed };
    this.group = new THREE.Group();
    this.group.name = 'Level 0 — The Lobby';
    this.playerGroundY = 1.63; // floor top (-0.07) plus eye height (1.70)
    this.disposables = [];
    this.lightStates = [];
    this.flickerStates = [];
    this.fixtureMesh = null;

    this.grid = this.createMaze(this.options.gridSize, seed);
    if (this.grid[this.start.y][this.start.x] !== 0) {
      throw new Error('Level 0 spawn must be on an open maze cell.');
    }
    this.spawn = this.gridToWorld(this.start.x, this.start.y);
    this.openCells = [];
    for (let y = 1; y < this.options.gridSize - 1; y += 1) {
      for (let x = 1; x < this.options.gridSize - 1; x += 1) {
        if (this.grid[y][x] === 0) this.openCells.push({ x, y });
      }
    }
    this.secretTriggerPosition = this.findSecretTrigger();

    this.monster = null;
    this.monsterSpawnTimer = null;
    this.monsterAware = false;
    this.monsterPathTimer = 0;
    this.monsterProximity = 0;
    this.flickerTargetTimer = 0;
    this.gameOver = false;
    this.routeTarget = new THREE.Vector3();
    this.moveVector = new THREE.Vector3();
    const mazeCellCount = this.options.gridSize * this.options.gridSize;
    this.pathPrevious = new Int32Array(mazeCellCount);
    this.pathQueue = new Int32Array(mazeCellCount);
    this.monsterCell = { x: 0, y: 0 };
    this.playerCell = { x: 0, y: 0 };

    this.scene.add(this.group);
    this.build();
    this.scene.fog = new THREE.FogExp2(0x514a32, 0.023);
    this.scene.background = new THREE.Color(0x514a32);
  }

  createMaze(size, seed) {
    const grid = Array.from({ length: size }, () => Array(size).fill(1));
    const rand = seededRandom(seed);
    const center = Math.floor((size - 1) / 2);
    this.start = { x: center % 2 ? center : center - 1, y: center % 2 ? center : center - 1 };

    // Recursive backtracker creates connected halls with naturally occurring dead ends.
    const stack = [this.start];
    grid[this.start.y][this.start.x] = 0;
    while (stack.length) {
      const current = stack[stack.length - 1];
      const next = shuffle([[0, -2], [2, 0], [0, 2], [-2, 0]], rand)
        .map(([dx, dy]) => ({ x: current.x + dx, y: current.y + dy, dx, dy }))
        .find(({ x, y }) => x > 0 && y > 0 && x < size - 1 && y < size - 1 && grid[y][x] === 1);

      if (!next) {
        stack.pop();
        continue;
      }
      grid[current.y + next.dy / 2][current.x + next.dx / 2] = 0;
      grid[next.y][next.x] = 0;
      stack.push({ x: next.x, y: next.y });
    }

    this.carveRooms(grid, rand);
    this.carveLoops(grid, rand);
    return grid;
  }

  carveRooms(grid, rand) {
    const centers = [];
    const oddCenters = [];
    for (let value = 3; value < this.options.gridSize - 4; value += 2) oddCenters.push(value);

    let attempts = 0;
    while (centers.length < this.options.roomCount && attempts < 400) {
      attempts += 1;
      const center = {
        x: oddCenters[Math.floor(rand() * oddCenters.length)],
        y: oddCenters[Math.floor(rand() * oddCenters.length)],
      };
      if (centers.some((room) => distanceSq(room, center) < 64)) continue;
      centers.push(center);

      const roomSize = rand() < 0.55 ? 3 : 4;
      const startX = center.x - Math.floor(roomSize / 2);
      const startY = center.y - Math.floor(roomSize / 2);
      for (let y = startY; y < startY + roomSize; y += 1) {
        for (let x = startX; x < startX + roomSize; x += 1) grid[y][x] = 0;
      }
    }
  }

  carveLoops(grid, rand) {
    const size = this.options.gridSize;
    const candidates = [];
    for (let y = 1; y < size - 1; y += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        if (grid[y][x] !== 1) continue;
        const horizontal = grid[y][x - 1] === 0 && grid[y][x + 1] === 0;
        const vertical = grid[y - 1][x] === 0 && grid[y + 1][x] === 0;
        if (horizontal || vertical) candidates.push({ x, y });
      }
    }

    shuffle(candidates, rand);
    let carved = 0;
    for (const cell of candidates) {
      if (carved >= this.options.loopCount) break;
      if (grid[cell.y][cell.x] === 1 && rand() < 0.72) {
        grid[cell.y][cell.x] = 0;
        carved += 1;
      }
    }
  }

  build() {
    const { gridSize, tileSize, wallHeight, ceilingHeight } = this.options;
    const chunkSize = 8;
    const chunks = new Map();

    for (let y = 0; y < gridSize; y += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        const chunkX = Math.floor(x / chunkSize);
        const chunkY = Math.floor(y / chunkSize);
        const key = `${chunkX}:${chunkY}`;
        let chunk = chunks.get(key);
        if (!chunk) {
          chunk = { walls: [], ceiling: [] };
          chunks.set(key, chunk);
        }
        if (this.grid[y][x] === 1) chunk.walls.push({ x, y });
        chunk.ceiling.push({ x, y });
      }
    }

    const wallMaterial = this.makeMaterial('wall', 0.94);
    const floorMaterial = this.makeMaterial('carpet', 1);
    const ceilingMaterial = this.makeMaterial('ceiling', 0.96);

    const wallGeometry = new THREE.BoxGeometry(tileSize, wallHeight, tileSize);
    const ceilingGeometry = new THREE.BoxGeometry(tileSize - 0.035, 0.12, tileSize - 0.035);
    this.disposables.push(wallGeometry, ceilingGeometry);
    for (const [key, chunk] of chunks) {
      if (chunk.walls.length) {
        const walls = this.makeInstances(
          wallGeometry,
          wallMaterial,
          chunk.walls,
          ({ x, y }) => this.gridToWorld(x, y, wallHeight / 2),
        );
        walls.name = `Instanced wallpaper walls ${key}`;
        walls.castShadow = true;
        walls.receiveShadow = true;
      }
      const ceiling = this.makeInstances(
        ceilingGeometry,
        ceilingMaterial,
        chunk.ceiling,
        ({ x, y }) => this.gridToWorld(x, y, ceilingHeight),
      );
      ceiling.name = `Instanced ceiling panels ${key}`;
      ceiling.receiveShadow = true;
    }

    const floorWidth = gridSize * tileSize;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorWidth, floorWidth),
      floorMaterial,
    );
    floor.name = 'Damp carpet floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.07;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.disposables.push(floor.geometry);

    this.lampPositions = this.selectLampPositions();
    this.addFixtures(this.lampPositions);
    this.addPointLights(this.lampPositions);
  }

  makeMaterial(kind, roughness) {
    const texture = createLevel0Texture(kind);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 2;

    const repeats = {
      wall: [1.25, 1.5],
      carpet: [this.options.gridSize, this.options.gridSize],
      ceiling: [1, 1],
    };
    texture.repeat.set(...repeats[kind]);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      roughness,
      metalness: 0,
    });
    material.needsUpdate = true;
    this.disposables.push(material, texture);
    return material;
  }

  makeInstances(geometry, material, cells, positionFor) {
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < cells.length; index += 1) {
      dummy.position.copy(positionFor(cells[index]));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = true;
    this.group.add(mesh);
    return mesh;
  }

  findSecretTrigger() {
    let chosen = this.openCells[0];
    let farthestDistance = -1;
    for (const cell of this.openCells) {
      let openings = 0;
      for (const [dx, dy] of GRID_DIRECTIONS) {
        if (this.grid[cell.y + dy]?.[cell.x + dx] === 0) openings += 1;
      }
      if (openings !== 1) continue;
      const distance = distanceSq(cell, this.start);
      if (distance > farthestDistance) {
        chosen = cell;
        farthestDistance = distance;
      }
    }
    return this.gridToWorld(chosen.x, chosen.y);
  }

  isNearSecretTrigger(position, radius = 1.6) {
    const dx = position.x - this.secretTriggerPosition.x;
    const dz = position.z - this.secretTriggerPosition.z;
    return dx * dx + dz * dz <= radius * radius;
  }

  selectLampPositions() {
    const cells = [];
    for (let y = 1; y < this.options.gridSize - 1; y += 2) {
      for (let x = 1; x < this.options.gridSize - 1; x += 2) {
        if (this.grid[y][x] === 0) cells.push({ x, y });
      }
    }
    if (!cells.length) return [];

    const wanted = Math.min(this.options.lampCount, cells.length);
    const center = (this.options.gridSize - 1) / 2;
    let first = cells[0];
    for (const cell of cells) {
      if (distanceSq(cell, { x: center, y: center }) < distanceSq(first, { x: center, y: center })) first = cell;
    }

    const selected = [first];
    const minDistances = new Float32Array(cells.length);
    minDistances.fill(Infinity);
    while (selected.length < wanted) {
      const latest = selected[selected.length - 1];
      let bestIndex = -1;
      let bestDistance = -1;
      for (let i = 0; i < cells.length; i += 1) {
        const distance = distanceSq(cells[i], latest);
        if (distance < minDistances[i]) minDistances[i] = distance;
        if (minDistances[i] > bestDistance) {
          bestDistance = minDistances[i];
          bestIndex = i;
        }
      }
      selected.push(cells[bestIndex]);
    }
    return selected;
  }

  addFixtures(positions) {
    if (!positions.length) return;
    const geometry = new THREE.BoxGeometry(1.45, 0.065, 0.42);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      toneMapped: false,
    });
    this.disposables.push(material);
    const fixtures = new THREE.InstancedMesh(geometry, material, positions.length);
    const dummy = new THREE.Object3D();
    const warmWhite = new THREE.Color(0xfff4ce);

    positions.forEach((cell, index) => {
      dummy.position.copy(this.gridToWorld(cell.x, cell.y, this.options.ceilingHeight - 0.2));
      dummy.updateMatrix();
      fixtures.setMatrixAt(index, dummy.matrix);
      fixtures.setColorAt(index, warmWhite);
    });

    fixtures.instanceMatrix.needsUpdate = true;
    if (fixtures.instanceColor) fixtures.instanceColor.needsUpdate = true;
    fixtures.name = 'Emissive fluorescent strips';
    this.group.add(fixtures);
    this.fixtureMesh = fixtures;
    this.disposables.push(geometry);

    for (let i = 0; i < Math.min(FLICKER_COUNT, positions.length); i += 1) {
      this.flickerStates.push({
        index: i,
        timer: 2 + Math.random() * 4,
        offTimer: 0,
        phase: i * 2.7,
        color: new THREE.Color(),
      });
    }
  }

  addPointLights(positions) {
    const count = Math.min(this.options.pointLightCount, positions.length);
    for (let index = 0; index < count; index += 1) {
      const cell = positions[index];
      const light = new THREE.PointLight(0xffe6ad, 34, 17, 2);
      light.position.copy(this.gridToWorld(cell.x, cell.y, this.options.ceilingHeight - 0.3));
      light.castShadow = index < this.options.shadowLightCount;
      if (light.castShadow) {
        light.shadow.mapSize.set(512, 512);
        light.shadow.camera.near = 0.5;
        light.shadow.camera.far = 20;
        light.shadow.bias = -0.001;
        light.shadow.radius = 2;
        light.shadow.autoUpdate = false;
        light.shadow.needsUpdate = true;
      }
      light.name = `Static fluorescent point light ${index + 1}`;
      this.group.add(light);
      this.lightStates.push({ light, baseIntensity: light.intensity });
    }
  }

  update(deltaSeconds, playerPosition, active) {
    if (!active || this.gameOver) return this.gameOver;

    if (!this.monster) {
      if (this.monsterSpawnTimer === null) {
        const walked = Math.hypot(playerPosition.x - this.spawn.x, playerPosition.z - this.spawn.z) >= 2.2;
        if (walked) {
          this.monsterSpawnTimer = MONSTER_DELAY_MIN + Math.random() * (MONSTER_DELAY_MAX - MONSTER_DELAY_MIN);
        }
      } else {
        this.monsterSpawnTimer -= deltaSeconds;
        if (this.monsterSpawnTimer <= 0) this.spawnMonster(playerPosition);
      }
    }

    if (this.monster) {
      this.updateMonster(deltaSeconds, playerPosition);
      this.refreshFlickerTargets(deltaSeconds);
    }
    this.updateFlicker(deltaSeconds);
    return this.gameOver;
  }

  refreshFlickerTargets(deltaSeconds) {
    this.flickerTargetTimer -= deltaSeconds;
    if (this.flickerTargetTimer > 0 || !this.lampPositions.length) return;
    this.flickerTargetTimer = 0.75;
    const monsterCell = this.worldToGrid(this.monster.root.position, this.monsterCell);

    for (let stateIndex = 0; stateIndex < this.flickerStates.length; stateIndex += 1) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      for (let lampIndex = 0; lampIndex < this.lampPositions.length; lampIndex += 1) {
        let alreadyUsed = false;
        for (let prior = 0; prior < stateIndex; prior += 1) {
          if (this.flickerStates[prior].index === lampIndex) alreadyUsed = true;
        }
        if (alreadyUsed) continue;
        const distance = distanceSq(monsterCell, this.lampPositions[lampIndex]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = lampIndex;
        }
      }
      const state = this.flickerStates[stateIndex];
      if (state.index !== nearestIndex) {
        state.index = nearestIndex;
        state.timer = 0.3 + Math.random() * 0.6;
        state.offTimer = 0;
      }
    }
  }

  updateFlicker(deltaSeconds) {
    if (!this.fixtureMesh) return;
    const proximity = this.monsterProximity;

    for (const state of this.flickerStates) {
      state.timer -= deltaSeconds;
      if (state.offTimer > 0) state.offTimer -= deltaSeconds;
      if (state.timer <= 0) {
        const chance = 0.12 + proximity * 0.72;
        if (Math.random() < chance) state.offTimer = 0.045 + Math.random() * (0.08 + proximity * 0.18);
        state.timer = 3.5 + Math.random() * 5.5 - proximity * 2.2;
      }

      const sine = 0.94 + Math.sin(performance.now() * 0.0024 + state.phase) * 0.06;
      const brightness = state.offTimer > 0 ? 0.035 : sine;
      state.color.setRGB(brightness, brightness * 0.96, brightness * 0.82);
      this.fixtureMesh.setColorAt(state.index, state.color);

      const pointLightState = this.lightStates[state.index];
      if (pointLightState) pointLightState.light.intensity = pointLightState.baseIntensity * brightness;
    }

    if (this.fixtureMesh.instanceColor) this.fixtureMesh.instanceColor.needsUpdate = true;
  }

  spawnMonster(playerPosition) {
    if (this.monster || !this.openCells.length) return;

    const playerCell = this.worldToGrid(playerPosition);
    let spawnCell = this.openCells[0];
    let farthest = -1;
    for (let attempt = 0; attempt < Math.min(80, this.openCells.length); attempt += 1) {
      const cell = this.openCells[Math.floor(Math.random() * this.openCells.length)];
      const distance = distanceSq(cell, playerCell);
      if (distance > farthest) {
        farthest = distance;
        spawnCell = cell;
      }
    }

    const root = this.createMonsterEntity();
    root.position.copy(this.gridToWorld(spawnCell.x, spawnCell.y));
    this.group.add(root);
    this.monster = { root, aware: false };
  }

  createMonsterEntity() {
    const root = new THREE.Group();
    root.name = 'Entity 0';
    root.userData.entityId = 0;

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x010102,
      roughness: 1,
      metalness: 0,
      emissive: 0x020203,
      emissiveIntensity: 0.08,
      flatShading: true,
    });
    const wetEdgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x050507,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x710711, toneMapped: false });
    this.disposables.push(bodyMaterial, wetEdgeMaterial, eyeMaterial);

    // Lopsided, faceted core with vertex distortion instead of a humanoid torso.
    const coreGeometry = new THREE.IcosahedronGeometry(0.62, 2);
    const corePositions = coreGeometry.attributes.position;
    for (let i = 0; i < corePositions.count; i += 1) {
      const x = corePositions.getX(i);
      const y = corePositions.getY(i);
      const z = corePositions.getZ(i);
      const warp = 1 + 0.17 * Math.sin(x * 15 + z * 9) * Math.cos(y * 12 - x * 4);
      corePositions.setXYZ(i, x * warp, y * warp, z * warp);
    }
    coreGeometry.computeVertexNormals();
    const core = new THREE.Mesh(coreGeometry, bodyMaterial);
    core.position.set(-0.05, 1.72, 0);
    core.scale.set(0.78, 2.75, 0.72);
    root.add(core);
    this.disposables.push(coreGeometry);

    const crownGeometry = new THREE.DodecahedronGeometry(0.39, 1);
    const crown = new THREE.Mesh(crownGeometry, bodyMaterial);
    crown.position.set(0.14, 3.05, 0.035);
    crown.rotation.set(0.18, 0.35, -0.28);
    crown.scale.set(0.78, 1.18, 0.7);
    root.add(crown);
    this.disposables.push(crownGeometry);

    const eyeGeometry = new THREE.SphereGeometry(0.032, 7, 6);
    const eyes = new THREE.InstancedMesh(eyeGeometry, eyeMaterial, 3);
    const eyeDummy = new THREE.Object3D();
    [[-0.105, 3.08, 0.30], [0.12, 3.02, 0.29], [0.015, 2.72, 0.39]].forEach((point, index) => {
      eyeDummy.position.set(point[0], point[1], point[2]);
      eyeDummy.scale.set(index === 2 ? 0.72 : 1, 1, 0.7);
      eyeDummy.updateMatrix();
      eyes.setMatrixAt(index, eyeDummy.matrix);
    });
    eyes.instanceMatrix.needsUpdate = true;
    root.add(eyes);
    this.disposables.push(eyeGeometry);

    // Twisted central fibers and hanging, uneven organic limbs.
    const strands = [
      { points: [[0, 0.05, 0.05], [-0.18, 0.8, 0.12], [0.13, 1.55, -0.12], [-0.15, 2.35, 0.08], [0.16, 3.35, 0]], radius: 0.075, material: bodyMaterial },
      { points: [[-0.25, 2.45, 0], [-0.78, 2.3, 0.18], [-1.25, 1.65, 0.34], [-1.78, 1.18, 0.15], [-2.08, 0.24, 0.3]], radius: 0.09, material: wetEdgeMaterial },
      { points: [[0.25, 2.55, 0], [0.72, 2.1, -0.18], [1.16, 1.9, -0.35], [1.48, 0.92, -0.2], [1.95, 0.52, -0.42]], radius: 0.075, material: bodyMaterial },
      { points: [[-0.12, 2.12, -0.12], [-0.62, 1.72, -0.48], [-0.92, 0.92, -0.62], [-1.44, 0.25, -0.45], [-1.26, -0.12, -0.36]], radius: 0.06, material: bodyMaterial },
      { points: [[0.16, 2.22, -0.1], [0.62, 1.68, -0.55], [0.96, 1.05, -0.82], [1.54, 0.61, -0.68], [1.72, -0.1, -0.48]], radius: 0.065, material: wetEdgeMaterial },
      { points: [[-0.05, 1.25, 0.24], [-0.52, 0.84, 0.66], [-0.38, 0.05, 0.92], [-0.92, -0.15, 1.14]], radius: 0.045, material: wetEdgeMaterial },
      { points: [[0.08, 1.45, 0.18], [0.5, 0.92, 0.58], [0.28, 0.25, 1.02], [0.78, -0.12, 1.26]], radius: 0.05, material: bodyMaterial },
      { points: [[-0.22, 2.72, -0.02], [-0.58, 3.2, -0.2], [-0.91, 3.48, 0.02], [-0.72, 3.8, 0.24]], radius: 0.052, material: bodyMaterial },
      { points: [[0.2, 2.76, -0.02], [0.62, 3.18, -0.16], [0.97, 3.35, 0.12], [1.18, 3.74, -0.08]], radius: 0.052, material: wetEdgeMaterial },
      { points: [[-0.18, 1.86, 0.18], [-0.7, 1.48, 0.74], [-1.03, 1.15, 1.02], [-1.42, 1.42, 1.22]], radius: 0.04, material: bodyMaterial },
      { points: [[0.12, 1.9, 0.16], [0.55, 1.42, 0.74], [1.05, 1.3, 1.1], [1.42, 0.96, 1.3]], radius: 0.043, material: wetEdgeMaterial },
    ];

    for (const strand of strands) {
      const points = strand.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.TubeGeometry(curve, 18, strand.radius, 5, false);
      const tendril = new THREE.Mesh(geometry, strand.material);
      tendril.castShadow = false;
      tendril.receiveShadow = false;
      root.add(tendril);
      this.disposables.push(geometry);
    }

    root.traverse((part) => {
      if (part.isMesh) {
        part.castShadow = false;
        part.receiveShadow = false;
      }
    });

    return root;
  }

  updateMonster(deltaSeconds, playerPosition) {
    const { root } = this.monster;
    const dx = playerPosition.x - root.position.x;
    const dz = playerPosition.z - root.position.z;
    const distance = Math.hypot(dx, dz);
    this.monsterProximity = THREE.MathUtils.clamp(1 - distance / 22, 0, 1);
    root.rotation.z = Math.sin(performance.now() * 0.0018) * 0.028;

    if (!this.monster.aware && distance <= MONSTER_NOTICE_DISTANCE) this.monster.aware = true;
    if (!this.monster.aware) return;

    this.monsterPathTimer -= deltaSeconds;
    if (this.monsterPathTimer <= 0) {
      const monsterCell = this.worldToGrid(root.position, this.monsterCell);
      const playerCell = this.worldToGrid(playerPosition, this.playerCell);
      const nextCell = this.findNextPathCell(monsterCell, playerCell);
      if (nextCell >= 0) {
        const x = nextCell % this.options.gridSize;
        const y = Math.floor(nextCell / this.options.gridSize);
        this.routeTarget.copy(this.gridToWorld(x, y));
      }
      this.monsterPathTimer = 0.32;
    }

    this.moveVector.subVectors(this.routeTarget, root.position);
    this.moveVector.y = 0;
    const remaining = this.moveVector.length();
    const step = Math.min(remaining, 2.5 * deltaSeconds);
    if (remaining > 0.001) {
      this.moveVector.multiplyScalar(step / remaining);
      root.position.add(this.moveVector);
      root.rotation.y = Math.atan2(dx, dz);
    }

    if (distance <= MONSTER_TOUCH_DISTANCE) this.gameOver = true;
  }

  findNextPathCell(start, goal) {
    const size = this.options.gridSize;
    const startId = start.y * size + start.x;
    const goalId = goal.y * size + goal.x;
    if (startId === goalId) return goalId;

    const previous = this.pathPrevious;
    previous.fill(-2);
    const queue = this.pathQueue;
    let read = 0;
    let write = 0;
    queue[write++] = startId;
    previous[startId] = -1;

    while (read < write) {
      const current = queue[read++];
      if (current === goalId) break;
      const x = current % size;
      const y = Math.floor(current / size);
      for (let i = 0; i < GRID_DIRECTIONS.length; i += 1) {
        const nx = x + GRID_DIRECTIONS[i][0];
        const ny = y + GRID_DIRECTIONS[i][1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size || this.grid[ny][nx] !== 0) continue;
        const next = ny * size + nx;
        if (previous[next] !== -2) continue;
        previous[next] = current;
        queue[write++] = next;
      }
    }

    if (previous[goalId] === -2) return -1;
    let step = goalId;
    while (previous[step] !== startId && previous[step] >= 0) step = previous[step];
    return step;
  }

  worldToGrid(position, result = { x: 0, y: 0 }) {
    const half = (this.options.gridSize - 1) / 2;
    result.x = THREE.MathUtils.clamp(Math.round(position.x / this.options.tileSize + half), 1, this.options.gridSize - 2);
    result.y = THREE.MathUtils.clamp(Math.round(position.z / this.options.tileSize + half), 1, this.options.gridSize - 2);
    return result;
  }

  gridToWorld(x, y, height = 0) {
    const half = (this.options.gridSize - 1) / 2;
    return new THREE.Vector3(
      (x - half) * this.options.tileSize,
      height,
      (y - half) * this.options.tileSize,
    );
  }

  resolveCollision(position, previousPosition) {
    const radius = 0.32;
    if (!this.overlapsWall(position.x, position.z, radius)) return;
    const canKeepX = !this.overlapsWall(position.x, previousPosition.z, radius);
    const canKeepZ = !this.overlapsWall(previousPosition.x, position.z, radius);
    if (canKeepX) position.z = previousPosition.z;
    else if (canKeepZ) position.x = previousPosition.x;
    else {
      position.x = previousPosition.x;
      position.z = previousPosition.z;
    }
  }

  overlapsWall(worldX, worldZ, radius) {
    const { gridSize, tileSize } = this.options;
    const half = (gridSize - 1) / 2;
    const gridX = Math.round(worldX / tileSize + half);
    const gridY = Math.round(worldZ / tileSize + half);
    for (let y = gridY - 1; y <= gridY + 1; y += 1) {
      for (let x = gridX - 1; x <= gridX + 1; x += 1) {
        if (x < 0 || y < 0 || x >= gridSize || y >= gridSize || this.grid[y][x] === 0) continue;
        const centerX = (x - half) * tileSize;
        const centerZ = (y - half) * tileSize;
        if (Math.abs(worldX - centerX) < tileSize / 2 + radius && Math.abs(worldZ - centerZ) < tileSize / 2 + radius) return true;
      }
    }
    return false;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const item of this.disposables) item.dispose();
    this.lightStates.length = 0;
    this.flickerStates.length = 0;
    this.disposables.length = 0;
  }
}

function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function createLevel0Texture(kind) {
  const size = kind === 'carpet' ? 128 : 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { alpha: false });

  if (kind === 'wall') {
    context.fillStyle = '#cccc77';
    context.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 16) {
      context.fillStyle = 'rgba(102, 79, 45, 0.16)';
      context.fillRect(x, 0, 1.4, size);
      context.fillStyle = 'rgba(245, 224, 151, 0.17)';
      context.fillRect(x + 2, 0, 1, size);
    }
    for (let i = 0; i < 90; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      context.fillStyle = Math.random() > 0.5
        ? 'rgba(97, 79, 48, 0.035)'
        : 'rgba(255, 242, 184, 0.045)';
      context.fillRect(x, y, 2 + Math.random() * 13, 1 + Math.random() * 3);
    }
  } else if (kind === 'carpet') {
    context.fillStyle = '#776644';
    context.fillRect(0, 0, size, size);
    for (let i = 0; i < 1800; i += 1) {
      const tone = Math.random();
      context.fillStyle = tone > 0.72
        ? 'rgba(140, 137, 91, 0.22)'
        : tone > 0.35
          ? 'rgba(34, 39, 28, 0.2)'
          : 'rgba(191, 165, 111, 0.13)';
      const length = 1 + Math.random() * 2.5;
      context.fillRect(Math.random() * size, Math.random() * size, length, 1);
    }
    for (let i = 0; i < 14; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const radius = 5 + Math.random() * 15;
      const stain = context.createRadialGradient(x, y, 0, x, y, radius);
      stain.addColorStop(0, 'rgba(34, 39, 25, 0.22)');
      stain.addColorStop(1, 'rgba(34, 39, 25, 0)');
      context.fillStyle = stain;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  } else {
    context.fillStyle = '#aaa99f';
    context.fillRect(0, 0, size, size);
    context.fillStyle = 'rgba(231, 229, 215, 0.55)';
    context.fillRect(5, 5, size - 10, size - 10);
    context.strokeStyle = 'rgba(66, 66, 61, 0.48)';
    context.lineWidth = 4;
    context.strokeRect(2, 2, size - 4, size - 4);
    context.strokeStyle = 'rgba(255, 255, 245, 0.68)';
    context.lineWidth = 1;
    context.strokeRect(7, 7, size - 14, size - 14);
    context.fillStyle = 'rgba(97, 97, 88, 0.16)';
    for (let x = 22; x < size - 16; x += 18) {
      context.fillRect(x, size - 16, 2, 2);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 2;
  return texture;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rand) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
