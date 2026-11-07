import { MathUtils, Vector3 } from 'three';

/** Keyboard and virtual touch input for desktop and mobile play. */
export class InputController {
  constructor(controls, camera, domElement, speed = 4.2, onDeveloperModeChange = () => {}) {
    this.controls = controls;
    this.camera = camera;
    this.speed = speed;
    this.onDeveloperModeChange = onDeveloperModeChange;
    this.isMobile = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    this.mobileActive = false;
    this.isDeveloperMode = false;
    this.keys = new Set();
    this.joystick = { x: 0, y: 0, pointerId: null };
    this.lookPointerId = null;
    this.lastLook = { x: 0, y: 0 };
    this.forward = new Vector3();
    this.right = new Vector3();
    this.move = new Vector3();
    this.gravity = 20;
    this.jumpSpeed = 7.6;
    this.verticalVelocity = 0;
    this.isGrounded = true;
    this.jumpQueued = false;
    this.domElement = domElement;
    this.experience = document.querySelector('#experience');
    this.joystickElement = document.querySelector('#virtual-joystick');
    this.joystickKnob = document.querySelector('#joystick-knob');
    this.lookElement = document.querySelector('#touch-look');
    this.jumpButton = document.querySelector('#touch-jump');
    this.devButton = document.querySelector('#touch-dev');
    this.interactButton = document.querySelector('#touch-interact');

    if (this.isMobile) {
      this.experience?.classList.add('is-mobile');
      this.camera.rotation.order = 'YXZ';
      this.controls.pointerSpeed = 0;
    }

    this.onKeyDown = (event) => {
      if (event.code === 'KeyP') {
        if (!this.isPlaying || event.repeat) return;
        event.preventDefault();
        this.toggleDeveloperMode();
        return;
      }

      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault();
        if (event.code === 'Space' && !this.isDeveloperMode && !event.repeat) this.jumpQueued = true;
        this.keys.add(event.code);
      }
    };
    this.onKeyUp = (event) => this.keys.delete(event.code);
    this.onBlur = () => this.clearInput();
    this.onLockChange = () => {
      if (!this.controls.isLocked) this.clearInput();
    };
    this.onStickDown = (event) => {
      event.preventDefault();
      if (this.joystick.pointerId !== null) return;
      this.joystick.pointerId = event.pointerId;
      this.joystickElement.setPointerCapture(event.pointerId);
      this.updateJoystick(event);
    };
    this.onStickMove = (event) => {
      if (event.pointerId === this.joystick.pointerId) this.updateJoystick(event);
    };
    this.onStickUp = (event) => {
      if (event.pointerId !== this.joystick.pointerId) return;
      this.joystick.pointerId = null;
      this.joystick.x = 0;
      this.joystick.y = 0;
      this.joystickKnob.style.transform = 'translate(-50%, -50%)';
    };
    this.onLookDown = (event) => {
      if (event.pointerType === 'mouse' || this.lookPointerId !== null) return;
      event.preventDefault();
      this.lookPointerId = event.pointerId;
      this.lastLook.x = event.clientX;
      this.lastLook.y = event.clientY;
      this.lookElement.setPointerCapture(event.pointerId);
    };
    this.onLookMove = (event) => {
      if (event.pointerId !== this.lookPointerId) return;
      const dx = event.clientX - this.lastLook.x;
      const dy = event.clientY - this.lastLook.y;
      this.lastLook.x = event.clientX;
      this.lastLook.y = event.clientY;
      const sensitivity = 0.0042;
      this.camera.rotation.y -= dx * sensitivity;
      this.camera.rotation.x = MathUtils.clamp(this.camera.rotation.x - dy * sensitivity, -1.48, 1.48);
    };
    this.onLookUp = (event) => {
      if (event.pointerId === this.lookPointerId) this.lookPointerId = null;
    };
    this.onJumpDown = (event) => {
      event.preventDefault();
      if (this.isDeveloperMode) this.keys.add('Space');
      else this.jumpQueued = true;
    };
    this.onActionUp = () => this.keys.delete('Space');
    this.onDevDown = (event) => {
      event.preventDefault();
      this.toggleDeveloperMode();
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.joystickElement?.addEventListener('pointerdown', this.onStickDown);
    this.joystickElement?.addEventListener('pointermove', this.onStickMove);
    this.joystickElement?.addEventListener('pointerup', this.onStickUp);
    this.joystickElement?.addEventListener('pointercancel', this.onStickUp);
    this.lookElement?.addEventListener('pointerdown', this.onLookDown);
    this.lookElement?.addEventListener('pointermove', this.onLookMove);
    this.lookElement?.addEventListener('pointerup', this.onLookUp);
    this.lookElement?.addEventListener('pointercancel', this.onLookUp);
    this.jumpButton?.addEventListener('pointerdown', this.onJumpDown);
    this.jumpButton?.addEventListener('pointerup', this.onActionUp);
    this.jumpButton?.addEventListener('pointercancel', this.onActionUp);
    this.devButton?.addEventListener('pointerdown', this.onDevDown);
  }

