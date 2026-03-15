import {
  DEFAULT_MOTION_PROFILE,
  DEFAULT_SPRITE_ELEMENTS_COUNT,
  FLOW_WIN_PARTICLES_PER_CELL_HIGH,
  FLOW_WIN_PULSE_AMPLITUDE,
  FLOW_WIN_PULSE_PERIOD_MS,
  GRID_COLS,
  GRID_ROWS,
  INITIAL_WIN_FLASH_DELAY_MS,
  type MotionProfile,
  PARTICLE_FLY_DURATION_MS,
  ROW_COMPACT_OFFSETS_RATIO,
} from './constants';
import {
  createRandomGrid,
  createZeroOffsets,
  fillOffsets,
  findMostFrequentCells,
} from './core/grid';
import { RafLoop } from './core/loop';
import type { CellVisibility, OutroMotionPlan } from './core/outro';
import { buildOutroMotionPlan, updateOutroOffsets } from './core/outro';
import { SpinQueueController } from './core/spinQueue';
import {
  beginSpin,
  createRuntimeState,
  destroyState,
  finishSpin,
  startWinFlash,
} from './core/state';
import {
  normalizeInitialSegments,
  normalizeParticleColor,
  normalizeStopGrid,
  normalizeSymbolScale,
  rowsToStopGrid,
} from './normalize';
import { WebGLRenderer } from './render/webglRenderer';
import type { CascadingReelConfig, CellPosition, SymbolId } from './types';

type ParticleSeeds = {
  seedA: number;
  seedB: number;
  seedC: number;
  phaseOffset: number;
  twinkleSeed: number;
};

type GridRenderSampler = {
  grid: SymbolId[][];
  skipWinningCells: boolean;
  sampleOffsetY: (col: number, row: number) => number;
  sampleAlpha: (col: number, row: number) => number;
  isVisible: (col: number, row: number) => boolean;
};

export class CascadingReel {
  private static readonly RAINBOW_HUE_BUCKETS = 24;
  private static readonly PARTICLE_GLOBAL_ALPHA = 0.9;
  private static readonly PARTICLE_MAX_DISTANCE = 0.72;
  private static readonly PARTICLE_BASE_RADIUS = 0.028;
  private static readonly DEFAULT_SYMBOL_SCALE = 0.9;

  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private readonly button?: HTMLButtonElement;
  private readonly spinQueueController: SpinQueueController;
  private readonly spriteUrl?: string;
  private readonly spriteElementsCount: number;
  private readonly highlightInitialWinningCells: boolean;
  private readonly particleColorRgb: [number, number, number];
  private readonly particleColorMode: 'solid' | 'rainbow';
  private readonly symbolScale: number;
  private readonly motionProfile: MotionProfile;
  private readonly isCoarsePointerDevice: boolean;

  private spriteImage: HTMLImageElement | null = null;
  private webglRenderer: WebGLRenderer | null = null;
  private readonly rafLoop = new RafLoop();
  private readonly runtime = createRuntimeState();
  private width = 0;
  private height = 0;
  private cellW = 0;
  private cellH = 0;
  private boardX = 0;
  private boardY = 0;
  private scriptedCascadeQueue: number[][][] = [];
  private scriptedOutgoingGrid: SymbolId[][] | null = null;
  private scriptedPendingGrid: SymbolId[][] | null = null;
  private scriptedOutroStartedAt = 0;
  private scriptedOutroElapsedMs = 0;
  private outroMotionPlan: OutroMotionPlan | null = null;
  private scriptedOutgoingOffsets: number[][] = createZeroOffsets();
  private scriptedOutgoingOffsetsPrev: number[][] = createZeroOffsets();
  private scriptedIncomingOffsets: number[][] = createZeroOffsets();
  private scriptedIncomingOffsetsPrev: number[][] = createZeroOffsets();
  private scriptedIncomingAlpha: number[][] = createZeroOffsets();
  private scriptedIncomingAlphaPrev: number[][] = createZeroOffsets();
  private scriptedIncomingVisibility: CellVisibility[][] =
    CascadingReel.createVisibilityGrid('hidden');
  private scriptedIncomingVisibilityPrev: CellVisibility[][] =
    CascadingReel.createVisibilityGrid('hidden');
  private winningCells: CellPosition[] = [];
  private readonly winningCellKeys = new Set<string>();
  private grid: SymbolId[][];
  private readonly particlesPerCell = FLOW_WIN_PARTICLES_PER_CELL_HIGH;
  private lastRafTime = 0;
  private initialHighlightRequestedAt = 0;
  private simulationLastNow = 0;
  private simulationAccumulatorMs = 0;
  private outroInterpolationAlpha = 1;
  private isOutroPipelineWarmedUp = false;
  private isGpuPipelineWarmedUp = false;
  private perfWindowStartedAt = 0;
  private perfFrameCount = 0;
  private perfOver20MsCount = 0;
  private readonly perfDtSamples: number[] = [];
  private mobileDprCap = 2;
  private mobilePerfGoodWindows = 0;
  private mobilePerfBadWindows = 0;
  private static readonly PERF_WINDOW_MS = 1500;
  private static readonly PERF_BAD_P95_DT_MS = 19;
  private static readonly PERF_GOOD_P95_DT_MS = 17.5;
  private static readonly PERF_BAD_SLOW_RATIO = 0.03;
  private static readonly MOBILE_BAD_WINDOWS_TO_DECREASE_DPR = 2;
  private static readonly MOBILE_GOOD_WINDOWS_TO_INCREASE_DPR = 4;
  private static readonly MOBILE_DPR_CAP_MIN = 1.25;
  private static readonly MOBILE_DPR_CAP_MAX = 1.5;
  private static readonly MOBILE_DPR_STEP_DOWN = 0.1;
  private static readonly MOBILE_DPR_STEP_UP = 0.05;
  private static readonly DPR_QUANT_STEP = 0.25;
  private static readonly MAX_CANVAS_AREA_PX_COARSE = 900 * 900;
  private static readonly MAX_CANVAS_AREA_PX_FINE = 1400 * 1400;
  private static readonly PRE_SPIN_MS = 150;
  private static readonly WIN_EFFECTS_ENVELOPE_TAU_MS = 120;
  private static readonly MAX_FRAME_DELTA_MS = 100;
  private static readonly WIN_BORDER_ALPHA = 0.72;
  private static readonly WIN_BORDER_INSET_RATIO = 0.08;
  private static readonly particleSeedsCache = new Map<string, ParticleSeeds[]>();

