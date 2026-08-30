import type { AppEnv, MentionScope } from '../config/env.js';

/**
 * Decides whether a Slack post should @-mention the user, and renders the
 * prefix.
 *
 * Slack only turns `<@U…>` into a real, notifying mention — a plain `@name` is
 * inert text. So a member id is mandatory; there is no name-based fallback.
 *
 * Configuration (all optional, sensible defaults):
 * - `SLACK_MENTION_USER_ID` — the `U…` id. Absent means no mentions at all.
 * - `SLACK_MENTION_ENABLED` — master switch. Defaults to on once an id is set,
 *   so setting the id is enough to get mentions; set it to `false` to mute
 *   them without discarding the id.
 * - `SLACK_MENTION_SCOPE` — `questions` (default) tags only posts that need an
 *   answer; `all` also tags "finished" notices.
 */

export type MentionKind = 'question' | 'notice';

export type MentionConfig = {
  userId?: string;
  enabled: boolean;
  scope: MentionScope;
};

const DEFAULT_SCOPE: MentionScope = 'questions';

export function mentionConfigFromEnv(env: AppEnv): MentionConfig {
  return {
    userId: env.slackMentionUserId,
    // An id with no explicit toggle means "on" — otherwise setting the id
    // alone would silently do nothing.
    enabled: env.slackMentionEnabled ?? true,
    scope: env.slackMentionScope ?? DEFAULT_SCOPE,
  };
}

/** True when a post of this kind should carry a mention. */
export function shouldMention(config: MentionConfig, kind: MentionKind): boolean {
  if (!config.enabled) return false;
  if (!config.userId) return false;
  return config.scope === 'all' || kind === 'question';
}

/**
 * Renders the mention prefix for a post, or `''` when it should not be tagged.
 * Kept separate from `shouldMention` so callers can build text in one step.
 */
export function mentionPrefix(config: MentionConfig, kind: MentionKind): string {
  return shouldMention(config, kind) ? `<@${config.userId}> ` : '';
}
