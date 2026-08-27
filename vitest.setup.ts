// Validate DATABASE_URL is set for tests (see .env.example)
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set (see .env.example) before running tests');
}
