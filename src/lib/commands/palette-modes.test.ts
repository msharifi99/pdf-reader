import { describe, expect, it } from 'vitest';
import { parseGoto, parsePaletteQuery, prefixFor } from './palette-modes';

describe('parsePaletteQuery', () => {
  it('default', () => {
    expect(parsePaletteQuery('')).toEqual({ mode: 'default', text: '' });
    expect(parsePaletteQuery('  toggle focus ')).toEqual({ mode: 'default', text: 'toggle focus' });
  });
  it('prefixes', () => {
    expect(parsePaletteQuery('>zoom')).toEqual({ mode: 'commands', text: 'zoom' });
    expect(parsePaletteQuery('> zoom in')).toEqual({ mode: 'commands', text: 'zoom in' });
    expect(parsePaletteQuery('@intro')).toEqual({ mode: 'toc', text: 'intro' });
    expect(parsePaletteQuery('/ whale')).toEqual({ mode: 'search', text: 'whale' });
    expect(parsePaletteQuery('>')).toEqual({ mode: 'commands', text: '' });
  });
  it('goto', () => {
    expect(parsePaletteQuery('#42').goto).toEqual({ kind: 'page', page: 42 });
    expect(parsePaletteQuery('# 42').goto).toEqual({ kind: 'page', page: 42 });
    expect(parsePaletteQuery('#37%').goto).toEqual({ kind: 'percent', percent: 37 });
    expect(parsePaletteQuery('#37.5 %').goto).toEqual({ kind: 'percent', percent: 37.5 });
    expect(parsePaletteQuery('#').goto).toBeNull();
    expect(parsePaletteQuery('#abc').goto).toBeNull();
    expect(parsePaletteQuery('#0').goto).toBeNull();
    expect(parsePaletteQuery('#101%').goto).toBeNull();
    expect(parseGoto('100%')).toEqual({ kind: 'percent', percent: 100 });
  });
  it('prefixFor', () => {
    expect(prefixFor('goto')).toBe('#');
    expect(prefixFor('default')).toBe('');
  });
});