  get isPlaying() {
    return this.isMobile ? this.mobileActive : this.controls.isLocked;
  }

  startMobile() {
    if (!this.isMobile) return;
    this.mobileActive = true;
  }

  toggleDeveloperMode() {
    if (!this.isPlaying) return;
    this.isDeveloperMode = !this.isDeveloperMode;
    this.verticalVelocity = 0;
    this.isGrounded = false;
    this.jumpQueued = false;
    this.clearInput();
    this.onDeveloperModeChange(this.isDeveloperMode);
  }

  updateJoystick(event) {
    const rect = this.joystickElement.getBoundingClientRect();
    const radius = rect.width * 0.34;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    const scale = length > radius ? radius / length : 1;
    this.joystick.x = MathUtils.clamp((dx * scale) / radius, -1, 1);
    this.joystick.y = MathUtils.clamp((dy * scale) / radius, -1, 1);
    this.joystickKnob.style.transform = `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
  }

  getLevelKeys() {
    const keys = new Set(this.keys);
    if (this.joystick.x > 0.2) keys.add('KeyD');
    else if (this.joystick.x < -0.2) keys.add('KeyA');
    return keys;
  }

  clearInput() {
    this.keys.clear();
    this.joystick.x = 0;
    this.joystick.y = 0;
    this.jumpQueued = false;
    if (this.joystickKnob) this.joystickKnob.style.transform = 'translate(-50%, -50%)';
  }

  update(deltaSeconds, groundY = 1.63) {
    if (!this.isPlaying) return;
    const delta = Math.min(deltaSeconds, 0.05);
    const forwardAmount = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'))
      - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - this.joystick.y;
    const rightAmount = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight'))
      - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) + this.joystick.x;
    const verticalAmount = this.isDeveloperMode
      ? Number(this.keys.has('Space')) - Number(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'))
      : 0;

    this.camera.getWorldDirection(this.forward);
    if (!this.isDeveloperMode) this.forward.y = 0;
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
    if (this.right.lengthSq() < 0.0001) this.right.set(1, 0, 0);
    else this.right.normalize();
    this.move.copy(this.forward).multiplyScalar(forwardAmount)
      .addScaledVector(this.right, rightAmount);

    if (this.isDeveloperMode) {
      this.move.y += verticalAmount;
      if (this.move.lengthSq() > 1) this.move.normalize();
      this.move.multiplyScalar(this.speed * 2.2 * delta);
      this.controls.object.position.add(this.move);
      return;
    }

    this.move.y = 0;
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.move.multiplyScalar(this.speed * delta);
    this.controls.object.position.add(this.move);

    if (this.jumpQueued && this.isGrounded) {
      this.verticalVelocity = this.jumpSpeed;
      this.isGrounded = false;
    }
    this.jumpQueued = false;

    if (!this.isGrounded) {
      this.verticalVelocity -= this.gravity * delta;
      this.controls.object.position.y += this.verticalVelocity * delta;
    }
    if (this.controls.object.position.y <= groundY) {
      this.controls.object.position.y = groundY;
      this.verticalVelocity = 0;
      this.isGrounded = true;
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.joystickElement?.removeEventListener('pointerdown', this.onStickDown);
    this.joystickElement?.removeEventListener('pointermove', this.onStickMove);
    this.joystickElement?.removeEventListener('pointerup', this.onStickUp);
    this.joystickElement?.removeEventListener('pointercancel', this.onStickUp);
    this.lookElement?.removeEventListener('pointerdown', this.onLookDown);
    this.lookElement?.removeEventListener('pointermove', this.onLookMove);
    this.lookElement?.removeEventListener('pointerup', this.onLookUp);
    this.lookElement?.removeEventListener('pointercancel', this.onLookUp);
    this.jumpButton?.removeEventListener('pointerdown', this.onJumpDown);
    this.jumpButton?.removeEventListener('pointerup', this.onActionUp);
    this.jumpButton?.removeEventListener('pointercancel', this.onActionUp);
    this.devButton?.removeEventListener('pointerdown', this.onDevDown);
  }
}
