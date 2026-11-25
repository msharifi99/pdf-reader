import { ContextStack } from './contexts';
import { DEFAULT_BINDINGS } from './defaults';
import { Keymap } from './keymap';
import { CommandRegistry } from './registry';

/** App-wide singletons. Tests should construct their own instances instead. */
export const commands = new CommandRegistry();
export const contextStack = new ContextStack('library');
export const keymap = new Keymap(DEFAULT_BINDINGS);