  public constructor(config: CascadingReelConfig) {
    this.canvas = config.canvas;
    this.container = config.container;
    this.button = config.button;
    this.spriteUrl = config.sprite;
    this.spriteElementsCount = Math.max(
      1,
      config.spriteElementsCount ?? DEFAULT_SPRITE_ELEMENTS_COUNT,
    );
    this.highlightInitialWinningCells = config.highlightInitialWinningCells !== false;
    this.spinQueueController = new SpinQueueController(config.queuedSpinStates);
    const particleColor = normalizeParticleColor(config.particleColor);
    this.particleColorRgb = particleColor.rgb;
    this.particleColorMode = particleColor.mode;
    this.symbolScale = normalizeSymbolScale(config.symbolScale, CascadingReel.DEFAULT_SYMBOL_SCALE);
    this.motionProfile = DEFAULT_MOTION_PROFILE;
    this.isCoarsePointerDevice = CascadingReel.detectCoarsePointerDevice();
    this.mobileDprCap = this.isCoarsePointerDevice ? CascadingReel.MOBILE_DPR_CAP_MAX : 2;
    this.grid = config.initialSegments
      ? normalizeInitialSegments(config.initialSegments, this.spriteElementsCount)
      : createRandomGrid(this.spriteElementsCount);
  }

  public async init(): Promise<void> {
    this.bindEvents();
    this.resize();
    await this.loadSpriteIfProvided();
    if (!this.spriteImage) {
      throw new Error('sprite is required for WebGL renderer');
    }
    this.webglRenderer = new WebGLRenderer({
      canvas: this.canvas,
      spriteImage: this.spriteImage,
      spriteElementsCount: this.spriteElementsCount,
    });
    this.webglRenderer.resize(this.width, this.height);
    this.warmUpOutroPipeline();
    this.warmUpGpuPipeline();
    this.applyInitialHighlightIfNeeded();
    requestAnimationFrame((warmNow) => {
      this.render(warmNow);
      this.startLoop();
    });
  }

  public destroy(): void {
    this.unbindEvents();
    this.rafLoop.stop();
    this.simulationLastNow = 0;
    this.simulationAccumulatorMs = 0;
    destroyState(this.runtime);
    this.webglRenderer?.dispose();
    this.webglRenderer = null;
    this.clearWinningCells();
  }

  public spin(): void {
    this.dismissHighlightIfActive();
    if (this.runtime.isSpinning) return;
    if (this.runtime.queueFinished) return;
    if (!this.spinQueueController.hasPending()) {
      this.runtime.queueFinished = true;
      if (this.button) this.button.disabled = true;
      return;
    }

    const activeSpinState = this.spinQueueController.consume();
    const shouldHighlightCurrentSpin = activeSpinState?.highlightWin === true;
    this.runtime.isSpinning = true;
    this.runtime.phase = 'preSpin';
    this.runtime.preSpinStartedAt = performance.now();
    this.runtime.activeSpinState = activeSpinState;
    this.runtime.shouldHighlightCurrentSpin = shouldHighlightCurrentSpin;
    this.runtime.hasStartedFirstSpin = true;
    this.simulationLastNow = 0;
    this.simulationAccumulatorMs = 0;

    if (this.button) this.button.disabled = true;
    this.startLoop();
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.button?.addEventListener('click', this.onSpinClick);
  }

  private unbindEvents(): void {
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.button?.removeEventListener('click', this.onSpinClick);
  }

  private readonly onVisibilityChange = (): void => {
    this.lastRafTime = 0;
    this.simulationLastNow = 0;
    this.simulationAccumulatorMs = 0;
    this.resetPerfWindow();
  };

  private readonly onSpinClick = (): void => {
    if (this.runtime.isSpinning && this.runtime.phase !== 'winFlash') return;
    this.spin();
  };

  private getNextGrid(stopGrid?: number[][]): SymbolId[][] {
    if (!stopGrid) return createRandomGrid(this.spriteElementsCount);
    return normalizeStopGrid(stopGrid, this.spriteElementsCount);
  }

