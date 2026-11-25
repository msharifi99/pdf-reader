import { describe, expect, it } from 'vitest';
import { anchorFor, findQuote, quadsFor, rotateBox, wordsInRange } from './ocr';

const ws = [
  { text: 'Hello', x: 10, y: 10, width: 40, height: 10 },
  { text: 'brave', x: 55, y: 11, width: 40, height: 10 },
  { text: 'world', x: 10, y: 40, width: 40, height: 10 },
];

describe('comic ocr helpers', () => {
  it('maps text offsets to words and merges lines', () => {
    expect(wordsInRange(ws, 6, 11)).toEqual([1, 1]);
    expect(quadsFor(ws, 0, 2)).toEqual([[10, 10, 85, 11], [10, 40, 40, 10]]);
  });
  it('anchors with a quote and quads', () => {
    const a = anchorFor(3, ws, 1, 2, 100);
    expect(a.quote).toMatchObject({ exact: 'brave world', prefix: 'Hello ' });
    expect(a.locator).toEqual({ kind: 'fixed', page: 3, y: 0.11 });
    expect(findQuote('a b a b', { exact: 'b', prefix: 'a ', suffix: '' })).toBe(2);
  });
  it('rotates boxes clockwise', () => {
    expect(rotateBox(90, 100, 200, [10, 20, 30, 40])).toEqual([140, 10, 40, 30]);
    expect(rotateBox(180, 100, 200, [10, 20, 30, 40])).toEqual([60, 140, 30, 40]);
    expect(rotateBox(270, 100, 200, [10, 20, 30, 40])).toEqual([20, 60, 40, 30]);
  });
});
