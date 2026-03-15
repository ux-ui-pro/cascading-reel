import type { MotionProfile } from '../constants';
import { GRID_ROWS } from '../constants';
import { clamp } from '../utils/math';
import { sampleSegment } from './motionTimeline';

export type CellVisibility = 'hidden' | 'entering' | 'active' | 'exiting';

export type OutroMotionPlan = {
  columnStaggerMs: number;
  fallMs: number;
  incomingAlphaRampMs: number;
  outgoingDistance: number;
  incomingFromOffsets: [number, number, number];
  rowStartDelays: [number, number, number];
  incomingStartShift: number;
};

export function buildSequentialRowStartDelays(
  fromRowOffsets: [number, number, number],
  durationMs: number,
  gapMs: number,
  rowBaseSpacingRatio: number,
): [number, number, number] {
  const delays: [number, number, number] = [0, 0, 0];
  let nextDelay = 0;
  for (let row = GRID_ROWS - 1; row >= 0; row -= 1) {
    if (fromRowOffsets[row] === 0) {
      delays[row] = 0;
      continue;
    }
    delays[row] = nextDelay;
    const baseSpacing = Math.floor(durationMs * rowBaseSpacingRatio);
    nextDelay += baseSpacing + gapMs;
  }
  return delays;
}

export function buildOutroMotionPlan(params: {
  height: number;
  boardY: number;
  cellH: number;
  motionProfile: MotionProfile;
}): OutroMotionPlan {
  const exitEpsilon = 2;
  const outgoingDistance = params.height - params.boardY + params.cellH + exitEpsilon;
  const outgoingOffsetsForOrder: [number, number, number] = [
    outgoingDistance,
    outgoingDistance,
    outgoingDistance,
  ];
  return {
    columnStaggerMs: params.motionProfile.columnStaggerMs,
    fallMs: params.motionProfile.fallMs,
    incomingAlphaRampMs: params.motionProfile.incomingAlphaRampMs,
    outgoingDistance,
    incomingFromOffsets: [-params.cellH, -params.cellH * 2, -params.cellH * 3],
    rowStartDelays: buildSequentialRowStartDelays(
      outgoingOffsetsForOrder,
      params.motionProfile.fallMs,
      params.motionProfile.outroRowGapMs,
      params.motionProfile.rowBaseSpacingRatio,
    ),
    incomingStartShift: Math.max(
      0,
      params.motionProfile.fallMs - params.motionProfile.outroOverlapMs,
    ),
  };
}

export function updateOutroOffsets(params: {
  elapsedMs: number;
  scriptedOutgoingOffsets: number[][];
  scriptedIncomingOffsets: number[][];
  scriptedIncomingAlpha: number[][];
  scriptedIncomingVisibility: CellVisibility[][];
  motionPlan: OutroMotionPlan;
}): { allOutgoingDone: boolean; allIncomingDone: boolean } {
  let allOutgoingDone = true;
  let allIncomingDone = true;

  for (let col = 0; col < params.scriptedOutgoingOffsets.length; col += 1) {
    const columnElapsed = params.elapsedMs - col * params.motionPlan.columnStaggerMs;
    for (let row = 0; row < GRID_ROWS; row += 1) {
      const rowElapsed = columnElapsed - params.motionPlan.rowStartDelays[row];

      if (rowElapsed <= 0) {
        params.scriptedOutgoingOffsets[col][row] = 0;
        params.scriptedIncomingOffsets[col][row] = params.motionPlan.incomingFromOffsets[row];
        params.scriptedIncomingAlpha[col][row] = 0;
        params.scriptedIncomingVisibility[col][row] = 'hidden';
        allOutgoingDone = false;
        allIncomingDone = false;
        continue;
      }

      const outgoing = sampleSegment(
        {
          startMs: 0,
          endMs: params.motionPlan.fallMs,
          from: 0,
          to: params.motionPlan.outgoingDistance,
        },
        rowElapsed,
      );
      params.scriptedOutgoingOffsets[col][row] = outgoing.value;
      params.scriptedIncomingVisibility[col][row] = outgoing.done ? 'entering' : 'exiting';
      if (!outgoing.done) allOutgoingDone = false;

      const incomingElapsed = rowElapsed - params.motionPlan.incomingStartShift;
      if (incomingElapsed <= 0) {
        params.scriptedIncomingOffsets[col][row] = params.motionPlan.incomingFromOffsets[row];
        params.scriptedIncomingAlpha[col][row] = 0;
        params.scriptedIncomingVisibility[col][row] = 'hidden';
        allIncomingDone = false;
        continue;
      }

      const incoming = sampleSegment(
        {
          startMs: 0,
          endMs: params.motionPlan.fallMs,
          from: params.motionPlan.incomingFromOffsets[row],
          to: 0,
        },
        incomingElapsed,
      );
      params.scriptedIncomingOffsets[col][row] = incoming.value;
      params.scriptedIncomingAlpha[col][row] = clamp(
        incomingElapsed / Math.max(1, params.motionPlan.incomingAlphaRampMs),
        0,
        1,
      );
      params.scriptedIncomingVisibility[col][row] = incoming.done ? 'active' : 'entering';
      if (!incoming.done) allIncomingDone = false;
    }
  }

  return { allOutgoingDone, allIncomingDone };
}
