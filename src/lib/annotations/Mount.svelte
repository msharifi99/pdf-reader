<!-- Exports the reader overlay snippet that index.ts registers with addReaderOverlay. -->
<script module lang="ts">
  import Annotations from './Annotations.svelte';
  export { annotationsOverlay };
</script>

{#snippet annotationsOverlay()}<Annotations />{/snippet}
