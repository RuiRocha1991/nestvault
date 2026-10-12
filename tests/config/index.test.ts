import { describe, expect, it } from 'vitest';

import { packageName } from '@nestvault/config';

describe('@nestvault/config', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@nestvault/config');
  });
});
