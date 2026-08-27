import type { Pool } from 'pg';

export type User = {
  slackUserId: string;
  timezone: string;
  notificationPrefs: Record<string, unknown>;
  quietHoursStart: number;
  quietHoursEnd: number;
  dailyDmCap: number;
  createdAt: Date;
};

type Row = {
  slack_user_id: string;
  timezone: string;
  notification_prefs: Record<string, unknown>;
  quiet_hours_start: number;
  quiet_hours_end: number;
  daily_dm_cap: number;
  created_at: Date;
};

function toUser(row: Row): User {
  return {
    slackUserId: row.slack_user_id,
    timezone: row.timezone,
    notificationPrefs: row.notification_prefs,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    dailyDmCap: row.daily_dm_cap,
    createdAt: row.created_at,
  };
}

export class UsersRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(
    user: Pick<User, 'slackUserId'> & Partial<Omit<User, 'slackUserId' | 'createdAt'>>,
  ): Promise<User> {
    const result = await this.pool.query<Row>(
      `insert into users (slack_user_id, timezone, notification_prefs, quiet_hours_start, quiet_hours_end, daily_dm_cap)
       values ($1, coalesce($2, 'UTC'), coalesce($3, '{}'::jsonb), coalesce($4, 22), coalesce($5, 8), coalesce($6, 10))
       on conflict (slack_user_id) do update set
         timezone = coalesce($2, users.timezone),
         notification_prefs = coalesce($3, users.notification_prefs),
         quiet_hours_start = coalesce($4, users.quiet_hours_start),
         quiet_hours_end = coalesce($5, users.quiet_hours_end),
         daily_dm_cap = coalesce($6, users.daily_dm_cap)
       returning *`,
      [
        user.slackUserId,
        user.timezone ?? null,
        user.notificationPrefs ? JSON.stringify(user.notificationPrefs) : null,
        user.quietHoursStart ?? null,
        user.quietHoursEnd ?? null,
        user.dailyDmCap ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('upsert did not return a row');
    return toUser(row);
  }

  async findById(slackUserId: string): Promise<User | null> {
    const result = await this.pool.query<Row>('select * from users where slack_user_id = $1', [slackUserId]);
    const row = result.rows[0];
    return row ? toUser(row) : null;
  }
}
