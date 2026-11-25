<script lang="ts">
  import type { Snippet } from 'svelte';
  import MenuList from './MenuList.svelte';
  import Popover, { type TriggerAttrs } from './Popover.svelte';
  import type { MenuItem } from './menu';
  import type { Placement } from './anchor';

  interface Props {
    items: MenuItem[];
    label: string;
    placement?: Placement;
    open?: boolean;
    /** spread `attrs` onto your trigger button (IconButton accepts them too) */
    trigger: Snippet<[TriggerAttrs]>;
  }
  let { items, label, placement = 'bottom-start', open = $bindable(false), trigger }: Props = $props();
  let list: ReturnType<typeof MenuList> | undefined = $state();
</script>

<Popover bind:open {label} {placement} {trigger} role="menu" onopen={() => list?.focusFirst()}>
  <MenuList bind:this={list} {items} {label} onclose={() => (open = false)} />
</Popover>
