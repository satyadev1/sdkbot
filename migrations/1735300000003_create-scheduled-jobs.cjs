exports.up = (pgm) => {
  pgm.createTable('scheduled_jobs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    kind: { type: 'text', notNull: true },
    run_at: { type: 'timestamptz', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status in ('pending','running','done','failed','dead_letter')",
    },
    attempts: { type: 'integer', notNull: true, default: 0 },
    payload: { type: 'jsonb', notNull: true, default: '{}' },
    last_error: { type: 'text', notNull: false },
    dedupe_key: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('scheduled_jobs', ['status', 'run_at']);
  // Prevents scheduling two identical pending jobs for the same reminder
  // tick (e.g. a retried "schedule next notification" call).
  pgm.createIndex('scheduled_jobs', ['dedupe_key'], {
    unique: true,
    where: "dedupe_key is not null and status = 'pending'",
  });
};

exports.down = (pgm) => {
  pgm.dropTable('scheduled_jobs');
};