  private update(now: number): void {
    if (!this.runtime.isSpinning) return;

    if (this.runtime.phase === 'preSpin') {
      if (now - this.runtime.preSpinStartedAt < CascadingReel.PRE_SPIN_MS) {
        return;
      }
      beginSpin(this.runtime, {
        activeSpinState: this.runtime.activeSpinState,
        shouldHighlightCurrentSpin: this.runtime.shouldHighlightCurrentSpin,
        startedAt: now,
      });
      this.runtime.preSpinStartedAt = 0;

      const scriptedSource = this.runtime.activeSpinState?.finaleSequenceRows
        ? this.runtime.activeSpinState.finaleSequenceRows.map((rows) => rowsToStopGrid(rows))
        : (this.runtime.activeSpinState?.finaleSequence ?? []);
      this.scriptedCascadeQueue = scriptedSource.map((grid) => grid.map((column) => [...column]));
      this.clearWinningCells();

      const stopGridSource = this.runtime.activeSpinState?.stopRows
        ? rowsToStopGrid(this.runtime.activeSpinState.stopRows)
        : this.runtime.activeSpinState?.stopGrid;
      const nextGrid = this.getNextGrid(stopGridSource);
      this.startOutroTransition(nextGrid, now);
    }

    if (this.runtime.phase === 'outro') {
      return;
    }
  }

  private stepScriptedOutro(stepMs: number): void {
    if (!this.scriptedOutgoingGrid || !this.scriptedPendingGrid) {
      this.finishSpinWithUi();
      return;
    }
    if (!this.outroMotionPlan) {
      this.outroMotionPlan = this.createOutroMotionPlan();
    }
    this.scriptedOutroElapsedMs += stepMs;
    const { allOutgoingDone, allIncomingDone } = updateOutroOffsets({
      elapsedMs: this.scriptedOutroElapsedMs,
      scriptedOutgoingOffsets: this.scriptedOutgoingOffsets,
      scriptedIncomingOffsets: this.scriptedIncomingOffsets,
      scriptedIncomingAlpha: this.scriptedIncomingAlpha,
      scriptedIncomingVisibility: this.scriptedIncomingVisibility,
      motionPlan: this.outroMotionPlan,
    });

    if (!allOutgoingDone || !allIncomingDone) return;

    this.grid = this.scriptedPendingGrid;
    this.scriptedOutgoingGrid = null;
    this.scriptedPendingGrid = null;
    this.outroMotionPlan = null;
    this.clearWinningCells();
    this.resetOutroBuffers(1, 'active');

    if (this.tryStartScriptedCascade(this.scriptedOutroStartedAt + this.scriptedOutroElapsedMs))
      return;
    if (!this.runtime.shouldHighlightCurrentSpin) {
      this.finishSpinWithUi();
      return;
    }

    this.setWinningCells(findMostFrequentCells(this.grid));
    startWinFlash(this.runtime, this.scriptedOutroStartedAt + this.scriptedOutroElapsedMs);
    this.runtime.activeSpinState?.callback?.();
    if (
      this.button &&
      this.runtime.shouldHighlightCurrentSpin &&
      this.spinQueueController.hasPending()
    )
      this.button.disabled = false;
  }

  private tryStartScriptedCascade(now: number): boolean {
    if (this.scriptedCascadeQueue.length === 0) return false;
    const nextGrid = this.scriptedCascadeQueue.shift();
    if (!nextGrid) return false;
    this.startOutroTransition(normalizeStopGrid(nextGrid, this.spriteElementsCount), now);
    return true;
  }

  private startOutroTransition(nextGrid: SymbolId[][], now: number): void {
    this.scriptedOutgoingGrid = this.grid.map((column) => [...column]);
    this.scriptedPendingGrid = nextGrid.map((column) => [...column]);
    this.outroMotionPlan = this.createOutroMotionPlan();
    this.resetOutroBuffers(0, 'hidden');
    this.clearWinningCells();
    this.runtime.phase = 'outro';
    this.scriptedOutroStartedAt = now;
    this.scriptedOutroElapsedMs = 0;
    this.outroInterpolationAlpha = 1;
  }

  private finishSpinWithUi(skipCallback = false): void {
    const finishedSpinState = this.runtime.activeSpinState;
    const callback = skipCallback ? undefined : finishedSpinState?.callback;
    const hasPending = this.spinQueueController.hasPending();
    finishSpin(this.runtime, hasPending, performance.now());
    if (this.button) this.button.disabled = this.runtime.queueFinished;
    callback?.();
  }

  private dismissHighlightIfActive(): void {
    if (this.runtime.phase !== 'winFlash') return;
    this.finishSpinWithUi(true);
  }

  private applyInitialHighlightIfNeeded(): void {
    if (!this.highlightInitialWinningCells) return;
    this.setWinningCells(findMostFrequentCells(this.grid));
    this.initialHighlightRequestedAt = performance.now();
  }

  private warmUpOutroPipeline(): void {
    if (this.isOutroPipelineWarmedUp) return;
    const motionPlan = this.createOutroMotionPlan();
    const outgoingOffsets = createZeroOffsets();
    const incomingOffsets = createZeroOffsets();
    const incomingAlpha = createZeroOffsets();
    const incomingVisibility = CascadingReel.createVisibilityGrid('hidden');
    const maxRowDelay = Math.max(...motionPlan.rowStartDelays);
    const maxColumnDelay = (GRID_COLS - 1) * motionPlan.columnStaggerMs;
    const warmupMoments = [
      0,
      this.motionProfile.fixedStepMs,
      motionPlan.incomingStartShift + this.motionProfile.fixedStepMs,
      motionPlan.fallMs + maxRowDelay + maxColumnDelay + this.motionProfile.fixedStepMs,
    ];
    for (const elapsedMs of warmupMoments) {
      updateOutroOffsets({
        elapsedMs,
        scriptedOutgoingOffsets: outgoingOffsets,
        scriptedIncomingOffsets: incomingOffsets,
        scriptedIncomingAlpha: incomingAlpha,
        scriptedIncomingVisibility: incomingVisibility,
        motionPlan,
      });
    }
    this.isOutroPipelineWarmedUp = true;
  }

