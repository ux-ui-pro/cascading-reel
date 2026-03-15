export type SymbolId = number;
export type ParticleColor = 'rainbow' | [number, number, number];

export type SpinState = {
  stopGrid?: number[][];
  stopRows?: number[][];
  finaleSequence?: number[][][];
  finaleSequenceRows?: number[][][];
  highlightWin?: boolean;
  callback?: () => void;
};

export type CascadingReelConfig = {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  button?: HTMLButtonElement;
  sprite?: string;
  spriteElementsCount?: number;
  symbolScale?: number;
  initialSegments?: number[][];
  highlightInitialWinningCells?: boolean;
  queuedSpinStates?: SpinState[];
  particleColor?: ParticleColor;
};

export type CellPosition = {
  col: number;
  row: number;
};

export type SpinPhase = 'idle' | 'winFlash' | 'outro' | 'preSpin';
