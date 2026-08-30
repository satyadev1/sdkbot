import { describe, expect, it } from 'vitest';
import type { SlackAnswer } from '../db/slackAnswersRepository.js';
import type { Delivery } from './backends.js';
import { deliverOnce, watchForAnswer } from './watcher.js';

const WARP = 'dev.warp.Warp-Stable';

function row(over: Partial<SlackAnswer> = {}): SlackAnswer {
  return {
    id: 'row-1',
    sessionId: 'sess-1',
    threadTs: '111.222',
    question: 'Q: push? (options: Push both, Hold)',
    answer: 'Push both',
    status: 'answered',
    createdAt: new Date(),
    answeredAt: new Date(),
    ...over,
  };
}

function harness(opts: { rows?: Array<SlackAnswer | null>; frontmost?: string | null } = {}) {
  const delivered: Array<{ answer: string; submit: boolean }> = [];
  const queue = [...(opts.rows ?? [row()])];
  let last: SlackAnswer | null = null;

  const repo = {
    // Returns each queued row in turn, then repeats the final one — mirroring
    // a table that stops changing once the answer lands.
    findLatestForSession: async () => {
      if (queue.length > 0) last = queue.shift() ?? null;
      return last;
    },
  } as never as import('../db/slackAnswersRepository.js').SlackAnswersRepository;

  const delivery: Delivery = {
    frontmostApp: async () => (opts.frontmost === undefined ? WARP : opts.frontmost),
    deliver: async (answer, submit) => {
      delivered.push({ answer, submit });
    },
  };

  return { repo, delivery, delivered };
}

describe('deliverOnce', () => {
  it('delivers an answered row when the terminal has focus', async () => {
    const { repo, delivery, delivered } = harness();
    const outcome = await deliverOnce({ repo, delivery, sessionId: 'sess-1' });

    expect(outcome).toEqual({ delivered: true, answer: 'Push both' });
    expect(delivered).toEqual([{ answer: 'Push both', submit: false }]);
  });

  it('does not press Return unless asked', async () => {
    const { repo, delivery, delivered } = harness();
    await deliverOnce({ repo, delivery, sessionId: 'sess-1', submit: true });
    expect(delivered[0]?.submit).toBe(true);
  });

  it('waits while the question is still pending', async () => {
    const { repo, delivery, delivered } = harness({
      rows: [row({ status: 'pending', answer: null })],
    });
    const outcome = await deliverOnce({ repo, delivery, sessionId: 'sess-1' });

    expect(outcome).toEqual({ delivered: false, reason: 'still pending' });
    expect(delivered).toEqual([]);
  });

  it('reports when the session has no question at all', async () => {
    const { repo, delivery } = harness({ rows: [null] });
    const outcome = await deliverOnce({ repo, delivery, sessionId: 'sess-1' });
    expect(outcome).toEqual({ delivered: false, reason: 'no question for this session' });
  });

  it('refuses to deliver into an app that is not the target', async () => {
    const { repo, delivery, delivered } = harness({ frontmost: 'com.google.Chrome' });
    const outcome = await deliverOnce({ repo, delivery, sessionId: 'sess-1' });

    expect(outcome.delivered).toBe(false);
    expect(delivered).toEqual([]); // nothing typed into the browser
  });

  it('refuses an unsafe answer even with the right app focused', async () => {
    const { repo, delivery, delivered } = harness({
      rows: [row({ answer: 'yes\nrm -rf /' })],
    });
    const outcome = await deliverOnce({ repo, delivery, sessionId: 'sess-1' });

    expect(outcome).toMatchObject({ delivered: false, reason: 'answer spans multiple lines' });
    expect(delivered).toEqual([]);
  });

  it('checks the answer before the window, so focus cannot excuse bad text', async () => {
    const { repo, delivery } = harness({
      rows: [row({ answer: 'a\nb' })],
      frontmost: 'com.google.Chrome',
    });
    const outcome = await deliverOnce({ repo, delivery, sessionId: 'sess-1' });
    expect(outcome.delivered === false && outcome.reason).toBe('answer spans multiple lines');
  });
});

describe('watchForAnswer', () => {
  it('keeps polling until the answer arrives', async () => {
    const { repo, delivery, delivered } = harness({
      rows: [row({ status: 'pending', answer: null }), row({ status: 'pending', answer: null }), row()],
    });
    const logs: string[] = [];

    const outcome = await watchForAnswer({
      repo,
      delivery,
      sessionId: 'sess-1',
      sleep: async () => {},
      log: (m) => logs.push(m),
    });

    expect(outcome).toEqual({ delivered: true, answer: 'Push both' });
    expect(delivered).toHaveLength(1);
    // The same reason twice in a row is logged once.
    expect(logs).toEqual(['waiting: still pending']);
  });

  it('stops when aborted rather than polling forever', async () => {
    const { repo, delivery } = harness({ rows: [row({ status: 'pending', answer: null })] });
    const controller = new AbortController();

    const outcome = await watchForAnswer({
      repo,
      delivery,
      sessionId: 'sess-1',
      signal: controller.signal,
      log: () => {},
      // Abort mid-wait, as Ctrl-C would.
      sleep: async () => controller.abort(),
    });

    expect(outcome).toEqual({ delivered: false, reason: 'aborted' });
  });

  it('recovers once focus returns to the terminal', async () => {
    let frontmost: string | null = 'com.google.Chrome';
    const delivered: string[] = [];
    const repo = {
      findLatestForSession: async () => row(),
    } as never as import('../db/slackAnswersRepository.js').SlackAnswersRepository;

    const outcome = await watchForAnswer({
      repo,
      delivery: {
        frontmostApp: async () => frontmost,
        deliver: async (answer) => void delivered.push(answer),
      },
      sessionId: 'sess-1',
      log: () => {},
      // Focus comes back while waiting, so the next poll succeeds.
      sleep: async () => {
        frontmost = WARP;
      },
    });

    expect(outcome).toEqual({ delivered: true, answer: 'Push both' });
    expect(delivered).toEqual(['Push both']);
  });
});
