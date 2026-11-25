<script lang="ts">
  import { icons, type IconName } from './icons';

  interface Props {
    name: IconName;
    /** px; 16 in dense chrome, 20 default */
    size?: number;
    /** accessible label; omit for decorative icons (aria-hidden) */
    label?: string;
    class?: string;
  }
  let { name, size = 20, label, class: cls = '' }: Props = $props();
</script>

<svg
  class="icon {cls}"
  width={size}
  height={size}
  viewBox="0 0 20 20"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  {@html icons[name]}
</svg>

<style>
  .icon {
    flex: none;
    display: inline-block;
    vertical-align: middle;
    overflow: visible;
  }
</style>
