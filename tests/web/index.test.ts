import { describe, expect, it } from 'vitest';

import { packageName } from '@nestvault/web';

describe('@nestvault/web', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@nestvault/web');
  });
});
