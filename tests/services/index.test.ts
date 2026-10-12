import { describe, expect, it } from 'vitest';

import { packageName } from '@nestvault/services';

describe('@nestvault/services', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@nestvault/services');
  });
});
