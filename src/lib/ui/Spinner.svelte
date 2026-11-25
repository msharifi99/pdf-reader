<script lang="ts">
  interface Props {
    size?: number;
    /** announced to screen readers; omit when a parent already says it's busy */
    label?: string;
  }
  let { size = 20, label }: Props = $props();
</script>

<svg
  class="spinner"
  width={size}
  height={size}
  viewBox="0 0 20 20"
  role={label ? 'status' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.75" opacity=".18" />
  <circle
    cx="10"
    cy="10"
    r="7.5"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-dasharray="14 48"
  />
</svg>

<style>
  .spinner {
    flex: none;
    color: var(--accent);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { rotate: 360deg; } }
  /* still shows progress under reduced motion, just slower and calmer */
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
  :global(:root[data-reduce-motion='on']) .spinner { animation-duration: 2.4s; }
</style>
