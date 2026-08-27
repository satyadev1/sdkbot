// Ensure DATABASE_URL is set for tests
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://focuspilot:focuspilot@localhost:5432/focuspilot';
}
