import { SocketModeClient } from '@slack/socket-mode';
import type { SlackAnswersRepository } from '../db/slackAnswersRepository.js';

type SlackMessageEvent = {
  type: string;
  subtype?: string;
  text?: string;
  thread_ts?: string;
  bot_id?: string;
};

export function startSlackBridge(appToken: string, repo: SlackAnswersRepository): SocketModeClient {
  const client = new SocketModeClient({ appToken });

  client.on('message', async ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
    await ack();
    if (event.bot_id || event.subtype || !event.thread_ts || !event.text) {
      return;
    }
    const answered = await repo.recordAnswer(event.thread_ts, event.text);
    if (answered) {
      console.log(`Recorded answer for session ${answered.sessionId}: ${answered.answer}`);
    }
  });

  return client;
}
