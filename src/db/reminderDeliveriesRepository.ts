import type { Pool } from 'pg';

export type ReminderDelivery = {
  id: string;
  reminderId: string;
  kind: 'initial' | 'followup' | 'escalation';
  sentAt: Date;
  actionTaken: 'done' | 'snooze_15' | 'snooze_1h' | 'reschedule' | 'dismiss' | null;
  slackMessageTs: string | null;
};

type Row = {
  id: string;
  reminder_id: string;
  kind: ReminderDelivery['kind'];
  sent_at: Date;
  action_taken: ReminderDelivery['actionTaken'];
  slack_message_ts: string | null;
};

function toDelivery(row: Row): ReminderDelivery {
  return {
    id: row.id,
    reminderId: row.reminder_id,
    kind: row.kind,
    sentAt: row.sent_at,
    actionTaken: row.action_taken,
    slackMessageTs: row.slack_message_ts,
  };
}

export class ReminderDeliveriesRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: {
    reminderId: string;
    kind: ReminderDelivery['kind'];
    slackMessageTs?: string | null;
  }): Promise<ReminderDelivery> {
    const result = await this.pool.query<Row>(
      `insert into reminder_deliveries (reminder_id, kind, slack_message_ts)
       values ($1, $2, $3)
       returning *`,
      [input.reminderId, input.kind, input.slackMessageTs ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('record did not return a row');
    return toDelivery(row);
  }

  async recordAction(
    deliveryId: string,
    actionTaken: NonNullable<ReminderDelivery['actionTaken']>,
  ): Promise<ReminderDelivery> {
    const result = await this.pool.query<Row>(
      `update reminder_deliveries set action_taken = $2 where id = $1 returning *`,
      [deliveryId, actionTaken],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`delivery ${deliveryId} not found`);
    return toDelivery(row);
  }

  async countForReminder(reminderId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'select count(*) from reminder_deliveries where reminder_id = $1',
      [reminderId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async countForUserToday(ownerSlackUserId: string, day: Date): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `select count(*) from reminder_deliveries d
       join reminders r on r.id = d.reminder_id
       where r.owner_slack_user_id = $1
         and d.sent_at >= date_trunc('day', $2::timestamptz)
         and d.sent_at < date_trunc('day', $2::timestamptz) + interval '1 day'`,
      [ownerSlackUserId, day],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
