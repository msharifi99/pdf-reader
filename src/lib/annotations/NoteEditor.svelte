<!--
  The calm inline note editor: multi-line, grows with its text. Ctrl+Enter or leaving the field
  saves; Esc cancels (it registers as the top layer while open, so Esc never closes the book).
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { registerOverlay } from '../shell/overlays.svelte';

  interface Props {
    value: string;
    onsave: (text: string) => void;
    oncancel: () => void;
    placeholder?: string;
    label?: string;
  }
  let { value, onsave, oncancel, placeholder = 'Write a note…', label = 'Note' }: Props = $props();

  let text = $state(untrack(() => value));
  let el: HTMLTextAreaElement | undefined = $state();
  let done = false;

  function save() {
    if (done) return;
    done = true;
    onsave(text);
  }
  function cancel() {
    if (done) return;
    done = true;
    oncancel();
  }

  onMount(() => {
    // after the parent popover is shown (its onMount runs after ours)
    queueMicrotask(() => {
      el?.focus();
      el?.setSelectionRange(text.length, text.length);
    });
    const off = registerOverlay('annotation-note', cancel);
    return () => {
      off();
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
    e.stopPropagation(); // typing digits or "n" must not reach page-level handlers
  }
</script>

<div class="editor">
  <textarea bind:this={el} bind:value={text} aria-label={label} {placeholder} rows="3" {onkeydown} onblur={save} data-testid="note-editor"></textarea>
  <p class="hint"><span>Ctrl+Enter to save</span><span>Esc to cancel</span></p>
</div>

<style>
  .editor { display: flex; flex-direction: column; gap: var(--space-1-5); }
  textarea {
    field-sizing: content;
    min-height: calc(3lh + var(--space-4));
    max-height: 40vh;
    width: 100%;
    resize: none;
    padding: var(--space-2) var(--space-2-5);
    font: inherit;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: inset 0 -2px 0 transparent;
    transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  }
  textarea::placeholder { color: var(--faint); }
  textarea:focus { box-shadow: inset 0 -2px 0 var(--accent); }
  .hint { display: flex; gap: var(--space-3); font-size: var(--text-2xs); color: var(--muted); }
</style>
