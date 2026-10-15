import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from '@nestvault/services';

import messages from '../../apps/web/messages/pt-PT.json';
import { splitAction } from '../../apps/web/src/lib/audit-view';
import { ALLOWED_META_KEYS } from '../../packages/services/src/audit/meta';

const { audit, settings } = messages;

describe('audit and settings messages', () => {
  it('words every audit action, so a new action cannot reach the screen without a label', () => {
    for (const action of AUDIT_ACTIONS) {
      const { category, name } = splitAction(action);
      expect(audit.actions, action).toHaveProperty([category, name]);
    }
  });

  it('names every category and every key an entry may carry', () => {
    for (const category of AUDIT_CATEGORIES) expect(audit.categories).toHaveProperty(category);
    for (const key of ALLOWED_META_KEYS) expect(audit.meta, key).toHaveProperty(key);
  });

  it('labels the four settings tabs', () => {
    expect(Object.keys(settings.tabs)).toEqual(['params', 'plan', 'members', 'audit']);
  });
});
