import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SLACK_WEBHOOK_URL: z.union([z.string().url(), z.literal('')]).optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_CHANNEL_ID: z.string().optional(),
});

export type AppEnv = {
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
  slackWebhookUrl?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  slackChannelId?: string;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.parse(source);
  return {
    databaseUrl: parsed.DATABASE_URL,
    nodeEnv: parsed.NODE_ENV,
    slackWebhookUrl: parsed.SLACK_WEBHOOK_URL || undefined,
    slackBotToken: parsed.SLACK_BOT_TOKEN || undefined,
    slackAppToken: parsed.SLACK_APP_TOKEN || undefined,
    slackChannelId: parsed.SLACK_CHANNEL_ID || undefined,
  };
}
