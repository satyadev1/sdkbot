import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { getPool } from '../db/client.js';
import { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { TelegramAnswersRepository } from '../db/telegramAnswersRepository.js';
import { askSlack } from './askSlack.js';
import { askTelegram } from './askTelegram.js';

/**
 * MCP server exposing `ask_slack` and `ask_telegram`: blocking tools that
 * post a question to Slack/Telegram and wait for the reply, so the answer
 * comes back as the tool's result instead of needing to be typed into an
 * `AskUserQuestion` prompt by hand. Claude must be told (e.g. in CLAUDE.md)
 * to prefer these tools over AskUserQuestion when the answer should arrive
 * from Slack or Telegram.
 */
export function createServer(): McpServer {
  const env = loadEnv();
  const pool = getPool();
  const slackRepo = new SlackAnswersRepository(pool);
  const telegramRepo = new TelegramAnswersRepository(pool);

  const server = new McpServer({ name: 'sdkbot-ask', version: '0.1.0' });

  server.registerTool(
    'ask_slack',
    {
      title: 'Ask a question over Slack',
      description:
        'Posts a question to Slack and blocks until it is answered in that thread, ' +
        'returning the reply as this tool\'s result. Use this instead of asking the ' +
        'user directly when the answer should come back from Slack rather than the terminal.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Identifier for this Claude Code session'),
        question: z.string().min(1).describe('The question to post to Slack'),
      },
    },
    async ({ sessionId, question }) => {
      const result = await askSlack(sessionId, question, { env, repo: slackRepo });
      if (!result.answered) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Timed out waiting for a Slack reply.' }],
        };
      }
      return { content: [{ type: 'text', text: result.answer }] };
    },
  );

  server.registerTool(
    'ask_telegram',
    {
      title: 'Ask a question over Telegram',
      description:
        'Posts a question to Telegram and blocks until it is answered (reply to that message), ' +
        'returning the reply as this tool\'s result. Use this instead of ask_slack when the user ' +
        'wants the question to reach Telegram instead of (or in addition to) Slack.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Identifier for this Claude Code session'),
        question: z.string().min(1).describe('The question to post to Telegram'),
      },
    },
    async ({ sessionId, question }) => {
      const result = await askTelegram(sessionId, question, { env, repo: telegramRepo });
      if (!result.answered) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Timed out waiting for a Telegram reply.' }],
        };
      }
      return { content: [{ type: 'text', text: result.answer }] };
    },
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('ask-slack MCP server failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
