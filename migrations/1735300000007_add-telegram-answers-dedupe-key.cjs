exports.up = (pgm) => {
  pgm.addColumn('telegram_answers', {
    dedupe_key: { type: 'text', notNull: false },
  });
  // Lets the Cursor question watcher insert a question at most once, even
  // across restarts: the watcher re-reads the same pending question bubble on
  // every poll, and it collides on this key instead of posting a duplicate.
  pgm.createIndex('telegram_answers', ['dedupe_key'], {
    unique: true,
    where: 'dedupe_key is not null',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('telegram_answers', ['dedupe_key'], { unique: true });
  pgm.dropColumn('telegram_answers', 'dedupe_key');
};