  private createOutroMotionPlan(): OutroMotionPlan {
    const plan = buildOutroMotionPlan({
      height: this.height,
      boardY: this.boardY,
      cellH: this.cellH,
      motionProfile: this.motionProfile,
    });
    if (!this.isCoarsePointerDevice) return plan;
    const frameMs = 1000 / 60;
    return {
      ...plan,
      columnStaggerMs: this.quantizeMs(plan.columnStaggerMs, frameMs),
      incomingStartShift: this.quantizeMs(plan.incomingStartShift, frameMs),
      rowStartDelays: [
        this.quantizeMs(plan.rowStartDelays[0], frameMs),
        this.quantizeMs(plan.rowStartDelays[1], frameMs),
        this.quantizeMs(plan.rowStartDelays[2], frameMs),
      ],
    };
  }

  private quantizeMs(valueMs: number, frameMs: number): number {
    if (valueMs <= 0) return 0;
    const frames = Math.max(1, Math.round(valueMs / frameMs));
    return frames * frameMs;
  }

  private warmUpGpuPipeline(): void {
    if (this.isGpuPipelineWarmedUp) return;
    const renderer = this.webglRenderer;
    if (!renderer) return;
    const warmW = Math.max(8, this.cellW * 0.2);
    const warmH = Math.max(8, this.cellH * 0.2);
    const warmX = this.boardX + 2;
    const warmY = this.boardY + 2;

    renderer.beginFrame();
    renderer.drawSprite(0, warmX, warmY, warmW, warmH, 1);
    renderer.drawSolidRect(warmX + warmW + 2, warmY, warmW, warmH, [1, 1, 1, 0.35]);
    renderer.beginAdditiveBlend();
    renderer.drawSoftCircle(
      warmX + warmW * 0.5,
      warmY + warmH * 0.5,
      Math.max(2, warmW * 0.25),
      [1, 0.9, 0.4, 0.4],
    );
    renderer.endAdditiveBlend();

    this.isGpuPipelineWarmedUp = true;
  }

  private trackOutroPerf(dt: number, now: number): void {
    if (this.runtime.phase !== 'outro') {
      this.resetPerfWindow();
      return;
    }
    if (this.perfWindowStartedAt <= 0) this.perfWindowStartedAt = now;
    this.perfFrameCount += 1;
    if (dt > 20) this.perfOver20MsCount += 1;
    this.perfDtSamples.push(dt);
    if (now - this.perfWindowStartedAt < CascadingReel.PERF_WINDOW_MS) return;
    this.flushPerfWindow();
    this.perfWindowStartedAt = now;
  }

  private resetPerfWindow(): void {
    this.perfWindowStartedAt = 0;
    this.perfFrameCount = 0;
    this.perfOver20MsCount = 0;
    this.perfDtSamples.length = 0;
  }

