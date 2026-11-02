// Controlador del jugador en primera persona: movimiento, salto, agacharse,
// sprint, colisiones, cámara (retroceso, sacudida, balanceo) y salud.
import * as THREE from 'three';
import { PLAYER } from '../config.js';

const SURFACE = (m) => {
  if (!m) return 'concrete';
  if (m === 'metal' || m.startsWith('container') || m === 'darkMetal' || m === 'stripe') return 'metal';
  if (m === 'wood' || m === 'crate') return 'wood';
  return 'concrete';
};

export class Player {
  constructor(camera, world, audio) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.onDamage = null;
    this.onDeath = null;
    this.sensitivity = 1;
    this.regenRate = 8;
    this.reset(new THREE.Vector3(0, 0, 12), 0);
  }

  reset(spawn, yaw = 0) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.crouching = false; this.crouchT = 0;
    this.height = PLAYER.standHeight;
    this.grounded = true;
    this.health = PLAYER.maxHealth;
    this.alive = true;
    this.lastDamage = -100;
    this.time = 0;
    this.sprinting = false;
    this.moveFrac = 0;
    this.bobPhase = 0;
    this.stepAcc = 0;
    this.eyeOffset = 0;
    this.landKick = 0;
    this.trauma = 0;
    this.speedNow = 0;
    this.airTime = 0;
    this.damageTaken = 0;
  }

  get eyeHeight() {
    return THREE.MathUtils.lerp(PLAYER.standEye, PLAYER.crouchEye, this.crouchT);
  }

  eyePosition(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  forward(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  addRecoil(up, side) {
    this.recoilPitch += up;
    this.recoilYaw += side;
  }

  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); }

  takeDamage(amount, fromPos) {
    if (!this.alive) return;
    this.health -= amount;
    this.damageTaken += amount;
    this.lastDamage = this.time;
    this.addTrauma(Math.min(0.5, amount / 40));
    this.audio.hurt();
    if (this.onDamage) this.onDamage(amount, fromPos);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      if (this.onDeath) this.onDeath();
    }
  }

  heal(n) { this.health = Math.min(PLAYER.maxHealth, this.health + n); }

  update(dt, input, mouse, opts) {
    this.time += dt;
    const { ads = false, firing = false, locked = true } = opts;

    // Cámara
    if (this.alive) {
      const sens = 0.0021 * this.sensitivity * (ads ? 0.6 : 1);
      this.yaw -= mouse.dx * sens;
      this.pitch -= mouse.dy * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    }

    // Entrada de movimiento
    let fx = 0, fz = 0;
    if (this.alive && locked) {
      if (input.down('KeyW')) fz -= 1;
      if (input.down('KeyS')) fz += 1;
      if (input.down('KeyA')) fx -= 1;
      if (input.down('KeyD')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }

    // Agacharse
    const wantCrouch = this.alive && (input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC'));
    if (wantCrouch) this.crouching = true;
    else if (this.crouching) {
      // ¿hay espacio para levantarse?
      if (this.world.overlaps(this.pos, PLAYER.radius, PLAYER.standHeight).length === 0) this.crouching = false;
    }
    const prevCrouchT = this.crouchT;
    this.crouchT = THREE.MathUtils.damp(this.crouchT, this.crouching ? 1 : 0, 14, dt);
    this.height = this.crouching ? PLAYER.crouchHeight : PLAYER.standHeight;
    // al agacharse en el aire, encoger desde arriba (no tocar pos)
    void prevCrouchT;

    // Sprint
    this.sprinting = this.alive && input.down('ShiftLeft') && fz < 0 && !this.crouching && !ads && !firing && this.grounded;
    let speed = this.crouching ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (ads) speed *= 0.6;

    // dirección en el mundo
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;
    const tx = wx * speed, tz = wz * speed;
    const accel = this.grounded ? (len > 0 ? 11 : 13) : 2.2;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    // Salto y gravedad
    if (this.alive && this.grounded && input.wasPressed('Space') && !this.crouching) {
      this.vel.y = PLAYER.jumpSpeed;
      this.grounded = false;
      this.audio.footstep('concrete', 0.25);
    }
    this.vel.y -= PLAYER.gravity * dt;
    if (this.vel.y < -40) this.vel.y = -40;

    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    const res = this.world.move(this.pos, PLAYER.radius, this.height, {
      x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt,
    }, this.grounded, PLAYER.stepHeight);
    this.grounded = res.grounded;
    if (res.grounded && this.vel.y < 0) this.vel.y = 0;
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;
    if (res.stepped > 0) this.eyeOffset -= res.stepped;
    this.eyeOffset = THREE.MathUtils.damp(this.eyeOffset, 0, 12, dt);
    if (!this.grounded) this.airTime += dt; else this.airTime = 0;

    // Aterrizaje
    if (!wasGrounded && this.grounded && fallSpeed > 4) {
      this.landKick = Math.min(0.18, fallSpeed * 0.012);
      this.audio.footstep(this.surface(), 0.5);
      if (fallSpeed > 15) this.takeDamage((fallSpeed - 15) * 6, null);
    }
    this.landKick = THREE.MathUtils.damp(this.landKick, 0, 8, dt);

    // Pasos y balanceo
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speedNow = hs;
    this.moveFrac = this.grounded ? Math.min(1, hs / PLAYER.walkSpeed) : 0;
    if (this.grounded && hs > 0.5) {
      this.bobPhase += dt * hs * (this.sprinting ? 1.35 : 1.6);
      this.stepAcc += hs * dt;
      const stride = this.sprinting ? 2.6 : this.crouching ? 1.6 : 2.1;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.audio.footstep(this.surface(), this.crouching ? 0.12 : this.sprinting ? 0.38 : 0.26);
      }
    }

    // Regeneración
    if (this.alive && this.time - this.lastDamage > 5 && this.health < PLAYER.maxHealth) {
      this.heal(this.regenRate * dt);
    }

    // Recuperación del retroceso
    const rk = 1 - Math.exp(-(firing ? 3 : 9) * dt);
    this.recoilPitch -= this.recoilPitch * rk;
    this.recoilYaw -= this.recoilYaw * rk;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);

    this.applyCamera();
  }

  surface() {
    const hit = this.world.raycast({ x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 0.4);
    return SURFACE(hit ? hit.box.material : null);
  }

  applyCamera() {
    const bobAmt = this.moveFrac * (this.sprinting ? 1.4 : 1);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * bobAmt;
    const bobX = Math.cos(this.bobPhase) * 0.02 * bobAmt;
    const shake = this.trauma * this.trauma;
    const t = this.time * 30;
    const sx = (Math.sin(t * 1.3) + Math.sin(t * 2.7)) * 0.5 * shake * 0.05;
    const sy = (Math.sin(t * 1.7 + 1) + Math.sin(t * 3.1)) * 0.5 * shake * 0.05;

    const eye = this.eyeHeight + this.eyeOffset - this.landKick + bobY;
    // vista de muerte: cámara cae al suelo
    const deadDrop = this.alive ? 0 : Math.min(1, (this.time - this.lastDamage) * 1.5);
    this.camera.position.set(
      this.pos.x + Math.cos(this.yaw) * bobX,
      this.pos.y + eye - deadDrop * (eye - 0.3),
      this.pos.z - Math.sin(this.yaw) * bobX,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.recoilYaw + sx;
    this.camera.rotation.x = this.pitch + this.recoilPitch + sy;
    this.camera.rotation.z = deadDrop * 0.6 + (this.sprinting ? Math.sin(this.bobPhase) * 0.008 : 0);
  }
}
