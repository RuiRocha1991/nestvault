import { describe, expect, it } from 'vitest';

import { packageName } from '@nestvault/db';

describe('@nestvault/db', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@nestvault/db');
  });
});
