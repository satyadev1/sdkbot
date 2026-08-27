exports.up = (pgm) => {
  pgm.createTable('reminders', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_slack_user_id: { type: 'text', notNull: true, references: 'users(slack_user_id)' },
    title: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true, default: 'open', check: "state in ('open','done','dismissed')" },
    due_at: { type: 'timestamptz', notNull: true },
    next_notification_at: { type: 'timestamptz', notNull: false },
    escalation_stage: {
      type: 'text',
      notNull: true,
      default: 'initial',
      check: "escalation_stage in ('initial','followup_30m','followup_2h','daily')",
    },
    pings_sent: { type: 'integer', notNull: true, default: 0 },
    accountability_channel: { type: 'text', notNull: false },
    source_permalink: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('reminders', ['state', 'next_notification_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('reminders');
};
