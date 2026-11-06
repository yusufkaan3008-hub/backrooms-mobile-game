import * as THREE from 'three';

const DAY_CYCLE_SECONDS = 20 * 60;
const HOUSE_COUNT = 9;
const HOUSE_PITCH = 16;
const HOUSE_WIDTH = 6.2;
const HOUSE_CHUNK_SIDE = 3;
const CITY_SPAN = HOUSE_COUNT * HOUSE_PITCH + 18;

const SKY_DAY = new THREE.Color(0x86b8d5);
const SKY_DUSK = new THREE.Color(0xe28b6b);
const SKY_NIGHT = new THREE.Color(0x090b20);
const FOG_DAY = new THREE.Color(0x86b8d5);
const FOG_NIGHT = new THREE.Color(0x101225);

/** Level 94: instanced suburbia with a smooth 20-minute day/night cycle. */
export class Level94 {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Level 94 — Suburbia';
    this.disposables = [];
    this.elapsedSeconds = 0;
    this.sunShadowTimer = 0;
    this.playerGroundY = 1.58;
    this.spawn = new THREE.Vector3(0, this.playerGroundY, 8);
    this.beacon = new THREE.Vector3(0, 0, 0);
    this.interiorSpawn = new THREE.Vector3(0, this.playerGroundY, 8);
    this.basementDoorPosition = new THREE.Vector3(0, 1.1, -12.85);
    this.isInterior = false;

    this.skyColor = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.daySunColor = new THREE.Color(0xffedc7);
    this.duskSunColor = new THREE.Color(0xff8e5c);
    this.nightSunColor = new THREE.Color(0x31395f);
    this.dayGroundColor = new THREE.Color(0x718653);
    this.nightGroundColor = new THREE.Color(0x202a30);
    this.dayRoadColor = new THREE.Color(0x85858a);
    this.nightRoadColor = new THREE.Color(0x343746);
    this.daySidewalkColor = new THREE.Color(0x777a7a);
    this.nightSidewalkColor = new THREE.Color(0x30333d);
    this.dayHouseColor = new THREE.Color(0xbab5a8);
    this.nightHouseColor = new THREE.Color(0x37394c);
    this.dayLampColor = new THREE.Color(0x242632);
    this.nightLampColor = new THREE.Color(0xffd99c);

