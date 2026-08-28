exports.up = (pgm) => {
  pgm.createTable('slack_answers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: { type: 'text', notNull: true },
    thread_ts: { type: 'text', notNull: false },
    question: { type: 'text', notNull: false },
    answer: { type: 'text', notNull: false },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status in ('pending','answered')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    answered_at: { type: 'timestamptz', notNull: false },
  });
  pgm.createIndex('slack_answers', ['session_id', 'created_at']);
  pgm.createIndex('slack_answers', ['thread_ts']);
};

exports.down = (pgm) => {
  pgm.dropTable('slack_answers');
};
