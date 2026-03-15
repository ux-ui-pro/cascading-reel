import { cloneSpinState } from '../normalize';
import type { SpinState } from '../types';

export class SpinQueueController {
  private queue: SpinState[];

  public constructor(initialQueue?: SpinState[]) {
    this.queue = (initialQueue ?? []).map((entry) => cloneSpinState(entry));
  }

  public hasPending(): boolean {
    return this.queue.length > 0;
  }

  public consume(): SpinState | null {
    if (this.queue.length === 0) return null;
    return this.queue.shift() ?? null;
  }
}
