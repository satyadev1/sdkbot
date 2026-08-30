import { loadEnv } from '../config/env.js';
import { getPool } from '../db/client.js';
import { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { deliveryFor, hasAccessibilityAccess } from '../deliver/backends.js';
import { watchForAnswer } from '../deliver/watcher.js';

/**
 * Waits for a Slack answer to this session's question and puts it in front of
 * the waiting prompt.
 *
 * `wait-answer` prints the answer to its own stdout, which is no help when the
 * prompt is what needs it. This delivers into the focused window instead.
 */
async function main() {
  const sessionId = process.argv[2] ?? '';
  if (!sessionId) {
    console.error('Usage: npm run deliver-answer -- <session-id>');
    process.exit(1);
  }

  const env = loadEnv();
  const mode = env.deliverMode ?? 'clipboard';

  if (mode === 'keystroke' && !(await hasAccessibilityAccess())) {
    // Failing here is deliberate: silently falling back to the clipboard would
    // leave you waiting for a paste that never comes.
    console.error(
      'DELIVER_MODE=keystroke needs Accessibility access.\n' +
        'Grant it in System Settings → Privacy & Security → Accessibility\n' +
        '(enable your terminal app), or set DELIVER_MODE=clipboard.',
    );
    process.exit(1);
  }

  const pool = getPool();
  const repo = new SlackAnswersRepository(pool);
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());

  const scope = env.deliverExpectedApp ?? 'any known terminal';
  console.log(`Waiting for a Slack answer for ${sessionId} — ${mode}, target: ${scope}`);

  const outcome = await watchForAnswer({
    repo,
    delivery: deliveryFor(mode),
    sessionId,
    expectedApp: env.deliverExpectedApp,
    submit: env.deliverSubmit ?? false,
    signal: controller.signal,
    log: (m) => console.log(m),
  });

  await pool.end();

  if (!outcome.delivered) {
    console.error(`not delivered: ${outcome.reason}`);
    process.exit(1);
  }
  console.log(
    mode === 'clipboard'
      ? `copied: ${outcome.answer} — press Cmd-V to paste`
      : `delivered: ${outcome.answer}`,
  );
}

main().catch((err) => {
  console.error('deliver-answer failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
