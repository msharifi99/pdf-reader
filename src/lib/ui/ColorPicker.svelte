<script lang="ts">
  import ColorSwatch from './ColorSwatch.svelte';
  import { contrast, hexToHsv, hsvToHex, isHex, parseHex, toHex } from '../design/color';
  import { uid } from './anchor';

  interface Props {
    /** #rrggbb */
    value?: string;
    label: string;
    /** quick picks */
    presets?: string[];
    /** show a live WCAG contrast readout against this colour (e.g. the theme bg) */
    against?: string;
    onchange?: (hex: string) => void;
  }
  let { value = $bindable('#e2a85e'), label, presets = [], against, onchange }: Props = $props();

  const id = uid('cp');
  // HSV kept locally so hue survives dragging through greys/black
  let hsv = $state(hexToHsv(isHex(value) ? value : '#808080'));
  let hexText = $state(value);
  let area: HTMLElement | undefined = $state();

  $effect(() => {
    // external value changes
    if (isHex(value) && value.toLowerCase() !== hsvToHex(hsv.h, hsv.s, hsv.v)) {
      const n = hexToHsv(value);
      hsv = n.s === 0 ? { ...n, h: hsv.h } : n;
      hexText = value;
    }
  });

  function commit() {
    const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
    value = hex;
    hexText = hex;
    onchange?.(hex);
  }

  function fromPointer(e: PointerEvent) {
    if (!area) return;
    const r = area.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    hsv.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    commit();
  }
  function areaKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    hsv.s = Math.max(0, Math.min(1, hsv.s + d[0]!));
    hsv.v = Math.max(0, Math.min(1, hsv.v + d[1]!));
    commit();
  }
  function hexInput() {
    const t = hexText.trim();
    if (isHex(t)) {
      const hex = toHex({ ...parseHex(t.startsWith('#') ? t : `#${t}`), a: 1 });
      value = hex;
      onchange?.(hex);
    }
  }
  const ratio = $derived(against && isHex(value) ? contrast(value, against) : undefined);
</script>

<div class="picker" role="group" aria-label={label}>
  <div
    bind:this={area}
    class="area"
    role="slider"
    tabindex="0"
    aria-label="{label}: saturation and brightness"
    aria-valuetext="saturation {Math.round(hsv.s * 100)}%, brightness {Math.round(hsv.v * 100)}%"
    aria-valuenow={Math.round(hsv.s * 100)}
    style:--hue={hsvToHex(hsv.h, 1, 1)}
    onpointerdown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); fromPointer(e); }}
    onpointermove={(e) => e.buttons && fromPointer(e)}
    onkeydown={areaKey}
  >
    <span class="knob" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%" style:background={value}></span>
  </div>
  <input
    class="hue"
    type="range"
    min="0"
    max="359"
    aria-label="{label}: hue"
    bind:value={hsv.h}
    oninput={commit}
  />
  <div class="row">
    <span class="preview" style:background={value}></span>
    <label class="sr-only" for={id}>{label} hex</label>
    <input
      {id}
      class="hex"
      bind:value={hexText}
      oninput={hexInput}
      onblur={() => (hexText = value)}
      spellcheck="false"
      maxlength="7"
    />
    {#if ratio !== undefined}
      <span class="ratio tabular" class:fail={ratio < 4.5} title="Contrast against background">
        {ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'Low'} · {ratio.toFixed(1)}
      </span>
    {/if}
  </div>
  {#if presets.length}
    <div class="presets" role="radiogroup" aria-label="{label} presets">
      {#each presets as p (p)}
        <ColorSwatch color={p} label={p} size={20} role="radio" selected={p.toLowerCase() === value.toLowerCase()} onclick={() => { value = p; onchange?.(p); }} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: var(--space-3); width: 232px; }
  .area {
    position: relative;
    height: 148px;
    border-radius: var(--radius-sm);
    background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, var(--hue));
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 12%, transparent);
    touch-action: none;
    forced-color-adjust: none;
  }
  .knob {
    position: absolute;
    width: 16px;
    height: 16px;
    translate: -50% -50%;
    border-radius: var(--radius-full);
    box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgb(0 0 0 / 0.3), var(--shadow-2);
    pointer-events: none;
  }
  .hue {
    appearance: none;
    height: 12px;
    border-radius: var(--radius-full);
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    forced-color-adjust: none;
  }
  .hue::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: var(--radius-full);
    background: transparent;
    box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgb(0 0 0 / 0.3);
  }
  .hue:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  .row { display: flex; align-items: center; gap: var(--space-2); }
  .preview {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-xs);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 16%, transparent);
  }
  .hex {
    width: 88px;
    height: var(--control-sm);
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border-soft);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: lowercase;
  }
  .hex:focus { box-shadow: inset 0 0 0 1px var(--border-strong), inset 0 -2px 0 var(--accent); outline: none; }
  .ratio { margin-left: auto; font-size: var(--text-2xs); font-weight: var(--weight-medium); color: var(--success); }
  .ratio.fail { color: var(--danger); }
  .presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