    this.streetLights = [];
    this.textures = createSuburbiaTextures();
    this.disposables.push(...Object.values(this.textures));
    this.build();
    this.scene.add(this.group, this.interiorGroup);
    this.scene.background = this.skyColor.copy(SKY_DAY);
    this.scene.fog = new THREE.FogExp2(FOG_DAY, 0.0014);
    this.applyCycleState(0);
  }

  build() {
    this.addGroundAndRoads();
    this.addHomes();
    this.addSunAndMoon();
    this.addStreetLights();
    this.addBeacon();
    this.addInterior();
  }

  addGroundAndRoads() {
    const groundGeometry = new THREE.PlaneGeometry(CITY_SPAN * 1.5, CITY_SPAN * 1.5);
    this.groundMaterial = new THREE.MeshStandardMaterial({ color: this.dayGroundColor, roughness: 1 });
    const ground = new THREE.Mesh(groundGeometry, this.groundMaterial);
    ground.name = 'Suburbia grass and soil';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(groundGeometry, this.groundMaterial);

    this.roadMaterial = new THREE.MeshStandardMaterial({
      color: this.dayRoadColor,
      map: this.textures.asphalt,
      roughness: 0.88,
      metalness: 0.04,
    });
    const roadCoordinates = [];
    for (let index = 0; index < HOUSE_COUNT - 1; index += 1) {
      roadCoordinates.push((index - (HOUSE_COUNT - 2) / 2) * HOUSE_PITCH);
    }

    const verticalRoadGeometry = new THREE.PlaneGeometry(5.8, CITY_SPAN);
    verticalRoadGeometry.rotateX(-Math.PI / 2);
    const verticalRoads = this.makeInstances(
      verticalRoadGeometry,
      this.roadMaterial,
      roadCoordinates.map((x) => transform(x, -0.075, 0)),
      'North–south asphalt roads',
      false,
      true,
    );
    this.group.add(verticalRoads);

    const horizontalRoadGeometry = new THREE.PlaneGeometry(CITY_SPAN, 5.8);
    horizontalRoadGeometry.rotateX(-Math.PI / 2);
    const horizontalRoads = this.makeInstances(
      horizontalRoadGeometry,
      this.roadMaterial,
      roadCoordinates.map((z) => transform(0, -0.074, z)),
      'East–west asphalt roads',
      false,
      true,
    );
    this.group.add(horizontalRoads);

    this.sidewalkMaterial = new THREE.MeshStandardMaterial({
      color: this.daySidewalkColor,
      map: this.textures.sidewalk,
      roughness: 0.94,
      metalness: 0.02,
    });
    const sidewalkOffset = 3.8;
    const verticalWalkGeometry = new THREE.PlaneGeometry(1.15, CITY_SPAN);
    verticalWalkGeometry.rotateX(-Math.PI / 2);
    const verticalWalks = this.makeInstances(
      verticalWalkGeometry,
      this.sidewalkMaterial,
      roadCoordinates.flatMap((x) => [
        transform(x - sidewalkOffset, -0.065, 0),
        transform(x + sidewalkOffset, -0.065, 0),
      ]),
      'North–south sidewalks',
      false,
      true,
    );
    this.group.add(verticalWalks);

    const horizontalWalkGeometry = new THREE.PlaneGeometry(CITY_SPAN, 1.15);
    horizontalWalkGeometry.rotateX(-Math.PI / 2);
    const horizontalWalks = this.makeInstances(
      horizontalWalkGeometry,
      this.sidewalkMaterial,
      roadCoordinates.flatMap((z) => [
        transform(0, -0.064, z - sidewalkOffset),
        transform(0, -0.064, z + sidewalkOffset),
      ]),
      'East–west sidewalks',
      false,
      true,
    );
    this.group.add(horizontalWalks);

    this.disposables.push(
      verticalRoadGeometry,
      horizontalRoadGeometry,
      verticalWalkGeometry,
      horizontalWalkGeometry,
      this.sidewalkMaterial,
    );
  }

  addHomes() {
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-HOUSE_WIDTH / 2, 0);
    gableShape.lineTo(HOUSE_WIDTH / 2, 0);
    gableShape.lineTo(0, 2.35);
    gableShape.closePath();

    const roofShape = new THREE.Shape();
    roofShape.moveTo(-4.35, 0);
    roofShape.lineTo(4.35, 0);
    roofShape.lineTo(0, 2.65);
    roofShape.closePath();

    const geometry = {
      body: new THREE.BoxGeometry(HOUSE_WIDTH, 3.6, HOUSE_WIDTH),
      roof: new THREE.ExtrudeGeometry(roofShape, { depth: 6.65, bevelEnabled: false }),
      gable: new THREE.ShapeGeometry(gableShape),
      door: new THREE.BoxGeometry(1, 2.2, 0.1),
      frontWindow: new THREE.BoxGeometry(1.12, 1.05, 0.08),
      sideWindow: new THREE.BoxGeometry(0.08, 1.05, 1.12),
      atticWindow: new THREE.BoxGeometry(0.48, 0.48, 0.06),
      chimney: new THREE.BoxGeometry(0.5, 1.4, 0.5),
      porchStep: new THREE.BoxGeometry(1.5, 0.22, 0.58),
    };
    geometry.roof.translate(0, 3.55, -3.325);

    // The shared box UVs cover each face once. Repetition keeps siding and roof
    // tiles at believable scale across all 81 instanced houses.
    this.textures.siding.repeat.set(2.8, 1.65);
    this.textures.roof.repeat.set(2.2, 2.2);

    this.houseMaterials = {
      body: new THREE.MeshStandardMaterial({
        color: this.dayHouseColor,
        map: this.textures.siding,
        roughness: 0.9,
        metalness: 0.1,
      }),
      roof: new THREE.MeshStandardMaterial({
        color: 0x777078,
        map: this.textures.roof,
        roughness: 0.94,
        metalness: 0.02,
      }),
      gable: new THREE.MeshStandardMaterial({
        color: this.dayHouseColor,
        map: this.textures.siding,
        roughness: 0.9,
        metalness: 0.1,
      }),
      door: new THREE.MeshStandardMaterial({
        color: 0x62524e,
        map: this.textures.siding,
        roughness: 0.9,
        metalness: 0.1,
      }),
      windows: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: this.textures.windowGlass,
        emissiveMap: this.textures.windowGlow,
        emissive: 0xffd184,
        emissiveIntensity: 0,
        roughness: 0.28,
        metalness: 0.12,
      }),
      chimney: new THREE.MeshStandardMaterial({ color: 0x464550, roughness: 0.98 }),
      porch: new THREE.MeshStandardMaterial({ color: 0x676b72, roughness: 0.96 }),
    };
    this.disposables.push(...Object.values(geometry), ...Object.values(this.houseMaterials));

    const chunks = new Map();
    const center = (HOUSE_COUNT - 1) / 2;
    for (let row = 0; row < HOUSE_COUNT; row += 1) {
      for (let column = 0; column < HOUSE_COUNT; column += 1) {
        const key = `${Math.floor(column / HOUSE_CHUNK_SIDE)}:${Math.floor(row / HOUSE_CHUNK_SIDE)}`;
        let chunk = chunks.get(key);
        if (!chunk) {
          chunk = { body: [], roof: [], gable: [], door: [], frontWindows: [], sideWindows: [], atticWindows: [], chimney: [], porch: [] };
          chunks.set(key, chunk);
        }

        const x = (column - center) * HOUSE_PITCH;
        const z = (row - center) * HOUSE_PITCH;
        chunk.body.push(transform(x, 1.8, z));
        chunk.roof.push(transform(x, 0, z));
        chunk.gable.push(
          transform(x, 3.6, z + 3.35),
          transform(x, 3.6, z - 3.35, Math.PI),
        );
        chunk.door.push(transform(x, 1.1, z + HOUSE_WIDTH / 2 + 0.075));
        chunk.frontWindows.push(
          transform(x - 1.72, 2.25, z + HOUSE_WIDTH / 2 + 0.07),
          transform(x + 1.72, 2.25, z + HOUSE_WIDTH / 2 + 0.07),
        );
        chunk.sideWindows.push(
          transform(x - HOUSE_WIDTH / 2 - 0.07, 2.25, z),
          transform(x + HOUSE_WIDTH / 2 + 0.07, 2.25, z),
        );
        chunk.atticWindows.push(transform(x, 4.7, z + 3.39));
        chunk.chimney.push(transform(x + 1.75, 4.85, z - 1.3));
        chunk.porch.push(transform(x, 0.12, z + HOUSE_WIDTH / 2 + 0.42));
      }
    }

    for (const [key, chunk] of chunks) {
      const block = new THREE.Group();
      block.name = `Suburbia house block ${key}`;
      block.add(this.makeInstances(geometry.body, this.houseMaterials.body, chunk.body, `House walls ${key}`, true, true));
      block.add(this.makeInstances(geometry.roof, this.houseMaterials.roof, chunk.roof, `Gabled roofs ${key}`, true, true));
      block.add(this.makeInstances(geometry.gable, this.houseMaterials.gable, chunk.gable, `Gable ends ${key}`, true, true));
      block.add(this.makeInstances(geometry.door, this.houseMaterials.door, chunk.door, `Front doors ${key}`, true, true));
      block.add(this.makeInstances(geometry.frontWindow, this.houseMaterials.windows, chunk.frontWindows, `Front windows ${key}`, false, true));
      block.add(this.makeInstances(geometry.sideWindow, this.houseMaterials.windows, chunk.sideWindows, `Side windows ${key}`, false, true));
      block.add(this.makeInstances(geometry.atticWindow, this.houseMaterials.windows, chunk.atticWindows, `Attic windows ${key}`, false, true));
      block.add(this.makeInstances(geometry.chimney, this.houseMaterials.chimney, chunk.chimney, `Chimneys ${key}`, true, true));
      block.add(this.makeInstances(geometry.porchStep, this.houseMaterials.porch, chunk.porch, `Porch steps ${key}`, true, true));
      this.group.add(block);
    }
  }

  addSunAndMoon() {
    this.hemisphere = new THREE.HemisphereLight(0xb9d4e8, 0x5b604d, 0.78);
    this.hemisphere.name = 'Daylight sky fill';
    this.group.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight(this.daySunColor, 1.35);
    this.sun.name = 'Moving day/night sun';
    this.sun.position.set(0, 72, 24);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -88;
    this.sun.shadow.camera.right = 88;
    this.sun.shadow.camera.top = 88;
    this.sun.shadow.camera.bottom = -88;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 180;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.radius = 1;
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.needsUpdate = true;
    this.group.add(this.sun, this.sun.target);
    this.disposables.push(this.sun.target);

    this.moonMaterial = new THREE.MeshBasicMaterial({
      color: 0xe7e0c8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 18), this.moonMaterial);
    this.moon.name = 'Artificial full moon';
    this.moon.position.set(0, 39, -53);
    this.group.add(this.moon);
    this.disposables.push(this.moon.geometry, this.moonMaterial);

    this.moonHaloMaterial = new THREE.MeshBasicMaterial({
      color: 0x7681b8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(12, 18, 14), this.moonHaloMaterial);
    halo.position.copy(this.moon.position);
    halo.renderOrder = 1;
    this.group.add(halo);
    this.disposables.push(halo.geometry, this.moonHaloMaterial);

    this.moonFill = new THREE.DirectionalLight(0x929ecb, 0.16);
    this.moonFill.name = 'Cold moon fill';
    this.moonFill.position.set(0, 35, -45);
    this.group.add(this.moonFill);
  }

  addStreetLights() {
    const positions = [
      { x: -48, z: -56 }, { x: -16, z: -56 }, { x: 16, z: -56 }, { x: 48, z: -56 },
      { x: -56, z: 40 }, { x: -24, z: 40 }, { x: 8, z: 40 }, { x: 40, z: 40 },
    ];

    const poleGeometry = new THREE.CylinderGeometry(0.075, 0.13, 6.8, 6);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x252633, roughness: 0.85, metalness: 0.15 });
    const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, positions.length);
    const dummy = new THREE.Object3D();
    positions.forEach((point, index) => {
      dummy.position.set(point.x, 3.4, point.z);
      dummy.updateMatrix();
      poles.setMatrixAt(index, dummy.matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    poles.computeBoundingSphere();
    poles.frustumCulled = true;
    poles.castShadow = true;
    this.group.add(poles);
    this.disposables.push(poleGeometry, poleMaterial);

    const headGeometry = new THREE.BoxGeometry(0.58, 0.14, 0.42);
    this.lampHeadMaterial = new THREE.MeshBasicMaterial({ color: this.dayLampColor, toneMapped: false });
    const heads = new THREE.InstancedMesh(headGeometry, this.lampHeadMaterial, positions.length);
    positions.forEach((point, index) => {
      dummy.position.set(point.x, 6.82, point.z);
      dummy.updateMatrix();
      heads.setMatrixAt(index, dummy.matrix);
    });
    heads.instanceMatrix.needsUpdate = true;
    heads.computeBoundingSphere();
    heads.frustumCulled = true;
    this.group.add(heads);
    this.disposables.push(headGeometry, this.lampHeadMaterial);

    positions.forEach((point, index) => {
      const spotlight = new THREE.SpotLight(0xffd49a, 0, 28, 0.53, 0.58, 2);
      spotlight.position.set(point.x, 6.75, point.z);
      spotlight.target.position.set(point.x, 0, point.z + 2.5);
      spotlight.castShadow = index < 2;
      if (spotlight.castShadow) {
        spotlight.shadow.mapSize.set(512, 512);
        spotlight.shadow.camera.near = 0.5;
        spotlight.shadow.camera.far = 30;
        spotlight.shadow.bias = -0.0008;
        spotlight.shadow.radius = 1;
        spotlight.shadow.autoUpdate = false;
        spotlight.shadow.needsUpdate = true;
      }
      this.group.add(spotlight, spotlight.target);
      this.streetLights.push({ light: spotlight, baseIntensity: 230, index });
      this.disposables.push(spotlight.target);
    });
  }

  addBeacon() {
    const redGlass = new THREE.MeshBasicMaterial({ color: 0xff160e, toneMapped: false });
    const paneGeometry = new THREE.PlaneGeometry(1.08, 1.02);
    const doorCrackGeometry = new THREE.BoxGeometry(0.045, 1.9, 0.035);
    const atticGeometry = new THREE.PlaneGeometry(0.48, 0.48);
    const beaconX = this.beacon.x;
    const beaconZ = this.beacon.z;

    for (const xOffset of [-1.72, 1.72]) {
      const pane = new THREE.Mesh(paneGeometry, redGlass);
      pane.position.set(beaconX + xOffset, 2.25, beaconZ + HOUSE_WIDTH / 2 + 0.13);
      pane.name = 'Beacon house red window';
      this.group.add(pane);
    }
    const atticPane = new THREE.Mesh(atticGeometry, redGlass);
    atticPane.position.set(beaconX, 4.7, beaconZ + 3.46);
    this.group.add(atticPane);
    const doorCrack = new THREE.Mesh(doorCrackGeometry, redGlass);
    doorCrack.position.set(beaconX, 1.08, beaconZ + HOUSE_WIDTH / 2 + 0.17);
    this.group.add(doorCrack);

    const redPoint = new THREE.PointLight(0xff1008, 240, 105, 2);
    redPoint.position.set(beaconX, 2.4, beaconZ + 1.5);
    redPoint.name = 'Beacon house red spill';
    this.group.add(redPoint);

    const redSpot = new THREE.SpotLight(0xff160e, 190, 110, 0.38, 0.55, 2);
    redSpot.position.set(beaconX, 2.25, beaconZ + 2.65);
    redSpot.target.position.set(beaconX, 1.2, beaconZ + 38);
    redSpot.name = 'Beacon house outward beam';
    this.group.add(redSpot, redSpot.target);

    this.disposables.push(paneGeometry, doorCrackGeometry, atticGeometry, redGlass, redPoint, redSpot, redSpot.target);
  }

  addInterior() {
    this.interiorGroup = new THREE.Group();
    this.interiorGroup.name = 'Beacon house empty interior';
    this.interiorGroup.visible = false;

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xb0a799,
      map: this.textures.interior,
      roughness: 0.96,
    });
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f665d,
      map: this.textures.interiorFloor,
      roughness: 0.98,
    });
    const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0x8f887e, roughness: 0.98 });
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x342622, roughness: 0.94 });
    const redCrackMaterial = new THREE.MeshBasicMaterial({ color: 0xff180d, toneMapped: false });

    const addBox = (name, width, height, depth, x, y, z, material) => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.interiorGroup.add(mesh);
      this.disposables.push(geometry);
      return mesh;
    };

    addBox('Empty house floor', 8, 0.16, 24, 0, -0.08, -1, floorMaterial);
    addBox('Low ceiling', 8, 0.14, 24, 0, 2.76, -1, ceilingMaterial);
    addBox('Left exterior wall', 0.16, 2.72, 24, -3.92, 1.35, -1, wallMaterial);
    addBox('Right exterior wall', 0.16, 2.72, 24, 3.92, 1.35, -1, wallMaterial);

    // Entry opening and divided, empty side rooms keep the interior cramped.
    addBox('Entry wall left', 3, 2.72, 0.16, -2.5, 1.35, 10.95, wallMaterial);
    addBox('Entry wall right', 3, 2.72, 0.16, 2.5, 1.35, 10.95, wallMaterial);
    addBox('Entry wall header', 2, 0.44, 0.16, 0, 2.5, 10.95, wallMaterial);
    for (const x of [-1.65, 1.65]) {
      addBox('Side room partition', 0.12, 2.7, 12.4, x, 1.35, -3.7, wallMaterial);
      addBox('Side room divider', 2.2, 2.7, 0.12, x < 0 ? -2.75 : 2.75, 1.35, 3.3, wallMaterial);
    }

    addBox('Far wall left of basement door', 3.05, 2.72, 0.16, -2.48, 1.35, -12.95, wallMaterial);
    addBox('Far wall right of basement door', 3.05, 2.72, 0.16, 2.48, 1.35, -12.95, wallMaterial);
    addBox('Basement door header', 1.9, 0.48, 0.16, 0, 2.48, -12.95, wallMaterial);

    const basementDoor = addBox('Basement door · E to open', 1.84, 2.15, 0.12, 0, 1.08, -12.86, doorMaterial);
    basementDoor.userData.interactive = true;
    addBox('Red light under basement door', 1.55, 0.035, 0.035, 0, 0.22, -12.78, redCrackMaterial);

    const interiorRedLight = new THREE.PointLight(0xa51a12, 5.5, 16, 2);
    interiorRedLight.position.set(0, 2.25, -5.2);
    this.interiorGroup.add(interiorRedLight);

    this.disposables.push(wallMaterial, floorMaterial, ceilingMaterial, doorMaterial, redCrackMaterial, interiorRedLight);
  }

  shouldEnterInterior(position) {
    return !this.isInterior
      && Math.abs(position.x - this.beacon.x) < 0.68
      && position.z < this.beacon.z + 3.25
      && position.z > this.beacon.z + 1.9;
  }

  enterInterior() {
    this.isInterior = true;
    this.group.visible = false;
    this.interiorGroup.visible = true;
    this.scene.background = new THREE.Color(0x171311);
    this.scene.fog = new THREE.FogExp2(0x171311, 0.035);
    return this.interiorSpawn.clone();
  }

  isNearBasementDoor(position) {
    if (!this.isInterior) return false;
    const dx = position.x - this.basementDoorPosition.x;
    const dz = position.z - this.basementDoorPosition.z;
    return dx * dx + dz * dz < 2.6 * 2.6;
  }

  isTouchingBasementDoor(position) {
    if (!this.isInterior) return false;
    const dx = position.x - this.basementDoorPosition.x;
    const dz = position.z - this.basementDoorPosition.z;
    return dx * dx + dz * dz < 1.55 * 1.55;
  }

  tryOpenBasement(position) {
    return this.isNearBasementDoor(position);
  }

  makeInstances(geometry, material, transforms, name, castShadow, receiveShadow) {
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    const dummy = new THREE.Object3D();
    transforms.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(0, item.rotationY || 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.name = name;
    return mesh;
  }

  update(deltaSeconds) {
    this.elapsedSeconds = (this.elapsedSeconds + deltaSeconds) % DAY_CYCLE_SECONDS;
    this.applyCycleState(this.elapsedSeconds);
    if (this.isInterior) {
      this.sunShadowTimer = 0;
      return false;
    }
    if (!this.sun.castShadow) {
      this.sunShadowTimer = 0;
      return false;
    }
    this.sunShadowTimer += deltaSeconds;
    if (this.sunShadowTimer < 0.33) return false;
    this.sunShadowTimer = 0;
    this.sun.shadow.needsUpdate = true;
    return true;
  }

  applyCycleState(elapsedSeconds) {
    const phase = Math.PI / 2 + (elapsedSeconds / DAY_CYCLE_SECONDS) * Math.PI * 2;
    const dayValue = (Math.sin(phase) + 1) * 0.5;
    const daylight = smoothstep(0.17, 0.68, dayValue);
    const night = 1 - daylight;
    const twilight = 1 - THREE.MathUtils.clamp(Math.abs(dayValue - 0.5) / 0.28, 0, 1);

    this.skyColor.copy(SKY_NIGHT).lerp(SKY_DAY, daylight).lerp(SKY_DUSK, twilight * 0.52);
    this.fogColor.copy(FOG_NIGHT).lerp(FOG_DAY, daylight).lerp(SKY_DUSK, twilight * 0.24);
    if (!this.isInterior) {
      this.scene.background.copy(this.skyColor);
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = 0.0014 + night * 0.0058;
    }

    this.sun.position.set(Math.cos(phase) * 72, Math.sin(phase) * 72, 24);
    this.sunColor.copy(this.nightSunColor).lerp(this.daySunColor, daylight).lerp(this.duskSunColor, twilight * 0.65);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = 0.025 + daylight * 1.45;
    this.sun.castShadow = daylight > 0.035;
    this.hemisphere.intensity = 0.1 + daylight * 0.76;
    this.moonFill.intensity = night * 0.2;

    this.moon.visible = night > 0.015;
    this.moonMaterial.opacity = night;
    this.moonHaloMaterial.opacity = night * 0.105;

    this.groundMaterial.color.copy(this.nightGroundColor).lerp(this.dayGroundColor, daylight);
    this.roadMaterial.color.copy(this.nightRoadColor).lerp(this.dayRoadColor, daylight);
    this.sidewalkMaterial.color.copy(this.nightSidewalkColor).lerp(this.daySidewalkColor, daylight);
    this.houseMaterials.body.color.copy(this.nightHouseColor).lerp(this.dayHouseColor, daylight);
    this.houseMaterials.gable.color.copy(this.nightHouseColor).lerp(this.dayHouseColor, daylight);

    const windowGlow = smoothstep(0.42, 0.88, night);
    this.houseMaterials.windows.emissiveIntensity = windowGlow * 1.2;
    this.lampHeadMaterial.color.copy(this.dayLampColor).lerp(this.nightLampColor, smoothstep(0.14, 0.58, night));

    for (const { light, baseIntensity, index } of this.streetLights) {
      const activation = smoothstep(0.13 + index * 0.015, 0.72 + index * 0.015, night);
      light.intensity = baseIntensity * activation;
    }
  }

  resolveCollision(position, previousPosition) {
    if (this.isInterior) {
      position.x = THREE.MathUtils.clamp(position.x, -3.35, 3.35);
      position.z = THREE.MathUtils.clamp(position.z, -11.7, 10.35);
      return;
    }
    if (this.isBeaconDoorway(position.x, position.z)) return;
    const radius = 0.38;
    if (!this.overlapsHome(position.x, position.z, radius)) return;
    const keepX = !this.overlapsHome(position.x, previousPosition.z, radius);
    const keepZ = !this.overlapsHome(previousPosition.x, position.z, radius);
    if (keepX) position.z = previousPosition.z;
    else if (keepZ) position.x = previousPosition.x;
    else {
      position.x = previousPosition.x;
      position.z = previousPosition.z;
    }
  }

  overlapsHome(x, z, radius) {
    if (this.isBeaconDoorway(x, z)) return false;
    const half = HOUSE_WIDTH / 2 + radius;
    const column = Math.round(x / HOUSE_PITCH);
    const row = Math.round(z / HOUSE_PITCH);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const centerX = (column + dx) * HOUSE_PITCH;
        const centerZ = (row + dz) * HOUSE_PITCH;
        if (Math.abs(x - centerX) < half && Math.abs(z - centerZ) < half) return true;
      }
    }
    return false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.interiorGroup);
    for (const item of this.disposables) item.dispose?.();
    this.disposables.length = 0;
  }

  isBeaconDoorway(x, z) {
    return Math.abs(x - this.beacon.x) < 0.72
      && z > this.beacon.z + 2.45
      && z < this.beacon.z + 3.65;
  }
}

