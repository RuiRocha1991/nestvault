// pnpm db:seed -> creates the first owner (SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD, prompted when
// missing). Idempotent: running it again changes nothing. Never prints the password.
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

import { runtimeEnv, seedEnv } from '@nestvault/config/node';
import { createIdentityDatabase } from '@nestvault/db';
import { seedOwner } from '@nestvault/services';

async function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const answer = rl.question(question);
  muted = hidden;
  const value = await answer;
  rl.close();
  if (hidden) process.stdout.write('\n');
  return value;
}

async function main() {
  const env = runtimeEnv();
  const seed = seedEnv();
  const email = seed.SEED_OWNER_EMAIL || (await ask('Owner email: '));
  const password = seed.SEED_OWNER_PASSWORD || (await ask('Owner password: ', true));
  const name = seed.SEED_OWNER_NAME || 'Owner';

  const identity = createIdentityDatabase(env.DATABASE_URL_IDENTITY, 1);
  try {
    const result = await seedOwner(identity, { name, email, password });
    console.log(result.created ? 'Owner created.' : 'Owner already exists; nothing changed.');
  } finally {
    await identity.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'Seed failed.');
  process.exit(1);
});
