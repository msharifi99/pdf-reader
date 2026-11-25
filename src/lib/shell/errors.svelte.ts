/**
 * Calm error presenter (SPEC story 13). Never shows a stack, never blames the user.
 *
 *   presentError(err, { fileName })   // a file couldn't open: calm dialog
 *   reportError(err, 'Couldn't export')  // a minor failure: one toast
 */
import { toast } from '../ui';

export interface CalmError {
  title: string;
  message: string;
}

/** What the shell is currently showing in the error dialog (null = nothing). */
export const errorState = $state<{ current: CalmError | null }>({ current: null });

export class ShellError extends Error {
  constructor(
    public readonly code: 'unsupported' | 'corrupt' | 'drm' | 'not-found' | 'password-cancelled' | 'unknown',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ShellError';
  }
}

const FORMATS = 'PDF, EPUB, MOBI, AZW3, FB2, comic archives (CBZ, CBR) and images';

function codeOf(err: unknown): string {
  if (!err || typeof err !== 'object') return 'unknown';
  const c = (err as { code?: unknown }).code;
  const msg = String((err as { message?: unknown }).message ?? '').toLowerCase();
  if (/drm|copy.?protect|adept|kfx/.test(msg)) return 'drm';
  if (typeof c !== 'string') return 'unknown';
  return (
    {
      'unsupported-format': 'unsupported',
      Unsupported: 'unsupported',
      Corrupt: 'corrupt',
      NotFound: 'not-found',
      Io: 'not-found',
      PasswordRequired: 'password-cancelled',
    } as Record<string, string>
  )[c] ?? c;
}

export function describeError(err: unknown, ctx: { fileName?: string } = {}): CalmError | null {
  const name = ctx.fileName ? `“${ctx.fileName}”` : 'This file';
  switch (codeOf(err)) {
    case 'aborted':
    case 'password-cancelled':
      return null; // the user chose this; nothing to say
    case 'unsupported':
      return {
        title: 'Quire can’t open this kind of file',
        message: `${name} isn’t in a format Quire reads. Quire opens ${FORMATS}.`,
      };
    case 'corrupt':
      return {
        title: 'This file looks damaged',
        message: `Part of ${name} couldn’t be read, so Quire can’t show it. If you have another copy, try that one.`,
      };
    case 'drm':
      return {
        title: 'This book is copy-protected',
        message: `${name} is locked by the store it came from. Quire doesn’t remove protection, so open it in that store’s own app.`,
      };
    case 'not-found':
      return {
        title: 'Quire can’t find this file',
        message: `${name} may have been moved, renamed or deleted. Your highlights and progress are safe; open the file from its new place and Quire will reconnect them.`,
      };
    default:
      return {
        title: ctx.fileName ? `Couldn’t open ${name}` : 'Something went wrong',
        message: 'Quire kept everything you had open. Try again; if it keeps happening, the file may be damaged.',
      };
  }
}

/** Show the calm dialog for an error that stopped what the user asked for. */
export function presentError(err: unknown, ctx: { fileName?: string } = {}): void {
  console.warn('[quire]', err);
  const e = describeError(err, ctx);
  if (e) errorState.current = e;
}

let lastToast = { msg: '', at: 0 };

/** A small failure that doesn't need a dialog: one quiet toast, deduplicated. */
export function reportError(err: unknown, message = 'Something went wrong. Quire kept your place.'): void {
  console.error('[quire]', err);
  const now = Date.now();
  if (lastToast.msg === message && now - lastToast.at < 4000) return;
  lastToast = { msg: message, at: now };
  toast(message, { kind: 'error' });
}