function transform(x, y, z, rotationY = 0) {
  return { x, y, z, rotationY };
}

function createSuburbiaTextures() {
  const siding = drawCanvasTexture(256, 256, (context, size) => {
    context.fillStyle = '#929083';
    context.fillRect(0, 0, size, size);
    const boardColors = ['#a5a292', '#989587', '#8d8b7e', '#aaa695', '#939184', '#858477', '#9b988a', '#a19e8e'];
    const boardHeight = 32;
    for (let row = 0; row < size / boardHeight; row += 1) {
      const y = row * boardHeight;
      context.fillStyle = boardColors[row % boardColors.length];
      context.fillRect(0, y + 2, size, boardHeight - 3);
      context.fillStyle = 'rgba(36, 34, 30, 0.34)';
      context.fillRect(0, y, size, 2);
      context.fillStyle = 'rgba(225, 219, 195, 0.28)';
      context.fillRect(0, y + boardHeight - 2, size, 1);
      const seamX = ((row % 2) * 48 + 64) % size;
      context.fillStyle = 'rgba(42, 40, 34, 0.24)';
      context.fillRect(seamX, y + 4, 1, boardHeight - 7);
    }
    const random = canvasRandom(412);
    for (let i = 0; i < 1050; i += 1) {
      context.fillStyle = random() > 0.5 ? 'rgba(49, 43, 34, 0.11)' : 'rgba(224, 216, 190, 0.12)';
      context.fillRect(random() * size, random() * size, 1 + random() * 9, 1);
    }
  });

  const roof = drawCanvasTexture(256, 256, (context, size) => {
    context.fillStyle = '#302d31';
    context.fillRect(0, 0, size, size);
    const random = canvasRandom(941);
    const rowHeight = 32;
    for (let row = -1; row < size / rowHeight + 1; row += 1) {
      const offset = row % 2 ? -32 : 0;
      for (let column = -1; column < size / 64 + 1; column += 1) {
        const x = column * 64 + offset;
        const y = row * rowHeight;
        const value = Math.floor(47 + random() * 25);
        context.fillStyle = `rgb(${value}, ${value - 3}, ${value + 1})`;
        context.beginPath();
        context.moveTo(x + 2, y + 2);
        context.lineTo(x + 62, y + 2);
        context.lineTo(x + 57, y + rowHeight - 2);
        context.lineTo(x + 7, y + rowHeight - 2);
        context.closePath();
        context.fill();
        context.strokeStyle = 'rgba(13, 12, 14, 0.75)';
        context.lineWidth = 2;
        context.stroke();
        context.strokeStyle = 'rgba(170, 155, 143, 0.18)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x + 8, y + 5);
        context.lineTo(x + 54, y + 5);
        context.stroke();
      }
    }
  });

  const asphalt = drawCanvasTexture(256, 256, (context, size) => {
    context.fillStyle = '#494a4d';
    context.fillRect(0, 0, size, size);
    const random = canvasRandom(94);
    for (let i = 0; i < 2400; i += 1) {
      const alpha = 0.04 + random() * 0.16;
      const tone = random() > 0.52 ? 226 : 15;
      context.fillStyle = `rgba(${tone}, ${tone}, ${tone}, ${alpha})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }
    context.strokeStyle = 'rgba(20, 20, 22, 0.28)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(24, 28);
    context.lineTo(34, 38);
    context.lineTo(31, 52);
    context.lineTo(46, 66);
    context.moveTo(188, 172);
    context.lineTo(180, 186);
    context.lineTo(193, 201);
    context.stroke();
  });

  const sidewalk = drawCanvasTexture(256, 256, (context, size) => {
    context.fillStyle = '#85847e';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = 'rgba(41, 41, 39, 0.46)';
    context.lineWidth = 3;
    context.strokeRect(2, 2, size - 4, size - 4);
    context.strokeRect(130, 2, 124, 124);
    context.strokeRect(2, 130, 124, 124);
    context.strokeStyle = 'rgba(221, 215, 194, 0.16)';
    context.lineWidth = 1;
    context.strokeRect(6, 6, size - 12, size - 12);
    const random = canvasRandom(302);
    for (let i = 0; i < 1450; i += 1) {
      const value = random() > 0.5 ? 230 : 30;
      context.fillStyle = `rgba(${value}, ${value}, ${value - 5}, ${0.025 + random() * 0.1})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }
  });

  const interior = drawCanvasTexture(256, 256, (context, size) => {
    context.fillStyle = '#999286';
    context.fillRect(0, 0, size, size);
    const random = canvasRandom(194);
    for (let i = 0; i < 800; i += 1) {
      const tone = random() > 0.5 ? 224 : 37;
      context.fillStyle = `rgba(${tone},${tone - 5},${tone - 12},${0.025 + random() * 0.08})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 12, 1 + random() * 3);
    }
    context.fillStyle = 'rgba(56,48,41,.18)';
    context.fillRect(0, 196, size, 3);
  });

  const interiorFloor = drawCanvasTexture(128, 128, (context, size) => {
    context.fillStyle = '#635c51';
    context.fillRect(0, 0, size, size);
    const random = canvasRandom(1947);
    for (let i = 0; i < 1100; i += 1) {
      const tone = random() > 0.5 ? 197 : 26;
      context.fillStyle = `rgba(${tone},${tone - 8},${tone - 16},${0.03 + random() * 0.12})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 2, 1);
    }
  });

  return {
    siding: makeRepeatedTexture(siding, 2.8, 1.65),
    roof: makeRepeatedTexture(roof, 2.2, 2.2),
    asphalt: makeRepeatedTexture(asphalt, 4, 38),
    sidewalk: makeRepeatedTexture(sidewalk, 1, 38),
    interior: makeRepeatedTexture(interior, 1.5, 1.5),
    interiorFloor: makeRepeatedTexture(interiorFloor, 5, 15),
    ...createWindowMaps(),
  };
}

function drawCanvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d', { alpha: false }), Math.min(width, height));
  return canvas;
}

function makeRepeatedTexture(canvas, repeatX = 1, repeatY = 1) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

function canvasRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createWindowMaps() {
  const size = 128;
  const glassCanvas = document.createElement('canvas');
  glassCanvas.width = size;
  glassCanvas.height = size;
  const glassContext = glassCanvas.getContext('2d');
  const glassGradient = glassContext.createLinearGradient(0, 0, size, size);
  glassGradient.addColorStop(0, '#17212b');
  glassGradient.addColorStop(0.48, '#34414a');
  glassGradient.addColorStop(1, '#111923');
  glassContext.fillStyle = glassGradient;
  glassContext.fillRect(0, 0, size, size);
  glassContext.fillStyle = 'rgba(196, 208, 203, 0.16)';
  glassContext.beginPath();
  glassContext.moveTo(82, 0);
  glassContext.lineTo(102, 0);
  glassContext.lineTo(36, size);
  glassContext.lineTo(20, size);
  glassContext.closePath();
  glassContext.fill();
  glassContext.fillStyle = 'rgba(5, 8, 13, 0.55)';
  glassContext.fillRect(0, 0, size, 5);
  glassContext.fillRect(0, size - 5, size, 5);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = size;
  glowCanvas.height = size;
  const glowContext = glowCanvas.getContext('2d');
  glowContext.fillStyle = '#080605';
  glowContext.fillRect(0, 0, size, size);
  const warmGlow = glowContext.createRadialGradient(size * 0.5, size * 0.53, 8, size * 0.5, size * 0.53, 70);
  warmGlow.addColorStop(0, '#ffd981');
  warmGlow.addColorStop(0.45, '#d98a32');
  warmGlow.addColorStop(1, '#24140a');
  glowContext.fillStyle = warmGlow;
  glowContext.fillRect(13, 12, size - 26, size - 24);
  glowContext.fillStyle = 'rgba(11, 8, 6, 0.88)';
  glowContext.fillRect(0, 0, 6, size);
  glowContext.fillRect(size - 6, 0, 6, size);
  glowContext.fillRect(0, 0, size, 6);
  glowContext.fillRect(0, size - 6, size, 6);

  const glass = new THREE.CanvasTexture(glassCanvas);
  glass.colorSpace = THREE.SRGBColorSpace;
  glass.anisotropy = 4;
  glass.wrapS = glass.wrapT = THREE.RepeatWrapping;
  const glow = new THREE.CanvasTexture(glowCanvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  glow.anisotropy = 4;
  glow.wrapS = glow.wrapT = THREE.RepeatWrapping;
  return { glass, glow };
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
