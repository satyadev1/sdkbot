import type { Pool } from 'pg';

export type ReminderState = 'open' | 'done' | 'dismissed';
export type EscalationStage = 'initial' | 'followup_30m' | 'followup_2h' | 'daily';

export type Reminder = {
  id: string;
  ownerSlackUserId: string;
  title: string;
  state: ReminderState;
  dueAt: Date;
  nextNotificationAt: Date | null;
  escalationStage: EscalationStage;
  pingsSent: number;
  accountabilityChannel: string | null;
  sourcePermalink: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Row = {
  id: string;
  owner_slack_user_id: string;
  title: string;
  state: ReminderState;
  due_at: Date;
  next_notification_at: Date | null;
  escalation_stage: EscalationStage;
  pings_sent: number;
  accountability_channel: string | null;
  source_permalink: string | null;
  created_at: Date;
  updated_at: Date;
};

function toReminder(row: Row): Reminder {
  return {
    id: row.id,
    ownerSlackUserId: row.owner_slack_user_id,
    title: row.title,
    state: row.state,
    dueAt: row.due_at,
    nextNotificationAt: row.next_notification_at,
    escalationStage: row.escalation_stage,
    pingsSent: row.pings_sent,
    accountabilityChannel: row.accountability_channel,
    sourcePermalink: row.source_permalink,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RemindersRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    ownerSlackUserId: string;
    title: string;
    dueAt: Date;
    sourcePermalink?: string | null;
    accountabilityChannel?: string | null;
  }): Promise<Reminder> {
    const result = await this.pool.query<Row>(
      `insert into reminders (owner_slack_user_id, title, due_at, next_notification_at, source_permalink, accountability_channel)
       values ($1, $2, $3, $3, $4, $5)
       returning *`,
      [input.ownerSlackUserId, input.title, input.dueAt, input.sourcePermalink ?? null, input.accountabilityChannel ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('create did not return a row');
    return toReminder(row);
  }

  async findById(id: string): Promise<Reminder | null> {
    const result = await this.pool.query<Row>('select * from reminders where id = $1', [id]);
    const row = result.rows[0];
    return row ? toReminder(row) : null;
  }

  async findDueForNotification(before: Date): Promise<Reminder[]> {
    const result = await this.pool.query<Row>(
      `select * from reminders
       where state = 'open' and next_notification_at is not null and next_notification_at <= $1
       order by next_notification_at asc`,
      [before],
    );
    return result.rows.map(toReminder);
  }

  async updateAfterAction(
    id: string,
    patch: {
      state?: ReminderState;
      escalationStage?: EscalationStage;
      pingsSent?: number;
      nextNotificationAt?: Date | null;
    },
  ): Promise<Reminder> {
    const result = await this.pool.query<Row>(
      `update reminders set
         state = coalesce($2, state),
         escalation_stage = coalesce($3, escalation_stage),
         pings_sent = coalesce($4, pings_sent),
         next_notification_at = case when $5::boolean then $6::timestamptz else next_notification_at end,
         updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        patch.state ?? null,
        patch.escalationStage ?? null,
        patch.pingsSent ?? null,
        'nextNotificationAt' in patch,
        patch.nextNotificationAt ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`reminder ${id} not found`);
    return toReminder(row);
  }
}
