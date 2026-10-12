import { describe, expect, it } from 'vitest';

import { packageName } from '@nestvault/ui';

describe('@nestvault/ui', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@nestvault/ui');
  });
});
