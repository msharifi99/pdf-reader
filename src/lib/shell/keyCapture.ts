/**
 * Raw key capture for the shortcuts editor. Installed on window (capture phase) BEFORE the command
 * dispatcher, so while a capture is active no shortcut fires and the editor sees every key.
 */
type Handler = (e: KeyboardEvent) => void;

let active: Handler | null = null;

export function installKeyCaptureHook(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!active || e.isComposing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    active(e);
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}

/** Route every keydown to `handler` until the returned stop function is called. */
export function beginKeyCapture(handler: Handler): () => void {
  active = handler;
  return () => {
    if (active === handler) active = null;
  };
}
