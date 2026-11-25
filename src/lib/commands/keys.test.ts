import { describe, expect, it } from 'vitest';
import { formatSequence, formatStep, keyCaps, normalizeEvent, normalizeSequence, parseSequence, parseStep } from './keys';

const ev = (key: string, o: Record<string, unknown> = {}) => normalizeEvent({ key, ...o });

describe('normalizeEvent', () => {
  it('lowercase letters are bare; Shift+letter is Shift+G', () => {
    expect(ev('g')).toBe('g');
    expect(ev('G', { shiftKey: true })).toBe('Shift+G');
    expect(ev('G', { shiftKey: false })).toBe('g'); // caps lock without shift
    expect(ev('g', { shiftKey: true })).toBe('Shift+G'); // caps lock + shift
  });
  it('modifier ordering and uppercase letters with modifiers', () => {
    expect(ev('k', { ctrlKey: true })).toBe('Ctrl+K');
    expect(ev('K', { ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+K');
    expect(ev('f', { altKey: true, ctrlKey: true, shiftKey: true })).toBe('Ctrl+Alt+Shift+F');
  });
  it('? drops Shift', () => {
    expect(ev('?', { shiftKey: true })).toBe('?');
  });
  it('Ctrl+plus and Ctrl+= both exist and are distinct, numpad + maps to Plus', () => {
    expect(ev('+', { ctrlKey: true, shiftKey: true })).toBe('Ctrl+Plus');
    expect(ev('=', { ctrlKey: true })).toBe('Ctrl+=');
    expect(ev('+', { ctrlKey: true, code: 'NumpadAdd' })).toBe('Ctrl+Plus');
    expect(ev('-', { ctrlKey: true, code: 'NumpadSubtract' })).toBe('Ctrl+-');
    expect(ev('0', { ctrlKey: true, code: 'Numpad0' })).toBe('Ctrl+0');
  });
  it('named keys', () => {
    expect(ev(' ')).toBe('Space');
    expect(ev(' ', { shiftKey: true })).toBe('Shift+Space');
    expect(ev('ArrowLeft', { altKey: true })).toBe('Alt+Left');
    expect(ev('Escape')).toBe('Escape');
    expect(ev('F11')).toBe('F11');
    expect(ev('Enter', { shiftKey: true })).toBe('Shift+Enter');
    expect(ev('PageDown')).toBe('PageDown');
    expect(ev('Enter', { code: 'NumpadEnter' })).toBe('Enter');
    expect(ev(',', { ctrlKey: true })).toBe('Ctrl+,');
  });
  it('modifier-only and unknown keys are null', () => {
    expect(ev('Control', { ctrlKey: true })).toBeNull();
    expect(ev('Shift', { shiftKey: true })).toBeNull();
    expect(ev('MediaPlayPause')).toBeNull();
    expect(ev('Dead')).toBeNull();
  });
  it('falls back to event.code for non-Latin layouts and dead keys under Ctrl', () => {
    expect(ev('к', { ctrlKey: true, code: 'KeyR' })).toBe('Ctrl+R');
    expect(ev('Dead', { code: 'KeyE' })).toBe('e');
    expect(ev('\u0001', { ctrlKey: true, code: 'KeyA' })).toBe('Ctrl+A');
  });
  it('AltGr is not Ctrl+Alt', () => {
    expect(ev('@', { ctrlKey: true, altKey: true, getModifierState: (k: string) => k === 'AltGraph' })).toBe('@');
  });
});

describe('parse / format', () => {
  it('canonicalises user strings', () => {
    expect(parseStep('ctrl+shift+k')).toBe('Ctrl+Shift+K');
    expect(parseStep('Shift+Ctrl+k')).toBe('Ctrl+Shift+K');
    expect(parseStep('G')).toBe('Shift+G');
    expect(parseStep('g')).toBe('g');
    expect(parseStep('Ctrl+G')).toBe('Ctrl+G');
    expect(parseStep('Esc')).toBe('Escape');
    expect(parseStep('ArrowLeft')).toBe('Left');
    expect(parseStep('Ctrl++')).toBe('Ctrl+Plus');
    expect(parseStep('+')).toBe('Plus');
    expect(parseStep('Ctrl+Plus')).toBe('Ctrl+Plus');
    expect(parseStep('Shift+?')).toBe('?');
    expect(parseStep('f5')).toBe('F5');
    expect(parseStep('Ctrl+,')).toBe('Ctrl+,');
    expect(parseStep('Bogus+k')).toBeNull();
    expect(parseStep('Ctrl+Nope')).toBeNull();
    expect(parseStep('')).toBeNull();
  });
  it('event and parse agree', () => {
    expect(ev('G', { shiftKey: true })).toBe(parseStep('G'));
    expect(ev('?', { shiftKey: true })).toBe(parseStep('?'));
    expect(ev('+', { ctrlKey: true, shiftKey: true })).toBe(parseStep('Ctrl+Plus'));
  });
  it('sequences', () => {
    expect(parseSequence('g g')).toEqual(['g', 'g']);
    expect(parseSequence('  Ctrl+K   Ctrl+C ')).toEqual(['Ctrl+K', 'Ctrl+C']);
    expect(normalizeSequence('g G')).toBe('g Shift+G');
    expect(parseSequence('g nope')).toBeNull();
    expect(parseSequence('')).toBeNull();
  });
  it('labels', () => {
    expect(formatStep('Ctrl+Shift+K')).toBe('Ctrl+Shift+K');
    expect(formatStep('Shift+G')).toBe('G');
    expect(formatStep('g')).toBe('g');
    expect(formatStep('Alt+Left')).toBe('Alt+←');
    expect(formatStep('Escape')).toBe('Esc');
    expect(formatSequence('g g')).toBe('g g');
    expect(keyCaps('Ctrl+Shift+K')).toEqual(['Ctrl', 'Shift', 'K']);
    expect(keyCaps('Shift+Space')).toEqual(['Shift', 'Space']);
  });
});
