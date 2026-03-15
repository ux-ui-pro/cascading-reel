export const DEFAULT_SPRITE_ELEMENTS_COUNT = 6;
export const GRID_COLS = 3;
export const GRID_ROWS = 3;
export const ROW_COMPACT_OFFSETS_RATIO: [number, number, number] = [0.04, 0, -0.04];
export type MotionProfile = {
  columnStaggerMs: number;
  fallMs: number;
  outroOverlapMs: number;
  outroRowGapMs: number;
  rowBaseSpacingRatio: number;
  incomingAlphaRampMs: number;
  fixedStepMs: number;
  maxCatchUpStepsPerFrame: number;
};
export const DEFAULT_MOTION_PROFILE: MotionProfile = {
  columnStaggerMs: 76,
  fallMs: 800,
  outroOverlapMs: 88,
  outroRowGapMs: 14,
  rowBaseSpacingRatio: 0.05,
  incomingAlphaRampMs: 34,
  fixedStepMs: 1000 / 120,
  maxCatchUpStepsPerFrame: 6,
};
export const FLOW_OUTRO_ROW_GAP_MS = DEFAULT_MOTION_PROFILE.outroRowGapMs;
export const FLOW_ROW_BASE_SPACING_RATIO = DEFAULT_MOTION_PROFILE.rowBaseSpacingRatio;
export const FLOW_WIN_PULSE_PERIOD_MS = 1800;
export const FLOW_WIN_PULSE_AMPLITUDE = 0.15;
export const PARTICLE_FLY_DURATION_MS = 720;
export const FLOW_WIN_PARTICLES_PER_CELL_HIGH = 34;
export const DEFAULT_PARTICLE_COLOR_RGB: [number, number, number] = [255, 235, 110];
export const FLOW_COLUMN_STAGGER_MS = DEFAULT_MOTION_PROFILE.columnStaggerMs;
export const FLOW_FALL_MS = DEFAULT_MOTION_PROFILE.fallMs;
export const FLOW_OUTRO_OVERLAP_MS = DEFAULT_MOTION_PROFILE.outroOverlapMs;
export const INITIAL_WIN_FLASH_DELAY_MS = 200;
