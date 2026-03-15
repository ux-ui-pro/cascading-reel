import { clamp } from '../utils/math';

export type MotionSegment = {
  startMs: number;
  endMs: number;
  from: number;
  to: number;
};

export function smootherStep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function sampleSegment(
  segment: MotionSegment,
  nowMs: number,
): {
  value: number;
  t: number;
  done: boolean;
} {
  if (segment.endMs <= segment.startMs) {
    return { value: segment.to, t: 1, done: true };
  }
  const t = clamp((nowMs - segment.startMs) / (segment.endMs - segment.startMs), 0, 1);
  const eased = smootherStep(t);
  return {
    value: segment.from + (segment.to - segment.from) * eased,
    t,
    done: t >= 1,
  };
}
