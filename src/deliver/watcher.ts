import type { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import type { Delivery } from './backends.js';
import { checkTarget, isDeliverable } from './target.js';

export type DeliverWatcherDeps = {
  repo: SlackAnswersRepository;
  delivery: Delivery;
  sessionId: string;
  /** Bundle id that must be frontmost; any known terminal when unset. */
  expectedApp?: string;
  /** Press Return after delivering. Off by default — see `submit` below. */
  submit?: boolean;
  pollIntervalMs?: number;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
};

export type DeliverOutcome =
  | { delivered: true; answer: string }
  | { delivered: false; reason: string; answer?: string };

const DEFAULT_POLL_MS = 2000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delivers a single recorded answer, once, if it is safe to do so.
 *
 * Split out from the loop so every guard is testable without timers: an answer
 * is delivered only when it exists, is safe to type, and the expected app has
 * focus. Any failed guard is reported rather than worked around.
 */
export async function deliverOnce(deps: DeliverWatcherDeps): Promise<DeliverOutcome> {
  const row = await deps.repo.findLatestForSession(deps.sessionId);
  if (!row) return { delivered: false, reason: 'no question for this session' };
  if (row.status !== 'answered') return { delivered: false, reason: 'still pending' };

  const answer = row.answer ?? '';
  const safe = isDeliverable(answer);
  if (!safe.ok) return { delivered: false, reason: safe.reason, answer };

  const target = checkTarget(await deps.delivery.frontmostApp(), deps.expectedApp);
  if (!target.ok) return { delivered: false, reason: target.reason, answer };

  await deps.delivery.deliver(answer, deps.submit ?? false);
  return { delivered: true, answer };
}

/**
 * Polls for an answer to the session's latest question and delivers it.
 *
 * Resolves once an answer is delivered, or when `signal` aborts. A blocked
 * guard is not fatal: focus may simply be elsewhere, so the loop logs the
 * reason once and keeps waiting for the window to come back.
 */
export async function watchForAnswer(
  deps: DeliverWatcherDeps & { signal?: AbortSignal },
): Promise<DeliverOutcome> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const sleep = deps.sleep ?? defaultSleep;
  const interval = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  // Only the first occurrence of each reason is logged, so a long wait with
  // focus elsewhere does not fill the output with the same line.
  let lastReason = '';

  for (;;) {
    if (deps.signal?.aborted) return { delivered: false, reason: 'aborted' };

    const outcome = await deliverOnce(deps);
    if (outcome.delivered) return outcome;
    if (outcome.reason !== lastReason) {
      lastReason = outcome.reason;
      log(`waiting: ${outcome.reason}`);
    }
    await sleep(interval);
  }
}
