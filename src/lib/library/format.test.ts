import { describe, expect, it } from 'vitest';
import { ago, formatLeft, minutesLeft } from './format';

describe('library format helpers', () => {
  it('estimates time left from words or pages', () => {
    const speed = { wordsPerMinute: 250, minutesPerPage: 1.5 };
    expect(minutesLeft({ progress: 0.5, wordCount: 25000, pageCount: null }, speed)).toBe(50);
    expect(minutesLeft({ progress: 0.9, wordCount: null, pageCount: 100 }, speed)).toBeCloseTo(15);
    expect(minutesLeft({ progress: 0.2, wordCount: null, pageCount: null }, speed)).toBeNull();
    expect(formatLeft(130)).toBe('2 h 10 min left');
    expect(formatLeft(12.4)).toBe('12 min left');
    expect(formatLeft(0.2)).toBe('Under a minute left');
  });

  it('says how long ago', () => {
    const now = 1e12;
    expect(ago(now - 30e3, now)).toBe('Just now');
    expect(ago(now - 5 * 60e3, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3600e3, now)).toBe('3 h ago');
    expect(ago(now - 2 * 86400e3, now)).toBe('2 d ago');
    expect(ago(now - 15 * 86400e3, now)).toBe('2 w ago');
    expect(ago(now - 400 * 86400e3, now)).toBe('1 y ago');
  });

});
