// Prints a random 32-byte secret as base64 (BETTER_AUTH_SECRET, APP_ENCRYPTION_KEY).
// Usage: pnpm gen:secret
import { randomBytes } from 'node:crypto';
import { stdout } from 'node:process';

stdout.write(`${randomBytes(32).toString('base64')}\n`);
