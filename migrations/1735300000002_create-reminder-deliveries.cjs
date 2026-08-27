exports.up = (pgm) => {
  pgm.createTable('reminder_deliveries', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    reminder_id: { type: 'uuid', notNull: true, references: 'reminders(id)', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true, check: "kind in ('initial','followup','escalation')" },
    sent_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    action_taken: {
      type: 'text',
      notNull: false,
      check: "action_taken in ('done','snooze_15','snooze_1h','reschedule','dismiss')",
    },
    slack_message_ts: { type: 'text', notNull: false },
  });
  // Idempotency for scheduled sends: at most one delivery row per
  // (reminder, escalation stage) tick — a duplicate scheduler tick for the
  // same stage must not create a second delivery row.
  pgm.addConstraint('reminder_deliveries', 'reminder_deliveries_reminder_kind_unique', {
    unique: ['reminder_id', 'kind', 'sent_at'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('reminder_deliveries');
};
