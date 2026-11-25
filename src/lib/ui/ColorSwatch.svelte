<script lang="ts">
  interface Props {
    color: string;
    label: string;
    selected?: boolean;
    size?: number;
    onclick?: () => void;
    /** render as radio inside a radiogroup */
    role?: 'button' | 'radio';
  }
  let { color, label, selected = false, size = 24, onclick, role = 'button' }: Props = $props();
</script>

<button
  type="button"
  class="swatch"
  {role}
  aria-label={label}
  aria-pressed={role === 'button' ? selected : undefined}
  aria-checked={role === 'radio' ? selected : undefined}
  style:--c={color}
  style:--s="{size}px"
  {onclick}
></button>

<style>
  .swatch {
    flex: none;
    width: var(--s);
    height: var(--s);
    border-radius: var(--radius-full);
    background: var(--c);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 16%, transparent);
    transition: box-shadow var(--dur-fast) var(--ease-out), scale var(--dur-fast) var(--ease-out);
  }
  .swatch:hover { scale: 1.08; }
  .swatch[aria-pressed='true'],
  .swatch[aria-checked='true'] {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 16%, transparent), 0 0 0 2px var(--bg), 0 0 0 3.5px var(--text);
  }
  .swatch:focus-visible { outline-offset: 3px; border-radius: var(--radius-full); }
  @media (forced-colors: active) { .swatch { forced-color-adjust: none; border: 1px solid CanvasText; } }
</style>
