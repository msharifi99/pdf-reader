/** Turn a raw text selection into the term we look up. Pure. */
export interface Normalized {
  /** Display text and Wikipedia term: trimmed, whitespace collapsed, edge punctuation removed. */
  text: string;
  /** What the dictionary gets: `text` without a trailing possessive. */
  dictQuery: string;
  words: number;
  /** More than a short phrase: neither lookup applies. */
  tooLong: boolean;
}

export const MAX_PHRASE_WORDS = 6;
export const MAX_PHRASE_CHARS = 80;

export function normalizeSelection(raw: string | null | undefined): Normalized | null {
  const text = (raw ?? '')
    .replace(/[­​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
  if (!text) return null;
  const words = text.split(' ').length;
  return { text, dictQuery: text.replace(/['’]s$/i, ''), words, tooLong: words > MAX_PHRASE_WORDS || text.length > MAX_PHRASE_CHARS };
}
