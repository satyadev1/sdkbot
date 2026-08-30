import { describe, expect, it } from 'vitest';
import { checkTarget, isDeliverable } from './target.js';

const WARP = 'dev.warp.Warp-Stable';

describe('checkTarget', () => {
  it('accepts a known terminal when nothing is pinned', () => {
    expect(checkTarget(WARP)).toEqual({ ok: true, app: 'Warp' });
  });

  it('refuses an app that is not a terminal', () => {
    const result = checkTarget('com.google.Chrome');
    expect(result.ok).toBe(false);
    // The reason names the app, so a blocked delivery is self-explaining.
    expect(result.ok === false && result.reason).toContain('com.google.Chrome');
  });

  it('refuses when the frontmost app cannot be read', () => {
    expect(checkTarget(null)).toEqual({
      ok: false,
      reason: 'could not read the frontmost app',
    });
  });

  it('accepts only the pinned app when one is given', () => {
    expect(checkTarget(WARP, WARP)).toEqual({ ok: true, app: 'Warp' });
    expect(checkTarget('com.apple.Terminal', WARP).ok).toBe(false);
  });

  it('honours a pinned app that is not a known terminal', () => {
    // Pinning is explicit intent, so it wins over the known-terminal list.
    expect(checkTarget('com.example.Custom', 'com.example.Custom')).toEqual({
      ok: true,
      app: 'com.example.Custom',
    });
  });
});

describe('isDeliverable', () => {
  it('accepts an ordinary answer', () => {
    expect(isDeliverable('Push both')).toEqual({ ok: true });
    expect(isDeliverable('1')).toEqual({ ok: true });
  });

  it('accepts non-ascii text', () => {
    expect(isDeliverable('café — naïve')).toEqual({ ok: true });
  });

  it('refuses an empty or blank answer', () => {
    expect(isDeliverable('').ok).toBe(false);
    expect(isDeliverable('   ').ok).toBe(false);
  });

  it('refuses a multi-line answer, which would submit early', () => {
    expect(isDeliverable('yes\nrm -rf /')).toEqual({
      ok: false,
      reason: 'answer spans multiple lines',
    });
    expect(isDeliverable('a\rb').ok).toBe(false);
  });

  it('refuses control characters that could carry escape sequences', () => {
    for (const code of [0x07, 0x1b, 0x09, 0x7f]) {
      const result = isDeliverable(`a${String.fromCharCode(code)}b`);
      expect(result, `charCode ${code}`).toEqual({
        ok: false,
        reason: 'answer contains control characters',
      });
    }
  });

  it('refuses an answer too long to be a real choice', () => {
    expect(isDeliverable('x'.repeat(501)).ok).toBe(false);
    expect(isDeliverable('x'.repeat(500))).toEqual({ ok: true });
  });
});
