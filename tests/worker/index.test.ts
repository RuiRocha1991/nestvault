import { describe, expect, it } from 'vitest';

import { packageName } from '@nestvault/worker';

describe('@nestvault/worker', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@nestvault/worker');
  });
});
