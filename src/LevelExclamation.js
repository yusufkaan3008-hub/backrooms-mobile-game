import * as THREE from 'three';

const CORRIDOR_LENGTH = 620;
const CORRIDOR_END_Z = -590;
const BASE_FOV = 76;
const PLAYER_RUN_SPEED = 10.8;

/** Level !: asset-free, instanced escape corridor with a four-entity pursuit. */
export class LevelExclamation {
  constructor(scene, { isMobile = false } = {}) {
    this.scene = scene;
    this.isMobile = isMobile;
    this.group = new THREE.Group();
    this.group.name = 'Level ! — Run for Your Life';
    this.disposables = [];
    this.playerGroundY = 1.63;
    this.spawn = new THREE.Vector3(0, this.playerGroundY, 0);
    this.exitPosition = new THREE.Vector3(0, 2.4, CORRIDOR_END_Z);
    this.elapsed = 0;
    this.stunRemaining = 0;
    this.impactShake = 0;
    this.gameOver = false;
    this.escaped = false;
    this.endingPhase = 'run';
    this.endingElapsed = 0;
    this.fallVelocity = 0;
    this.hitObstacles = new Set();
    this.obstacles = [];
    this.monsters = [];
    this.alarmLights = [];
    this.previousFov = BASE_FOV;

    this.build();
    this.scene.add(this.group);
    this.scene.background = new THREE.Color(0x1c0307);
    // Lower density keeps the red atmosphere while leaving obstacles visible ahead.
    this.scene.fog = new THREE.FogExp2(0x280308, 0.0028);
  }

  build() {
    this.buildCorridor();
    this.buildAlarmLights();
    this.buildObstacles();
    this.buildHorde();
    this.buildExitLight();
  }

