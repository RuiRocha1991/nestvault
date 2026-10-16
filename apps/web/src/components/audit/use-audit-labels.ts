'use client';

import { useTranslations } from 'next-intl';

import {
  FAILED_SIGN_IN,
  shortCode,
  splitAction,
  type AuditEntryView,
} from '@webapp/lib/audit-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns the codes of an entry into words. Unknown codes (an action added later, a role we do not
 * know) fall back to the code itself, so an entry never renders empty. Everything returned is
 * plain text: React escapes it, and names come from the user table, so they may hold any characters.
 */
export function useAuditLabels(people: Readonly<Record<string, string>>) {
  const t = useTranslations('audit');
  const pools = useTranslations('pools');

  const nameOf = (id: string | null | undefined) => (id ? people[id.toLowerCase()] : undefined);
  const roleLabel = (value: unknown) => {
    const role = typeof value === 'string' ? value : '';
    return pools.has(`roles.${role}`) ? pools(`roles.${role}`) : role;
  };

  return {
    /** Who did it, or `null` when nobody was identified (a failed sign-in, the system). */
    person: (entry: AuditEntryView) => nameOf(entry.userId) ?? null,

    category: (action: string) => {
      const { category } = splitAction(action);
      return t.has(`categories.${category}`) ? t(`categories.${category}`) : category;
    },

    title: (action: string) => {
      const { category, name } = splitAction(action);
      return t.has(`actions.${category}.${name}`) ? t(`actions.${category}.${name}`) : action;
    },

    /** The "target" column: who or what the action was about, in words. */
    target: (entry: AuditEntryView): string => {
      if (entry.action === FAILED_SIGN_IN) return t('target.signinFailed');
      const { category } = splitAction(entry.action);
      const role = entry.meta.role;
      if (category === 'invite' && entry.target && UUID.test(entry.target)) {
        const code = shortCode(entry.target);
        return role
          ? t('target.inviteRole', { code, role: roleLabel(role) })
          : t('target.invite', { code });
      }
      const name = nameOf(entry.target) ?? nameOf(String(entry.meta.targetUserId ?? ''));
      if (!name) return t('target.none');
      if (entry.meta.previousRole && role) {
        return t('target.roleChanged', {
          name,
          from: roleLabel(entry.meta.previousRole),
          to: roleLabel(role),
        });
      }
      return role
        ? t('target.personRole', { name, role: roleLabel(role) })
        : t('target.person', { name });
    },

    /** A value of the "action data" box: a role is translated, anything else is shown as it is. */
    metaValue: (key: string, value: string | number | boolean) =>
      key === 'role' || key === 'previousRole' || key === 'actorRole'
        ? roleLabel(value)
        : String(value),

    metaKey: (key: string) => (t.has(`meta.${key}`) ? t(`meta.${key}`) : key),
  };
}
