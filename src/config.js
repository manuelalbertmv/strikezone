// Configuración global del juego: dificultad, calidad gráfica, oleadas y constantes.

export const DIFFICULTY = {
  facil: {
    label: 'Fácil', enemyHp: 0.75, enemyDmg: 0.5, accuracy: 0.5, reaction: 0.9,
    countMul: 0.75, speedMul: 0.9, scoreMul: 1, regen: 12,
  },
  normal: {
    label: 'Normal', enemyHp: 1, enemyDmg: 1, accuracy: 0.66, reaction: 0.6,
    countMul: 1, speedMul: 1, scoreMul: 1.5, regen: 8,
  },
  dificil: {
    label: 'Difícil', enemyHp: 1.3, enemyDmg: 1.45, accuracy: 0.8, reaction: 0.38,
    countMul: 1.3, speedMul: 1.12, scoreMul: 2.2, regen: 5,
  },
};

export const QUALITY = {
  bajo: { label: 'Bajo', pixelRatio: 0.7, shadows: false, shadowSize: 512, particles: 0.5, maxDecals: 30, extraLights: false },
  medio: { label: 'Medio', pixelRatio: 1, shadows: true, shadowSize: 1024, particles: 1, maxDecals: 60, extraLights: true },
  alto: { label: 'Alto', pixelRatio: 2, shadows: true, shadowSize: 2048, particles: 1.4, maxDecals: 110, extraLights: true },
};

// Composición de oleadas. g = soldado, r = asaltante cuerpo a cuerpo, h = pesado
export const WAVES = [
  { g: 4, r: 0, h: 0 },
  { g: 5, r: 2, h: 0 },
  { g: 6, r: 3, h: 0 },
  { g: 6, r: 3, h: 1 },
  { g: 7, r: 4, h: 2 },
  { g: 8, r: 5, h: 3 },
];

export const MAX_ALIVE = 9;
export const INTERMISSION = 8; // segundos entre oleadas

export const PLAYER = {
  radius: 0.34,
  standHeight: 1.75,
  crouchHeight: 1.12,
  standEye: 1.62,
  crouchEye: 1.0,
  walkSpeed: 5.0,
  sprintSpeed: 7.8,
  crouchSpeed: 2.5,
  jumpSpeed: 6.4,
  gravity: 20,
  stepHeight: 0.45,
  maxHealth: 100,
};
