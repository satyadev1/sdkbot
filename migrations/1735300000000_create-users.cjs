exports.up = (pgm) => {
  pgm.createTable('users', {
    slack_user_id: { type: 'text', primaryKey: true },
    timezone: { type: 'text', notNull: true, default: 'UTC' },
    notification_prefs: { type: 'jsonb', notNull: true, default: '{}' },
    quiet_hours_start: { type: 'integer', notNull: true, default: 22 },
    quiet_hours_end: { type: 'integer', notNull: true, default: 8 },
    daily_dm_cap: { type: 'integer', notNull: true, default: 10 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('users');
};
