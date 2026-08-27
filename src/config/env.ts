import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppEnv = {
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.parse(source);
  return {
    databaseUrl: parsed.DATABASE_URL,
    nodeEnv: parsed.NODE_ENV,
  };
}
