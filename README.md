# cascading-reel

A high-performance WebGL cascading reel animator for slot-style UIs on any `HTMLCanvasElement`.

- 3x3 reel grid with deterministic scripted outcomes.
- Queued spins with per-spin callbacks.
- Win highlight with electric border and particle burst.
- DPR-aware rendering for mobile and desktop.

## Install

```bash
yarn add cascading-reel
```

## Usage (TypeScript)

```ts
import { CascadingReel } from 'cascading-reel';

const container = document.getElementById('reelWrap');
const canvas = document.getElementById('canvas');
const button = document.getElementById('spinBtn');

if (!container || !canvas || !button) {
  throw new Error('Demo DOM is not ready');
}

const reel = new CascadingReel({
  container: container as HTMLDivElement,
  canvas: canvas as HTMLCanvasElement,
  button: button as HTMLButtonElement,
  sprite: new URL('./assets/reel.webp', import.meta.url).href,
  spriteElementsCount: 6,
  symbolScale: 0.85,
  initialSegments: [
    [0, 1, 2],
    [3, 0, 5],
    [0, 1, 0],
  ],
  queuedSpinStates: [
    {
      stopRows: [
        [0, 4, 5],
        [2, 1, 4],
        [1, 3, 0],
      ],
      finaleSequenceRows: [
        [
          [1, 1, 0],
          [0, 1, 2],
          [4, 5, 1],
        ],
      ],
      highlightWin: true,
      callback: () => console.log('spin complete'),
    },
  ],
});

await reel.init();
reel.spin();
```

## Usage (Vue 3)

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { CascadingReel } from 'cascading-reel';

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const buttonRef = ref<HTMLButtonElement | null>(null);
const reel = shallowRef<CascadingReel | null>(null);

onMounted(async () => {
  if (!containerRef.value || !canvasRef.value) return;
  reel.value = new CascadingReel({
    container: containerRef.value,
    canvas: canvasRef.value,
    button: buttonRef.value ?? undefined,
    sprite: new URL('./assets/reel.webp', import.meta.url).href,
    spriteElementsCount: 6,
    symbolScale: 0.85,
    particleColor: 'rainbow',
  });
  await reel.value.init();
});

onBeforeUnmount(() => {
  reel.value?.destroy();
  reel.value = null;
});
</script>

<template>
  <button ref="buttonRef">Spin</button>
  <div ref="containerRef">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>
```

## HTML Layout

```html
<button id="spinBtn">Spin</button>
<div id="reelWrap">
  <canvas id="canvas"></canvas>
</div>
```

Call `reel.spin()` to consume the next item from `queuedSpinStates`.

## SpinState

```ts
type SpinState = {
  stopGrid?: number[][];
  stopRows?: number[][];
  finaleSequence?: number[][][];
  finaleSequenceRows?: number[][][];
  highlightWin?: boolean;
  callback?: () => void;
};
```

- Use `stopRows` for row-major input (`[row][col]`).
- Use `stopGrid` for column-major input (`[col][row]`).
- `finaleSequenceRows` and `finaleSequence` follow the same row/column conventions.

## Options

| Option | Type | Default | Description |
|:--|:--|:--:|:--|
| `canvas` | `HTMLCanvasElement` | — | Canvas for rendering. |
| `container` | `HTMLElement` | — | Element used for responsive sizing. |
| `button` | `HTMLButtonElement` | — | Optional spin button. |
| `sprite` | `string` | — | Sprite sheet URL. |
| `spriteElementsCount` | `number` | `6` | Number of symbols in the sprite sheet. |
| `symbolScale` | `number` | `0.9` | Symbol scale inside the cell. Clamped to `0.5..1.2`. |
| `initialSegments` | `number[][]` | randomized | Initial 3x3 state in rows format. |
| `highlightInitialWinningCells` | `boolean` | `true` | Show initial highlight before first spin. |
| `queuedSpinStates` | `SpinState[]` | `[]` | Predefined queue consumed by `spin()`. |
| `particleColor` | `'rainbow' \| [number, number, number]` | `[255, 235, 110]` | Win particle color mode or solid RGB color. |

## Methods

```ts
await reel.init();
reel.spin();
reel.destroy();
```

## Sprite Format

- Single vertical sprite sheet.
- Every symbol frame is square.
- Total texture height equals `spriteElementsCount * frameWidth` (square-frame assumption).
- `PNG` and `WebP` with transparency are supported.

## License

MIT
