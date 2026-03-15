import { DEFAULT_PARTICLE_COLOR_RGB, GRID_COLS, GRID_ROWS } from './constants';
import type { ParticleColor, SpinState, SymbolId } from './types';
import { clamp, normalizeRgbChannel, normalizeSegment } from './utils/math';

export function normalizeParticleColor(color?: ParticleColor): {
  mode: 'solid' | 'rainbow';
  rgb: [number, number, number];
} {
  if (color === 'rainbow') {
    return { mode: 'rainbow', rgb: DEFAULT_PARTICLE_COLOR_RGB };
  }
  const rgb = color ?? DEFAULT_PARTICLE_COLOR_RGB;
  return {
    mode: 'solid',
    rgb: [normalizeRgbChannel(rgb[0]), normalizeRgbChannel(rgb[1]), normalizeRgbChannel(rgb[2])],
  };
}

export function normalizeSymbolScale(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(value, 0.5, 1.2);
}

export function rowsToStopGrid(rows: number[][]): number[][] {
  if (rows.length !== GRID_ROWS) {
    throw new Error(`rows must contain ${GRID_ROWS} rows`);
  }
  for (let row = 0; row < GRID_ROWS; row += 1) {
    if (!Array.isArray(rows[row]) || rows[row].length !== GRID_COLS) {
      throw new Error(`rows[${row}] must contain ${GRID_COLS} columns`);
    }
  }

  return [
    [rows[0][0], rows[1][0], rows[2][0]],
    [rows[0][1], rows[1][1], rows[2][1]],
    [rows[0][2], rows[1][2], rows[2][2]],
  ];
}

export function normalizeStopGrid(stopGrid: number[][], elementsCount: number): SymbolId[][] {
  if (stopGrid.length !== GRID_COLS) {
    throw new Error(`stopGrid must contain ${GRID_COLS} columns`);
  }

  const next: SymbolId[][] = [];
  for (let col = 0; col < GRID_COLS; col += 1) {
    const column = stopGrid[col];
    if (!Array.isArray(column) || column.length !== GRID_ROWS) {
      throw new Error(`stopGrid[${col}] must contain ${GRID_ROWS} rows`);
    }
    next[col] = [
      normalizeSegment(column[0], elementsCount),
      normalizeSegment(column[1], elementsCount),
      normalizeSegment(column[2], elementsCount),
    ];
  }
  return next;
}

export function normalizeInitialSegments(
  initialSegments: number[][],
  elementsCount: number,
): SymbolId[][] {
  return normalizeStopGrid(rowsToStopGrid(initialSegments), elementsCount);
}

export function cloneSpinState(state: SpinState): SpinState {
  return {
    stopGrid: state.stopGrid?.map((column) => [...column]),
    stopRows: state.stopRows?.map((row) => [...row]),
    finaleSequence: state.finaleSequence?.map((grid) => grid.map((column) => [...column])),
    finaleSequenceRows: state.finaleSequenceRows?.map((grid) => grid.map((row) => [...row])),
    highlightWin: state.highlightWin,
    callback: state.callback,
  };
}
