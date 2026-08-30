import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Ways of getting a recorded answer in front of the waiting prompt.
 *
 * `clipboard` needs no permission and works everywhere, at the cost of one
 * keypress from you. `keystroke` finishes the job unattended but requires
 * Accessibility access, which macOS only grants by hand.
 */
export type DeliveryMode = 'clipboard' | 'keystroke';

export type Delivery = {
  /** Reads the bundle id of the frontmost app, or null when unavailable. */
  frontmostApp(): Promise<string | null>;
  /** Puts `answer` in front of the prompt. `submit` presses Return after. */
  deliver(answer: string, submit: boolean): Promise<void>;
};

/** Apple Events only — allowed without Accessibility access. */
async function frontmostApp(): Promise<string | null> {
  try {
    const { stdout } = await run('osascript', [
      '-e',
      'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function clipboardDelivery(): Delivery {
  return {
    frontmostApp,
    async deliver(answer) {
      // `pbcopy` takes the text on stdin, so it is never interpolated into a
      // shell command or an AppleScript string.
      const child = run('pbcopy');
      child.child.stdin?.end(answer);
      await child;
    },
  };
}

export function keystrokeDelivery(): Delivery {
  return {
    frontmostApp,
    async deliver(answer, submit) {
      // Typed via the clipboard and one paste keystroke rather than
      // `keystroke "<answer>"`: it avoids quoting the answer into an
      // AppleScript literal, and pasting is far faster than per-character
      // synthesis, which drops characters on a busy terminal.
      const child = run('pbcopy');
      child.child.stdin?.end(answer);
      await child;
      await run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
      if (submit) {
        await run('osascript', ['-e', 'tell application "System Events" to key code 36']);
      }
    },
  };
}

export function deliveryFor(mode: DeliveryMode): Delivery {
  return mode === 'keystroke' ? keystrokeDelivery() : clipboardDelivery();
}

/**
 * Reports whether synthetic keystrokes are permitted.
 *
 * Probes by reading a window title, which fails with the same Accessibility
 * denial as a keystroke while sending nothing. Two tempting probes are wrong:
 * reading a process *name* needs only Apple Events and succeeds even when
 * keystrokes are denied, and `keystroke ""` is short-circuited before the
 * permission check, so it succeeds too.
 *
 * Checked once at startup so a missing grant is a clear message then, rather
 * than a silent failure each time an answer arrives.
 */
export async function hasAccessibilityAccess(): Promise<boolean> {
  try {
    await run('osascript', [
      '-e',
      'tell application "System Events" to get name of front window of (first application process whose frontmost is true)',
    ]);
    return true;
  } catch {
    return false;
  }
}
