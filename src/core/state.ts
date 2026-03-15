import type { SpinPhase, SpinState } from '../types';

export type RuntimeState = {
  isSpinning: boolean;
  hasStartedFirstSpin: boolean;
  queueFinished: boolean;
  shouldHighlightCurrentSpin: boolean;
  activeSpinState: SpinState | null;
  phase: SpinPhase;
  winFlashStartedAt: number;
  outroStartedAt: number;
  idleStartedAt: number;
  preSpinStartedAt: number;
  winEffectsEnvelope: number;
};

export function createRuntimeState(): RuntimeState {
  return {
    isSpinning: false,
    hasStartedFirstSpin: false,
    queueFinished: false,
    shouldHighlightCurrentSpin: false,
    activeSpinState: null,
    phase: 'idle',
    winFlashStartedAt: 0,
    outroStartedAt: 0,
    idleStartedAt: 0,
    preSpinStartedAt: 0,
    winEffectsEnvelope: 1,
  };
}

export function beginSpin(
  state: RuntimeState,
  params: {
    activeSpinState: SpinState | null;
    shouldHighlightCurrentSpin: boolean;
    startedAt: number;
  },
): void {
  state.hasStartedFirstSpin = true;
  state.isSpinning = true;
  state.phase = 'outro';
  state.outroStartedAt = params.startedAt;
  state.activeSpinState = params.activeSpinState;
  state.shouldHighlightCurrentSpin = params.shouldHighlightCurrentSpin;
}

export function finishSpin(state: RuntimeState, hasPendingInQueue: boolean, now: number): void {
  state.phase = 'idle';
  state.idleStartedAt = now;
  state.isSpinning = false;
  state.shouldHighlightCurrentSpin = false;
  state.queueFinished = !hasPendingInQueue;
  state.activeSpinState = null;
}

export function startWinFlash(state: RuntimeState, startedAt: number): void {
  state.winFlashStartedAt = startedAt;
  state.phase = 'winFlash';
}

export function destroyState(state: RuntimeState): void {
  state.isSpinning = false;
  state.queueFinished = true;
}
