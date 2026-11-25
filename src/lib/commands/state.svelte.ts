/** Svelte 5 reactive views over the singletons. Read these inside components / $derived / $effect. */
import { formatSequence } from './keys';
import { commands, contextStack, keymap } from './instances';

class CommandsState {
  #v = $state(0);
  constructor() {
    commands.subscribe(() => this.#v++);
  }
  /** all visible commands; re-evaluates when commands register/unregister or MRU changes */
  get list() {
    this.#v;
    return commands.list();
  }
  get recent() {
    this.#v;
    return commands.recent();
  }
}

class KeyState {
  #v = $state(0);
  #pending = $state<string[]>([]);
  constructor() {
    keymap.onChange(() => this.#v++);
    contextStack.subscribe(() => this.#v++);
    keymap.onPending((p) => (this.#pending = p));
  }
  /** pending sequence prefix, e.g. ['g'] */
  get pending(): string[] {
    return this.#pending;
  }
  /** "g …" or '' */
  get pendingLabel(): string {
    return this.#pending.length ? formatSequence(this.#pending) + ' …' : '';
  }
  /** shortcut label for a command in the current context (reactive to rebinding and context changes) */
  shortcut(commandId: string): string | undefined {
    this.#v;
    return keymap.shortcutFor(commandId, contextStack.chain());
  }
  /** all bindings of a command (reactive) */
  bindings(commandId: string) {
    this.#v;
    return keymap.bindingsFor(commandId);
  }
  /** winners in the active context, for the cheat-sheet (reactive) */
  get active() {
    this.#v;
    return keymap.activeBindings(contextStack.stack);
  }
}

export const commandsState = new CommandsState();
export const keyState = new KeyState();
