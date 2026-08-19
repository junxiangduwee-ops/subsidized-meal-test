#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { prepareSchema } from './db-config.mjs';

/**
 * Runs a Prisma CLI command against whichever schema matches the configured
 * database. Usage: `node scripts/prisma.mjs db push`
 */

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/prisma.mjs <prisma command...>');
  process.exit(1);
}

const db = prepareSchema();

if (db.inferred) {
  console.log(
    `  i No DATABASE_URL configured - using SQLite at ${db.url}\n` +
      `    Set DATABASE_URL in .env to point at Postgres instead.`,
  );
}
console.log(`  · prisma ${args.join(' ')}  [${db.provider}]`);

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['prisma', ...args, '--schema', db.schema],
  {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: db.url, DIRECT_URL: process.env.DIRECT_URL || db.url },
    shell: process.platform === 'win32',
  },
);

if (result.status === 0 && (args.includes('push') || args.includes('migrate'))) {
  console.log('Database updated! Automatically triggering seed script...');

  const seedScriptPath = path.join(process.cwd(), 'scripts', 'seed.mjs');

  spawnSync(
    process.platform === 'win32' ? 'node.cmd' : 'node',
    [seedScriptPath],
    {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: db.url }, // Passes the Supabase URL straight to your seed script
      shell: process.platform === 'win32',
    }
  );
}

process.exit(result.status ?? 1);

