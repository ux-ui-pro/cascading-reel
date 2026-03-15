export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) ** 2;
}

export function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

export function normalizeSegment(segment: number, elementsCount: number): number {
  return ((segment % elementsCount) + elementsCount) % elementsCount;
}

export function normalizeRgbChannel(value: number): number {
  return clamp(Math.round(value), 0, 255);
}

export function normalizeAlphaChannel(value: number): number {
  return clamp(value, 0, 1);
}