  private flushPerfWindow(): void {
    if (this.perfFrameCount === 0) return;
    const sorted = [...this.perfDtSamples].sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)));
    const p95Dt = sorted[p95Index];
    this.adjustMobileDprCap(p95Dt, this.perfOver20MsCount, this.perfFrameCount);
    this.perfFrameCount = 0;
    this.perfOver20MsCount = 0;
    this.perfDtSamples.length = 0;
  }

  private adjustMobileDprCap(p95Dt: number, slowFrames: number, totalFrames: number): void {
    if (!this.isCoarsePointerDevice) return;
    if (totalFrames <= 0) return;

    const slowRatio = slowFrames / totalFrames;
    const isBadWindow =
      p95Dt > CascadingReel.PERF_BAD_P95_DT_MS || slowRatio > CascadingReel.PERF_BAD_SLOW_RATIO;
    const isGoodWindow = p95Dt <= CascadingReel.PERF_GOOD_P95_DT_MS && slowFrames === 0;
    let nextCap = this.mobileDprCap;

    if (isBadWindow) {
      this.mobilePerfBadWindows += 1;
      this.mobilePerfGoodWindows = 0;
      if (this.mobilePerfBadWindows >= CascadingReel.MOBILE_BAD_WINDOWS_TO_DECREASE_DPR) {
        nextCap = Math.max(
          CascadingReel.MOBILE_DPR_CAP_MIN,
          this.mobileDprCap - CascadingReel.MOBILE_DPR_STEP_DOWN,
        );
        this.mobilePerfBadWindows = 0;
      }
    } else if (isGoodWindow) {
      this.mobilePerfGoodWindows += 1;
      this.mobilePerfBadWindows = 0;
      if (this.mobilePerfGoodWindows >= CascadingReel.MOBILE_GOOD_WINDOWS_TO_INCREASE_DPR) {
        nextCap = Math.min(
          CascadingReel.MOBILE_DPR_CAP_MAX,
          this.mobileDprCap + CascadingReel.MOBILE_DPR_STEP_UP,
        );
        this.mobilePerfGoodWindows = 0;
      }
    } else {
      this.mobilePerfGoodWindows = 0;
      this.mobilePerfBadWindows = 0;
    }

    if (Math.abs(nextCap - this.mobileDprCap) < 0.001) return;
    this.mobileDprCap = nextCap;
    this.resize();
  }

  private render(now: number): void {
    if (!this.webglRenderer) return;
    if (
      this.initialHighlightRequestedAt > 0 &&
      now - this.initialHighlightRequestedAt >= INITIAL_WIN_FLASH_DELAY_MS
    ) {
      startWinFlash(this.runtime, this.initialHighlightRequestedAt);
      this.runtime.winEffectsEnvelope = 1;
      this.initialHighlightRequestedAt = 0;
      if (this.button) this.button.disabled = false;
    }

    const winEffectsTarget =
      this.runtime.phase === 'preSpin' ? 0 : this.runtime.phase === 'winFlash' ? 1 : 0;
    if (this.lastRafTime > 0) {
      const dt = Math.min(now - this.lastRafTime, 50);
      this.trackOutroPerf(dt, now);
      const kWin = 1 - Math.exp(-dt / CascadingReel.WIN_EFFECTS_ENVELOPE_TAU_MS);
      this.runtime.winEffectsEnvelope +=
        (winEffectsTarget - this.runtime.winEffectsEnvelope) * kWin;
    } else {
      this.resetPerfWindow();
    }
    this.lastRafTime = now;

    this.webglRenderer.beginFrame();

    const skipWinningCells =
      this.runtime.phase === 'winFlash' ||
      this.runtime.phase === 'preSpin' ||
      (this.initialHighlightRequestedAt > 0 && this.winningCells.length > 0);

    if (this.runtime.phase === 'outro' && this.scriptedOutgoingGrid && this.scriptedPendingGrid) {
      this.drawGridInterpolated(
        this.scriptedOutgoingGrid,
        this.scriptedOutgoingOffsetsPrev,
        this.scriptedOutgoingOffsets,
        this.outroInterpolationAlpha,
        skipWinningCells,
      );
      this.drawGridInterpolated(
        this.scriptedPendingGrid,
        this.scriptedIncomingOffsetsPrev,
        this.scriptedIncomingOffsets,
        this.outroInterpolationAlpha,
        skipWinningCells,
        this.scriptedIncomingAlphaPrev,
        this.scriptedIncomingAlpha,
        this.scriptedIncomingVisibility,
      );
    } else {
      this.drawGrid(this.grid, null, skipWinningCells);
    }

    const winPhase = this.initialHighlightRequestedAt > 0 ? 'winFlash' : this.runtime.phase;
    const winFlashStartedAt =
      this.initialHighlightRequestedAt > 0
        ? this.initialHighlightRequestedAt
        : this.runtime.winFlashStartedAt;
    const winEffectsEnvelope =
      this.initialHighlightRequestedAt > 0 ? 1 : this.runtime.winEffectsEnvelope;

    this.drawWinningEffects({
      now,
      phase: winPhase,
      winFlashStartedAt,
      winEffectsEnvelope,
    });
  }

  private readonly isWinningCell = (col: number, row: number): boolean => {
    return this.winningCellKeys.has(`${col}:${row}`);
  };

  private getRowCompactOffset(row: number): number {
    return (ROW_COMPACT_OFFSETS_RATIO[row] ?? 0) * this.cellH;
  }

  private applyPixelSnapY(y: number): number {
    if (this.isCoarsePointerDevice) return Math.round(y * 2) / 2;
    return y;
  }

  private drawGrid(
    grid: SymbolId[][],
    offsets: number[][] | null,
    skipWinningCells: boolean,
  ): void {
    this.drawGridWithSampler({
      grid,
      skipWinningCells,
      sampleOffsetY: (col, row) => (offsets ? offsets[col][row] : 0),
      sampleAlpha: () => 1,
      isVisible: () => true,
    });
  }

  private drawGridInterpolated(
    grid: SymbolId[][],
    prevOffsets: number[][],
    currOffsets: number[][],
    alpha: number,
    skipWinningCells: boolean,
    prevOpacity?: number[][],
    currOpacity?: number[][],
    visibility?: CellVisibility[][],
  ): void {
    this.drawGridWithSampler({
      grid,
      skipWinningCells,
      sampleOffsetY: (col, row) =>
        prevOffsets[col][row] + (currOffsets[col][row] - prevOffsets[col][row]) * alpha,
      sampleAlpha: (col, row) =>
        prevOpacity && currOpacity
          ? prevOpacity[col][row] + (currOpacity[col][row] - prevOpacity[col][row]) * alpha
          : 1,
      isVisible: (col, row) => !visibility || visibility[col][row] !== 'hidden',
    });
  }

  private drawGridWithSampler(sampler: GridRenderSampler): void {
    const renderer = this.webglRenderer;
    if (!renderer) return;
    for (let col = 0; col < GRID_COLS; col += 1) {
      const x = this.boardX + col * this.cellW;
      for (let row = 0; row < GRID_ROWS; row += 1) {
        if (sampler.skipWinningCells && this.isWinningCell(col, row)) continue;
        if (!sampler.isVisible(col, row)) continue;
        const offsetY = sampler.sampleOffsetY(col, row);
        const y = this.applyPixelSnapY(
          this.boardY + row * this.cellH + offsetY + this.getRowCompactOffset(row),
        );
        if (y > this.height || y + this.cellH < 0) continue;
        const spriteAlpha = sampler.sampleAlpha(col, row);
        if (spriteAlpha <= 0) continue;
        const symbolW = this.cellW * this.symbolScale;
        const symbolH = this.cellH * this.symbolScale;
        const symbolOffsetX = (this.cellW - symbolW) * 0.5;
        const symbolOffsetY = (this.cellH - symbolH) * 0.5;
        renderer.drawSprite(
          sampler.grid[col][row],
          x + symbolOffsetX,
          y + symbolOffsetY,
          symbolW,
          symbolH,
          spriteAlpha,
        );
      }
    }
  }

  private drawWinningEffects(params: {
    now: number;
    phase: 'idle' | 'winFlash' | 'outro' | 'preSpin';
    winFlashStartedAt: number;
    winEffectsEnvelope: number;
  }): void {
    const renderer = this.webglRenderer;
    if (!renderer) return;
    if (this.winningCells.length === 0) return;
    if (params.phase !== 'winFlash' && params.phase !== 'preSpin') return;

    const envelope = Math.max(0, Math.min(1, params.winEffectsEnvelope));
    const elapsed = Math.max(0, params.now - params.winFlashStartedAt);
    const pulseProgress = (elapsed % FLOW_WIN_PULSE_PERIOD_MS) / FLOW_WIN_PULSE_PERIOD_MS;
    const pulse = 1 + Math.sin(pulseProgress * Math.PI * 2) * FLOW_WIN_PULSE_AMPLITUDE * envelope;
    const borderInset = Math.max(1, this.cellW * CascadingReel.WIN_BORDER_INSET_RATIO);
    const borderThickness = Math.max(1, this.cellW * 0.022);
    const particleModeActive =
      this.runtime.phase === 'winFlash' &&
      this.runtime.shouldHighlightCurrentSpin &&
      this.runtime.hasStartedFirstSpin;
    for (const cell of this.winningCells) {
      const baseX = this.boardX + cell.col * this.cellW;
      const baseY = this.boardY + cell.row * this.cellH + this.getRowCompactOffset(cell.row);
      const symbol = this.grid[cell.col][cell.row];
      const alpha = CascadingReel.WIN_BORDER_ALPHA * envelope;

      const borderColor: [number, number, number] =
        this.particleColorMode === 'rainbow'
          ? CascadingReel.hslToRgb01(
              (elapsed * 0.2 + cell.col * 36 + cell.row * 22) % 360,
              0.96,
              0.64,
            )
          : [
              this.particleColorRgb[0] / 255,
              this.particleColorRgb[1] / 255,
              this.particleColorRgb[2] / 255,
            ];

      const scaledW = this.cellW * this.symbolScale * pulse;
      const scaledH = this.cellH * this.symbolScale * pulse;
      const offsetX = (this.cellW - scaledW) * 0.5;
      const offsetY = (this.cellH - scaledH) * 0.5;
      renderer.drawSprite(symbol, baseX + offsetX, baseY + offsetY, scaledW, scaledH, 1);

      const innerX = baseX + borderInset;
      const innerY = baseY + borderInset;
      const innerW = this.cellW - borderInset * 2;
      const innerH = this.cellH - borderInset * 2;
      if (innerW <= borderThickness * 2 || innerH <= borderThickness * 2) continue;
      this.drawElectricBorder({
        renderer,
        cell,
        x: innerX,
        y: innerY,
        w: innerW,
        h: innerH,
        borderThickness,
        borderColor,
        alpha,
        elapsed,
        envelope,
      });

      if (particleModeActive) {
        this.drawCellParticleBurst({
          renderer,
          cell,
          centerX: baseX + this.cellW * 0.5,
          centerY: baseY + this.cellH * 0.5,
          elapsed,
          envelope,
        });
      }
    }
  }

  private drawCellParticleBurst(params: {
    renderer: WebGLRenderer;
    cell: CellPosition;
    centerX: number;
    centerY: number;
    elapsed: number;
    envelope: number;
  }): void {
    const maxDistance = Math.min(this.cellW, this.cellH) * CascadingReel.PARTICLE_MAX_DISTANCE;
    const baseRadius = Math.min(this.cellW, this.cellH) * CascadingReel.PARTICLE_BASE_RADIUS;
    const seedsList = CascadingReel.getParticleSeeds(params.cell.col, params.cell.row);
    const solidColor: [number, number, number] = [
      this.particleColorRgb[0] / 255,
      this.particleColorRgb[1] / 255,
      this.particleColorRgb[2] / 255,
    ];

    params.renderer.beginAdditiveBlend();
    for (let i = 0; i < this.particlesPerCell; i += 1) {
      const s = seedsList[i];
      const startTime = s.phaseOffset * PARTICLE_FLY_DURATION_MS;
      const age = params.elapsed - startTime;
      if (age < 0) continue;
      const particleT = (age % PARTICLE_FLY_DURATION_MS) / PARTICLE_FLY_DURATION_MS;
      const direction = s.seedA * Math.PI * 2;
      const distance = maxDistance * particleT * (0.35 + s.seedB * 0.65);
      const px = params.centerX + Math.cos(direction) * distance;
      const py = params.centerY + Math.sin(direction) * distance;
      const twinkle =
        0.7 +
        0.9 * Math.max(0, Math.sin((params.elapsed * 0.012 + s.twinkleSeed * 2) * Math.PI * 2));
      const radius = Math.max(1, baseRadius * (0.55 + s.seedC * 0.6) * (1 - particleT * 0.5));
      const alpha = Math.max(
        0,
        Math.min(1, (0.9 + twinkle * 0.2) * CascadingReel.PARTICLE_GLOBAL_ALPHA * params.envelope),
      );
      if (alpha <= 0) continue;

      const rgb =
        this.particleColorMode === 'rainbow'
          ? CascadingReel.getRainbowParticleColor(
              params.elapsed,
              params.cell.col,
              params.cell.row,
              s.seedA,
            )
          : solidColor;

      params.renderer.drawSoftCircle(px, py, radius, [rgb[0], rgb[1], rgb[2], alpha]);
    }
    params.renderer.endAdditiveBlend();
  }

  private drawElectricBorder(params: {
    renderer: WebGLRenderer;
    cell: CellPosition;
    x: number;
    y: number;
    w: number;
    h: number;
    borderThickness: number;
    borderColor: [number, number, number];
    alpha: number;
    elapsed: number;
    envelope: number;
  }): void {
    const baseA = Math.max(0, Math.min(1, params.alpha * params.envelope));
    const expand = params.borderThickness * 1.8;
    const seedTime = params.elapsed + params.cell.col * 170 + params.cell.row * 290;
    params.renderer.beginAdditiveBlend();
    params.renderer.drawElectricBorder({
      x: params.x - expand,
      y: params.y - expand,
      width: params.w + expand * 2,
      height: params.h + expand * 2,
      rgba: [params.borderColor[0], params.borderColor[1], params.borderColor[2], baseA * 0.55],
      timeMs: seedTime,
      borderThicknessPx: Math.max(0.8, params.borderThickness * 1.1),
      borderInsetPx: expand * 0.85,
      cornerRadiusPx: Math.max(2, params.borderThickness * 2.5),
      noiseAmplitudePx: Math.max(0.15, params.borderThickness * 0.6),
      pulseStrength: 0.9,
    });
    params.renderer.drawElectricBorder({
      x: params.x - expand * 0.5,
      y: params.y - expand * 0.5,
      width: params.w + expand,
      height: params.h + expand,
      rgba: [params.borderColor[0], params.borderColor[1], params.borderColor[2], baseA * 0.9],
      timeMs: seedTime * 1.03,
      borderThicknessPx: Math.max(0.7, params.borderThickness * 0.8),
      borderInsetPx: expand * 0.5,
      cornerRadiusPx: Math.max(1.5, params.borderThickness * 1.7),
      noiseAmplitudePx: Math.max(0.12, params.borderThickness * 0.42),
      pulseStrength: 1.25,
    });
    params.renderer.endAdditiveBlend();
  }

  private static hslToRgb01(
    hueDeg: number,
    saturation: number,
    lightness: number,
  ): [number, number, number] {
    const h = ((hueDeg % 360) + 360) % 360;
    const s = Math.max(0, Math.min(1, saturation));
    const l = Math.max(0, Math.min(1, lightness));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp >= 0 && hp < 1) {
      r = c;
      g = x;
    } else if (hp < 2) {
      r = x;
      g = c;
    } else if (hp < 3) {
      g = c;
      b = x;
    } else if (hp < 4) {
      g = x;
      b = c;
    } else if (hp < 5) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    const m = l - c * 0.5;
    return [r + m, g + m, b + m];
  }

  private static getRainbowParticleColor(
    elapsed: number,
    col: number,
    row: number,
    seedA: number,
  ): [number, number, number] {
    const hueRaw = (seedA * 360 + elapsed * 0.24 + col * 38 + row * 22) % 360;
    const bucket = 360 / CascadingReel.RAINBOW_HUE_BUCKETS;
    const hue = Math.floor(hueRaw / bucket) * bucket;
    return CascadingReel.hslToRgb01(hue, 0.98, 0.64);
  }

  private static detectCoarsePointerDevice(): boolean {
    if (typeof window === 'undefined') return false;
    const coarseMatch =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const touchPoints =
      typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number'
        ? navigator.maxTouchPoints
        : 0;
    return coarseMatch || touchPoints > 0;
  }

  private quantizeDprCap(value: number): number {
    const step = CascadingReel.DPR_QUANT_STEP;
    return Math.max(1, Math.round(value / step) * step);
  }

  private static hash01(a: number, b: number, c: number, d: number): number {
    const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + d * 19.3) * 43758.5453;
    return value - Math.floor(value);
  }

  private static getParticleSeeds(col: number, row: number): ParticleSeeds[] {
    const key = `${col},${row}`;
    const cached = CascadingReel.particleSeedsCache.get(key);
    if (cached) return cached;

    const generated: ParticleSeeds[] = [];
    for (let i = 0; i < FLOW_WIN_PARTICLES_PER_CELL_HIGH; i += 1) {
      generated.push({
        seedA: CascadingReel.hash01(col, row, i, 1),
        seedB: CascadingReel.hash01(col, row, i, 2),
        seedC: CascadingReel.hash01(col, row, i, 3),
        phaseOffset: CascadingReel.hash01(col, row, i, 4),
        twinkleSeed: CascadingReel.hash01(col, row, i, 5),
      });
    }
    CascadingReel.particleSeedsCache.set(key, generated);
    return generated;
  }

  private clearWinningCells(): void {
    this.winningCells = [];
    this.winningCellKeys.clear();
  }

  private setWinningCells(cells: CellPosition[]): void {
    this.winningCells = cells;
    this.winningCellKeys.clear();
    for (const cell of cells) {
      this.winningCellKeys.add(`${cell.col}:${cell.row}`);
    }
  }

  private readonly resize = (): void => {
    const bounds = this.container.getBoundingClientRect();
    const cssSide = Math.max(300, Math.floor(bounds.width));
    const cssArea = Math.max(1, cssSide * cssSide);
    const maxCanvasArea = this.isCoarsePointerDevice
      ? CascadingReel.MAX_CANVAS_AREA_PX_COARSE
      : CascadingReel.MAX_CANVAS_AREA_PX_FINE;
    const dprAreaCap = Math.max(1, Math.sqrt(maxCanvasArea / cssArea));
    const requestedCap = this.isCoarsePointerDevice ? this.mobileDprCap : 2;
    const dprCap = this.quantizeDprCap(Math.min(requestedCap, dprAreaCap));
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, dprCap));
    const side = Math.max(300, Math.floor(cssSide * dpr));
    this.width = side;
    this.height = side;
    const squareSize = Math.floor(Math.min(this.width / GRID_COLS, this.height / GRID_ROWS));
    this.cellW = squareSize;
    this.cellH = squareSize;
    this.boardX = Math.floor((this.width - this.cellW * GRID_COLS) / 2);
    this.boardY = Math.floor((this.height - this.cellH * GRID_ROWS) / 2);

    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.webglRenderer?.resize(this.width, this.height);
  };

  private async loadSpriteIfProvided(): Promise<void> {
    if (!this.spriteUrl) return;
    const image = new Image();
    image.decoding = 'async';
    image.src = this.spriteUrl;
    try {
      await image.decode();
      this.spriteImage = image;
    } catch {
      this.spriteImage = null;
    }
  }

  private advanceSimulation(now: number): void {
    if (this.simulationLastNow <= 0) {
      this.simulationLastNow = now;
      this.update(now);
      return;
    }
    const frameDt = Math.max(
      0,
      Math.min(now - this.simulationLastNow, CascadingReel.MAX_FRAME_DELTA_MS),
    );
    this.simulationLastNow = now;
    this.update(now);
    if (this.runtime.phase !== 'outro') {
      this.outroInterpolationAlpha = 1;
      return;
    }
    this.advanceOutroFixedStep(frameDt);
  }

  private advanceOutroFixedStep(frameDt: number): void {
    this.simulationAccumulatorMs += frameDt;
    const stepMs = this.motionProfile.fixedStepMs;
    let steps = 0;
    while (
      this.simulationAccumulatorMs >= stepMs &&
      steps < this.motionProfile.maxCatchUpStepsPerFrame &&
      this.runtime.phase === 'outro'
    ) {
      this.snapshotOutroState();
      this.stepScriptedOutro(stepMs);
      this.simulationAccumulatorMs -= stepMs;
      steps += 1;
    }
    if (this.runtime.phase !== 'outro') {
      this.outroInterpolationAlpha = 1;
      return;
    }
    this.outroInterpolationAlpha = Math.max(0, Math.min(1, this.simulationAccumulatorMs / stepMs));
  }

  private snapshotOutroState(): void {
    this.copyOffsets(this.scriptedOutgoingOffsetsPrev, this.scriptedOutgoingOffsets);
    this.copyOffsets(this.scriptedIncomingOffsetsPrev, this.scriptedIncomingOffsets);
    this.copyOffsets(this.scriptedIncomingAlphaPrev, this.scriptedIncomingAlpha);
    this.copyVisibility(this.scriptedIncomingVisibilityPrev, this.scriptedIncomingVisibility);
  }

  private copyOffsets(target: number[][], source: number[][]): void {
    for (let col = 0; col < GRID_COLS; col += 1) {
      for (let row = 0; row < GRID_ROWS; row += 1) {
        target[col][row] = source[col][row];
      }
    }
  }

  private copyVisibility(target: CellVisibility[][], source: CellVisibility[][]): void {
    for (let col = 0; col < GRID_COLS; col += 1) {
      for (let row = 0; row < GRID_ROWS; row += 1) {
        target[col][row] = source[col][row];
      }
    }
  }

  private resetOutroBuffers(incomingAlpha: number, incomingVisibility: CellVisibility): void {
    fillOffsets(this.scriptedOutgoingOffsets, 0);
    fillOffsets(this.scriptedIncomingOffsets, 0);
    fillOffsets(this.scriptedOutgoingOffsetsPrev, 0);
    fillOffsets(this.scriptedIncomingOffsetsPrev, 0);
    fillOffsets(this.scriptedIncomingAlpha, incomingAlpha);
    fillOffsets(this.scriptedIncomingAlphaPrev, incomingAlpha);
    this.fillVisibilityGrid(this.scriptedIncomingVisibility, incomingVisibility);
    this.fillVisibilityGrid(this.scriptedIncomingVisibilityPrev, incomingVisibility);
  }

  private static createVisibilityGrid(value: CellVisibility): CellVisibility[][] {
    return Array.from({ length: GRID_COLS }, () => Array.from({ length: GRID_ROWS }, () => value));
  }

  private fillVisibilityGrid(grid: CellVisibility[][], value: CellVisibility): void {
    for (let col = 0; col < GRID_COLS; col += 1) {
      for (let row = 0; row < GRID_ROWS; row += 1) {
        grid[col][row] = value;
      }
    }
  }

  private startLoop(): void {
    if (this.rafLoop.isRunning()) return;
    this.rafLoop.start((time: number): boolean => {
      this.advanceSimulation(time);
      this.render(time);
      return this.shouldKeepAnimating();
    });
  }

  private shouldKeepAnimating(): boolean {
    if (this.runtime.isSpinning) return true;
    if (this.initialHighlightRequestedAt > 0) return true;
    return this.runtime.winEffectsEnvelope > 0.001;
  }
}
