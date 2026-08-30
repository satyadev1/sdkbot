/**
 * Decides whether an answer may be delivered into the focused window.
 *
 * Delivery puts text in front of whatever app has focus. If focus moved to a
 * browser, a chat window, or an editor while the answer was in flight, acting
 * blindly sends the text — and possibly a Return — somewhere it was never
 * meant to go. So delivery is gated on the frontmost app being the one that
 * asked the question.
 */

/** Bundle ids of apps that can host a Claude Code or Cursor session. */
export const KNOWN_TERMINALS: Record<string, string> = {
  'dev.warp.Warp-Stable': 'Warp',
  'com.apple.Terminal': 'Terminal',
  'com.googlecode.iterm2': 'iTerm2',
  'com.github.wez.wezterm': 'WezTerm',
  'net.kovidgoyal.kitty': 'kitty',
  'io.alacritty': 'Alacritty',
  'com.mitchellh.ghostty': 'Ghostty',
  'com.todesktop.230313mzl4w4u92': 'Cursor',
  'com.microsoft.VSCode': 'VS Code',
};

export type TargetCheck = { ok: true; app: string } | { ok: false; reason: string };

/**
 * Confirms `frontmost` is the expected target.
 *
 * An empty `expected` means "any known terminal", which is the useful default:
 * pinning one bundle id breaks the moment the session runs elsewhere, while
 * allowing anything would deliver into a browser.
 */
export function checkTarget(frontmost: string | null, expected?: string): TargetCheck {
  if (!frontmost) return { ok: false, reason: 'could not read the frontmost app' };

  if (expected) {
    if (frontmost !== expected) {
      return { ok: false, reason: `frontmost app is ${frontmost}, expected ${expected}` };
    }
    return { ok: true, app: KNOWN_TERMINALS[frontmost] ?? frontmost };
  }

  const known = KNOWN_TERMINALS[frontmost];
  if (!known) return { ok: false, reason: `frontmost app ${frontmost} is not a known terminal` };
  return { ok: true, app: known };
}

/** Codepoints that must not be typed: C0 controls, and DEL. */
// eslint-disable-next-line no-control-regex -- matching them is the point here
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export type Deliverable = { ok: true } | { ok: false; reason: string };

/**
 * Rejects answers that are unsafe to deliver.
 *
 * A newline would submit early, leaving the remainder to land as a second,
 * unintended input. Control characters can carry terminal escape sequences.
 * Neither belongs in a legitimate option label, so both are refused rather
 * than stripped — silently altering an answer is worse than not delivering it.
 */
export function isDeliverable(answer: string): Deliverable {
  if (answer.trim() === '') return { ok: false, reason: 'answer is empty' };
  if (/[\r\n]/.test(answer)) return { ok: false, reason: 'answer spans multiple lines' };
  // Escaped rather than literal, so the bytes stay visible and survive edits.
  if (CONTROL_CHARS.test(answer)) {
    return { ok: false, reason: 'answer contains control characters' };
  }
  if (answer.length > 500) return { ok: false, reason: 'answer is too long to deliver' };
  return { ok: true };
}
