export type RafStep = (now: number) => boolean;

export class RafLoop {
  private rafId: number | null = null;
  private step: RafStep | null = null;

  public start(step: RafStep): void {
    if (this.rafId !== null) return;
    this.step = step;
    this.rafId = requestAnimationFrame(this.tick);
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.step = null;
  }

  public isRunning(): boolean {
    return this.rafId !== null;
  }

  private readonly tick = (now: number): void => {
    if (!this.step) {
      this.stop();
      return;
    }

    const shouldContinue = this.step(now);
    if (shouldContinue === false) {
      this.stop();
      return;
    }

    if (this.rafId === null) return;
    this.rafId = requestAnimationFrame(this.tick);
  };
}