  buildCorridor() {
    const panelLength = 10;
    const panelCount = Math.ceil(CORRIDOR_LENGTH / panelLength);
    const wallGeometry = new THREE.BoxGeometry(0.16, 4.35, panelLength - 0.08);
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x64131a, roughness: 0.93, metalness: 0.02 });
    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, panelCount * 2);
    const ceilingGeometry = new THREE.BoxGeometry(10, 0.14, panelLength - 0.08);
    const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0x26090e, roughness: 1 });
    const ceiling = new THREE.InstancedMesh(ceilingGeometry, ceilingMaterial, panelCount);
    const dummy = new THREE.Object3D();

    for (let index = 0; index < panelCount; index += 1) {
      const z = 5 - index * panelLength;
      for (const side of [-1, 1]) {
        dummy.position.set(side * 4.95, 2.15, z);
        dummy.updateMatrix();
        walls.setMatrixAt(index * 2 + (side > 0 ? 1 : 0), dummy.matrix);
      }
      dummy.position.set(0, 4.28, z);
      dummy.updateMatrix();
      ceiling.setMatrixAt(index, dummy.matrix);
    }
    for (const mesh of [walls, ceiling]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      mesh.receiveShadow = true;
    }
    walls.castShadow = true;
    this.group.add(walls, ceiling);

    const floorGeometry = new THREE.BoxGeometry(10, 0.14, CORRIDOR_LENGTH);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x321316, roughness: 0.94, metalness: 0.01 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.set(0, -0.08, -CORRIDOR_LENGTH / 2 + 5);
    floor.receiveShadow = true;
    this.group.add(floor);

    this.disposables.push(wallGeometry, wallMaterial, ceilingGeometry, ceilingMaterial, floorGeometry, floorMaterial);
  }

  buildAlarmLights() {
    const fixtureCount = 52;
    const fixtureGeometry = new THREE.BoxGeometry(0.86, 0.12, 0.68);
    const fixtureMaterial = new THREE.MeshBasicMaterial({ color: 0xff2229, toneMapped: false });
    const fixtures = new THREE.InstancedMesh(fixtureGeometry, fixtureMaterial, fixtureCount);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < fixtureCount; index += 1) {
      dummy.position.set(0, 4.16, -4 - index * 11.5);
      dummy.updateMatrix();
      fixtures.setMatrixAt(index, dummy.matrix);
    }
    fixtures.instanceMatrix.needsUpdate = true;
    fixtures.computeBoundingSphere();
    fixtures.frustumCulled = true;
    this.group.add(fixtures);
    this.disposables.push(fixtureGeometry, fixtureMaterial);

    // A fixed eight-light budget gives the alarm real spill without hundreds of lights.
    for (let index = 0; index < 8; index += 1) {
      const light = new THREE.PointLight(0xff1822, 78, 62, 2);
      light.position.set(index % 2 ? 3.1 : -3.1, 3.65, -18 - index * 78);
      this.group.add(light);
      this.alarmLights.push({ light, phase: index * 1.43, baseIntensity: 78 });
      this.disposables.push(light);
    }
  }

  buildObstacles() {
    const laneX = [-2.55, 0, 2.55];
    const patterns = [[0, 2], [0, 1], [1, 2], [0], [2], [1, 2], [0, 1], [1]];
    const transforms = [];
    const geometry = new THREE.BoxGeometry(1.65, 1.45, 1.9);
    const material = new THREE.MeshStandardMaterial({ color: 0x21191b, roughness: 0.96, metalness: 0.02 });
    const dummy = new THREE.Object3D();
    const stations = 42;

    for (let station = 0; station < stations; station += 1) {
      if (this.isMobile && station % 2 === 1) continue;
      const z = -16 - station * 13.2;
      const pattern = patterns[station % patterns.length];
      for (const lane of pattern) {
        const x = laneX[lane];
        const scaleY = station % 3 === 0 ? 1.05 : 0.78 + (station % 4) * 0.08;
        dummy.position.set(x, scaleY * 0.72, z);
        dummy.rotation.set(0, ((station % 3) - 1) * 0.12, 0);
        dummy.scale.set(0.82 + (station % 3) * 0.1, scaleY, 0.78 + (station % 2) * 0.12);
        dummy.updateMatrix();
        transforms.push(dummy.matrix.clone());
        this.obstacles.push({ x, z, halfX: 0.82 * dummy.scale.x, halfZ: 0.95 * dummy.scale.z });
      }
    }

    const obstacleMesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    transforms.forEach((matrix, index) => obstacleMesh.setMatrixAt(index, matrix));
    obstacleMesh.instanceMatrix.needsUpdate = true;
    obstacleMesh.computeBoundingSphere();
    obstacleMesh.frustumCulled = true;
    obstacleMesh.castShadow = true;
    obstacleMesh.receiveShadow = true;
    obstacleMesh.name = 'Instanced hospital beds, carts and toppled cabinets';
    this.group.add(obstacleMesh);
    this.disposables.push(geometry, material);
  }

  buildHorde() {
    const coreGeometry = new THREE.IcosahedronGeometry(0.56, 1);
    coreGeometry.scale(0.78, 2.5, 0.72);
    const tendrilGeometries = [
      tube([[0, 2.1, 0], [-0.38, 1.8, 0.08], [-0.88, 1.42, 0.28], [-1.12, 1.06, 0.36]]),
      tube([[0, 1.8, 0], [0.42, 1.45, -0.04], [0.74, 1.06, -0.22], [0.58, 0.72, -0.4]]),
      tube([[0.04, 1.3, -0.02], [-0.24, 0.98, -0.36], [-0.52, 0.63, -0.62], [-0.24, 0.3, -0.72]]),
      tube([[-0.04, 1.14, 0.08], [0.26, 0.83, 0.38], [0.47, 0.5, 0.52], [0.82, 0.3, 0.44]]),
    ];
    const black = new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 1, metalness: 0 });
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff1b10, toneMapped: false });
    const eyeGeometry = new THREE.SphereGeometry(0.075, 7, 6);
    const starts = this.isMobile
      ? [
          { x: -1.5, gap: 36 },
          { x: 1.45, gap: 46 },
          { x: -2.35, gap: 56 },
          { x: 2.3, gap: 66 },
        ]
      : [
          { x: -1.5, gap: 24 },
          { x: 1.45, gap: 32 },
          { x: -2.35, gap: 40 },
          { x: 2.3, gap: 48 },
        ];

    starts.forEach((start, index) => {
      const root = new THREE.Group();
      const core = new THREE.Mesh(coreGeometry, black);
      core.position.y = 1.55;
      core.castShadow = true;
      root.add(core);
      tendrilGeometries.forEach((geometry) => {
        const tendril = new THREE.Mesh(geometry, black);
        tendril.castShadow = true;
        root.add(tendril);
      });
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        eye.position.set(side * 0.16, 2.54, -0.38);
        root.add(eye);
      }
      root.position.set(start.x, 0, start.gap);
      root.name = `Entity 0 horde member ${index + 1}`;
      this.group.add(root);
      const speed = this.isMobile ? 9.55 + index * 0.07 : 10.35 + index * 0.08;
      this.monsters.push({ root, speed, laneBias: start.x * 0.18, phase: index * 2.1 });
    });

    this.disposables.push(coreGeometry, ...tendrilGeometries, black, eyeMaterial, eyeGeometry);
  }

  buildExitLight() {
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const glowGeometry = new THREE.SphereGeometry(9.5, 22, 16);
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.copy(this.exitPosition);
    glow.name = 'Blinding white exit light';
    this.group.add(glow);

    const light = new THREE.PointLight(0xffffff, 1400, 220, 1.4);
    light.position.copy(glow.position);
    this.group.add(light);
    this.disposables.push(glowGeometry, glowMaterial, light);
  }

  update(deltaSeconds, camera, keys) {
    if (this.gameOver || this.escaped) return this.gameOver ? 'gameOver' : 'escaped';
    const delta = Math.min(deltaSeconds, 0.05);
    if (this.endingPhase !== 'run') return this.updateEnding(delta, camera);
    this.elapsed += delta;

    const strafeAxis = Number(keys.has('KeyD') || keys.has('ArrowRight'))
      - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    camera.position.x += strafeAxis * 7.1 * delta;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -4.15, 4.15);
    camera.position.y = this.playerGroundY;

    const wasStunned = this.stunRemaining > 0;
    if (wasStunned) this.stunRemaining = Math.max(0, this.stunRemaining - delta);
    camera.position.z -= PLAYER_RUN_SPEED * (wasStunned ? 0.28 : 1) * delta;

    for (let index = 0; index < this.obstacles.length; index += 1) {
      const obstacle = this.obstacles[index];
      const hit = Math.abs(camera.position.z - obstacle.z) < obstacle.halfZ + 0.42
        && Math.abs(camera.position.x - obstacle.x) < obstacle.halfX + 0.32;
      if (hit && !this.hitObstacles.has(index)) {
        this.hitObstacles.add(index);
        this.stunRemaining = 1.05;
        this.impactShake = 1;
      }
    }

    let closestGap = Infinity;
    for (const monster of this.monsters) {
      const targetX = THREE.MathUtils.clamp(camera.position.x * 0.72 + monster.laneBias, -3.7, 3.7);
      monster.root.position.x += (targetX - monster.root.position.x) * Math.min(1, delta * 1.35);
      monster.root.position.z -= monster.speed * delta;
      monster.root.rotation.z = Math.sin(this.elapsed * 8 + monster.phase) * 0.08;
      const gap = monster.root.position.z - camera.position.z;
      closestGap = Math.min(closestGap, gap);
      if (gap < 1.25 && Math.abs(monster.root.position.x - camera.position.x) < 0.92) {
        this.gameOver = true;
      }
    }

    for (const state of this.alarmLights) {
      const pulse = 0.62 + 0.38 * Math.max(0, Math.sin(this.elapsed * 8.3 + state.phase));
      const dropout = Math.sin(this.elapsed * 27 + state.phase) > 0.985 ? 0.12 : 1;
      state.light.intensity = state.baseIntensity * pulse * dropout;
    }

    const panic = THREE.MathUtils.clamp(1 - closestGap / 28, 0, 1);
    const fov = BASE_FOV + 1.5 * Math.sin(this.elapsed * 5.5) + panic * 5.5;
    if (Math.abs(fov - this.previousFov) > 0.025) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      this.previousFov = fov;
    }
    this.impactShake = Math.max(0, this.impactShake - delta * 1.8);
    camera.rotation.z = Math.sin(this.elapsed * 31) * (0.001 + panic * 0.004) + Math.sin(this.elapsed * 61) * this.impactShake * 0.006;

    if (camera.position.distanceToSquared(this.exitPosition) <= 9.5 * 9.5) {
      this.beginSkyfall(camera);
    }
    if (this.gameOver) return 'gameOver';
    return null;
  }

  beginSkyfall(camera) {
    if (this.endingPhase !== 'run') return;
    this.endingPhase = 'fall';
    this.endingElapsed = 0;
    this.fallVelocity = 0;

    this.scene.remove(this.group);
    for (const item of this.disposables) item.dispose?.();
    this.disposables.length = 0;

    this.endingGroup = new THREE.Group();
    this.endingGroup.name = 'Skyfall highway ending';
    this.scene.add(this.endingGroup);
    this.scene.background = new THREE.Color(0x91b9d4);
    this.scene.fog = new THREE.Fog(0xa8c9dc, 300, 1150);

    const skyLight = new THREE.HemisphereLight(0xe4f5ff, 0x56515b, 1.65);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    sun.position.set(-90, 220, 80);
    this.endingGroup.add(skyLight, sun);

    const road = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.35, 1100),
      new THREE.MeshStandardMaterial({ color: 0x36393c, roughness: 0.95 }),
    );
    road.position.set(0, -0.18, -330);
    this.endingGroup.add(road);

    const lineGeometry = new THREE.BoxGeometry(0.16, 0.025, 13);
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xe8dfbd });
    const lineCount = 58;
    const laneMarks = new THREE.InstancedMesh(lineGeometry, lineMaterial, lineCount * 2);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < lineCount; index += 1) {
      for (let lane = 0; lane < 2; lane += 1) {
        dummy.position.set(lane === 0 ? -3.9 : 3.9, 0.015, 180 - index * 18);
        dummy.updateMatrix();
        laneMarks.setMatrixAt(index * 2 + lane, dummy.matrix);
      }
    }
    laneMarks.instanceMatrix.needsUpdate = true;
    laneMarks.computeBoundingSphere();
    this.endingGroup.add(laneMarks);

    const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x777a77, roughness: 1 });
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 1100), shoulderMaterial);
      shoulder.position.set(side * 14, -0.2, -330);
      this.endingGroup.add(shoulder);
    }

    const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0xf1f5f4, transparent: true, opacity: 0.78 });
    const cloudGeometry = new THREE.IcosahedronGeometry(1, 1);
    for (let index = 0; index < 15; index += 1) {
      const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
      cloud.position.set(Math.sin(index * 9.2) * 95, 235 + (index % 3) * 5, -index * 46 - 120);
      cloud.scale.set(34 + (index % 4) * 9, 5 + (index % 3) * 2, 24 + (index % 5) * 6);
      this.endingGroup.add(cloud);
    }

    this.car = new THREE.Group();
    const carBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x171a1c, metalness: 0.35, roughness: 0.42 });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x263943, metalness: 0.18, roughness: 0.16 });
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.95 });
    const carBody = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.85, 4.8), carBodyMaterial);
    carBody.position.y = 0.88;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.78, 2.2), glassMaterial);
    cabin.position.set(0, 1.58, -0.25);
    this.car.add(carBody, cabin);
    const wheelGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 10);
    for (const x of [-1.25, 1.25]) {
      for (const z of [-1.55, 1.55]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.48, z);
        this.car.add(wheel);
      }
    }
    const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0c6, toneMapped: false });
    for (const x of [-0.88, 0.88]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.06), headlightMaterial);
      headlight.position.set(x, 0.98, -2.43);
      this.car.add(headlight);
    }
    this.car.position.set(0, 0, 110);
    this.endingGroup.add(this.car);

    this.flashMaterial = new THREE.MeshBasicMaterial({ color: 0x97000d, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.flashMaterial);
    this.flashMesh.position.set(0, 0, -0.6);
    this.flashMesh.renderOrder = 1000;
    camera.add(this.flashMesh);
    this.endingPhase = 'reveal';
    this.endingElapsed = 0;
    this.flashMaterial.color.setHex(0xffffff);
    this.flashMaterial.opacity = 1;

    camera.position.set(0, 300, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(-1.28, 0, 0);
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
  }

  updateEnding(delta, camera) {
    this.endingElapsed += delta;
    if (this.endingPhase === 'reveal') {
      this.flashMaterial.opacity = Math.max(0, 1 - this.endingElapsed / 0.22);
      if (this.endingElapsed >= 0.22) {
        this.endingPhase = 'fall';
        this.endingElapsed = 0;
      }
    } else if (this.endingPhase === 'fall') {
      this.fallVelocity = Math.min(this.fallVelocity + 38 * delta, 145);
      camera.position.y = Math.max(3, camera.position.y - this.fallVelocity * delta);
      camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, -1.43, Math.min(1, delta * 1.2));
      if (camera.position.y <= 18) {
        camera.position.y = 3;
        this.endingPhase = 'carApproach';
        this.endingElapsed = 0;
      }
    } else if (this.endingPhase === 'carApproach') {
      this.car.position.z -= 82 * delta;
      if (this.car.position.z <= 3.5) {
        this.endingPhase = 'impact';
        this.endingElapsed = 0;
        this.flashMaterial.color.setHex(0xb10010);
        this.flashMaterial.opacity = 1;
      }
    } else if (this.endingPhase === 'impact') {
      const shake = Math.max(0, 1 - this.endingElapsed * 2.1);
      camera.rotation.z = Math.sin(this.endingElapsed * 75) * 0.11 * shake;
      camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, -0.35, Math.min(1, delta * 1.4));
      camera.position.y = Math.max(0.35, camera.position.y - 5 * delta);
      if (this.endingElapsed > 0.55) {
        this.endingPhase = 'blackout';
        this.endingElapsed = 0;
        this.flashMaterial.color.setHex(0x020102);
        this.flashMaterial.opacity = 1;
      }
    } else if (this.endingPhase === 'blackout') {
      this.flashMaterial.opacity = Math.min(1, this.endingElapsed * 3);
      if (this.endingElapsed > 1.25) return 'ending';
    }
    return null;
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.endingGroup) {
      this.scene.remove(this.endingGroup);
      this.endingGroup.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
        else object.material?.dispose?.();
      });
    }
    if (this.flashMesh?.parent) {
      this.flashMesh.parent.remove(this.flashMesh);
      this.flashMesh.geometry.dispose();
      this.flashMesh.material.dispose();
    }
    for (const item of this.disposables) item.dispose?.();
    this.disposables.length = 0;
  }
}

function tube(points) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.TubeGeometry(curve, 10, 0.075, 5, false);
}
