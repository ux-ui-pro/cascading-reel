import { GRID_COLS, GRID_ROWS } from '../constants';
import type { CellPosition, SymbolId } from '../types';
import { randomInt } from '../utils/math';

export function createRandomGrid(spriteElementsCount: number): SymbolId[][] {
  const grid: SymbolId[][] = [];
  for (let col = 0; col < GRID_COLS; col += 1) {
    const column: SymbolId[] = [];
    for (let row = 0; row < GRID_ROWS; row += 1) {
      column.push(randomInt(spriteElementsCount));
    }
    grid.push(column);
  }
  return grid;
}

export function findMostFrequentCells(grid: SymbolId[][]): CellPosition[] {
  const counts = new Map<SymbolId, number>();
  for (let col = 0; col < GRID_COLS; col += 1) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      const symbol = grid[col][row];
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
  }

  let selectedSymbol: SymbolId = grid[0][0];
  let maxCount = -1;
  for (const [symbol, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      selectedSymbol = symbol;
    }
  }

  const cells: CellPosition[] = [];
  for (let col = 0; col < GRID_COLS; col += 1) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      if (grid[col][row] === selectedSymbol) {
        cells.push({ col, row });
      }
    }
  }
  return cells;
}

export function createZeroOffsets(): number[][] {
  return Array.from({ length: GRID_COLS }, () => Array.from({ length: GRID_ROWS }, () => 0));
}

export function fillOffsets(offsets: number[][], value: number): void {
  for (let col = 0; col < GRID_COLS; col += 1) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      offsets[col][row] = value;
    }
  }
}
