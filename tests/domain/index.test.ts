import { describe, expect, it } from 'vitest';

import { packageName } from '@nestvault/domain';

describe('@nestvault/domain', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@nestvault/domain');
  });
});
