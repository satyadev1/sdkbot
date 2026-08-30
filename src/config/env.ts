import { z } from 'zod';

/**
 * Env vars are strings, so a bare `z.boolean()` would treat "false" as truthy.
 * Accepts the usual spellings and rejects anything ambiguous outright.
 */
const booleanish = z
  .string()
  .transform((raw) => raw.trim().toLowerCase())
  .refine((v) => v === '' || ['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off'].includes(v), {
    message: 'must be one of: true/false, 1/0, yes/no, on/off',
  })
  .transform((v) => (v === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(v)));

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SLACK_WEBHOOK_URL: z.union([z.string().url(), z.literal('')]).optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_CHANNEL_ID: z.string().optional(),
  /** Slack member id (`U…`) to @-mention. Without it, nothing is tagged. */
  SLACK_MENTION_USER_ID: z.string().optional(),
  /** Master switch for @-mentions. Defaults to on when an id is set. */
  SLACK_MENTION_ENABLED: booleanish.optional(),
  /** `questions` tags only posts awaiting an answer; `all` tags every post. */
  SLACK_MENTION_SCOPE: z.enum(['questions', 'all']).optional(),
  /**
   * How a recorded answer reaches the waiting prompt. `clipboard` copies it
   * for you to paste and needs no permission; `keystroke` pastes it itself and
   * requires Accessibility access for osascript.
   */
  DELIVER_MODE: z.enum(['clipboard', 'keystroke']).optional(),
  /** Bundle id that must be frontmost to deliver; any known terminal if unset. */
  DELIVER_EXPECTED_APP: z.string().optional(),
  /** Press Return after delivering. Off by default. */
  DELIVER_SUBMIT: booleanish.optional(),
});

export type MentionScope = 'questions' | 'all';
export type DeliverMode = 'clipboard' | 'keystroke';

export type AppEnv = {
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
  slackWebhookUrl?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  slackChannelId?: string;
  slackMentionUserId?: string;
  slackMentionEnabled?: boolean;
  slackMentionScope?: MentionScope;
  deliverMode?: DeliverMode;
  deliverExpectedApp?: string;
  deliverSubmit?: boolean;
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
    slackMentionUserId: parsed.SLACK_MENTION_USER_ID || undefined,
    slackMentionEnabled: parsed.SLACK_MENTION_ENABLED,
    slackMentionScope: parsed.SLACK_MENTION_SCOPE,
    deliverMode: parsed.DELIVER_MODE,
    deliverExpectedApp: parsed.DELIVER_EXPECTED_APP || undefined,
    deliverSubmit: parsed.DELIVER_SUBMIT,
  };
}
