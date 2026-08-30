import { describe, expect, it } from 'vitest';
import { parseOptions, resolveAnswer } from './resolveAnswer.js';

const Q = 'Q: Should I push? (options: Push both, Hold) (at 2026-08-31 01:24:49 IST)';

describe('parseOptions', () => {
  it('extracts options from the rendered question text', () => {
    expect(parseOptions(Q)).toEqual(['Push both', 'Hold']);
  });

  it('returns none when the question offered none', () => {
    expect(parseOptions('Q: Ready?')).toEqual([]);
    expect(parseOptions(null)).toEqual([]);
    expect(parseOptions(undefined)).toEqual([]);
  });

  it('uses the last marker, so a question mentioning it is not confused', () => {
    const q = 'Q: what does (options: x) mean? (options: Yes, No)';
    expect(parseOptions(q)).toEqual(['Yes', 'No']);
  });

  it('ignores an unterminated marker', () => {
    expect(parseOptions('Q: hm (options: A, B')).toEqual([]);
  });
});

describe('resolveAnswer', () => {
  it('resolves a 1-based index to its label', () => {
    expect(resolveAnswer(Q, '1')).toEqual({
      value: 'Push both',
      matched: 'Push both',
      via: 'index',
    });
    expect(resolveAnswer(Q, '2').value).toBe('Hold');
  });

  it('matches a label case-insensitively', () => {
    expect(resolveAnswer(Q, 'hold')).toMatchObject({ value: 'Hold', via: 'exact' });
  });

  it('accepts an unambiguous prefix', () => {
    expect(resolveAnswer(Q, 'push')).toMatchObject({ value: 'Push both', via: 'prefix' });
  });

  it('keeps the reply verbatim when a prefix is ambiguous', () => {
    const q = 'Q: pick (options: Push both, Push one)';
    expect(resolveAnswer(q, 'push')).toEqual({ value: 'push' });
  });

  it('keeps an out-of-range index verbatim rather than guessing', () => {
    expect(resolveAnswer(Q, '7')).toEqual({ value: '7' });
    expect(resolveAnswer(Q, '0')).toEqual({ value: '0' });
  });

  it('passes free text through untouched', () => {
    expect(resolveAnswer(Q, 'neither, hold off')).toEqual({ value: 'neither, hold off' });
  });

  it('passes anything through when no options were offered', () => {
    expect(resolveAnswer('Q: Ready?', '1')).toEqual({ value: '1' });
  });

  it('trims surrounding whitespace', () => {
    expect(resolveAnswer(Q, '  1  ').value).toBe('Push both');
  });

  it('handles an empty reply', () => {
    expect(resolveAnswer(Q, '   ')).toEqual({ value: '' });
  });
});
