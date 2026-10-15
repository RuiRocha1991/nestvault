import { cn } from '@nestvault/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { SETTINGS_TABS, settingsPath, type SettingsTabKey } from '@webapp/lib/settings-tabs';

const tabStyles = '-mb-px whitespace-nowrap border-b-2 pb-3 text-md font-medium no-underline';

export interface SettingsTabsProps {
  poolId: string;
  active: SettingsTabKey;
  /** The permissions of the caller; tabs that `requires` one the caller lacks are left out. */
  permissions: readonly string[];
}

/** The Definições tab header shared by every settings screen (mockups 35, 36, 64, 69, 76). */
export function SettingsTabs({ poolId, active, permissions }: SettingsTabsProps) {
  const t = useTranslations('settings');
  const tabs = SETTINGS_TABS.filter((tab) => !tab.requires || permissions.includes(tab.requires));

  return (
    <nav aria-label={t('tabsLabel')} className="mb-5 overflow-x-auto border-b border-line">
      <ul className="m-0 flex list-none gap-5 p-0">
        {tabs.map((tab) => (
          <li key={tab.key}>
            {tab.available ? (
              <Link
                href={settingsPath(poolId, tab)}
                aria-current={tab.key === active ? 'page' : undefined}
                className={cn(
                  tabStyles,
                  'block',
                  tab.key === active
                    ? 'border-accent text-fg'
                    : 'border-transparent text-fg-2 hover:text-fg',
                )}
              >
                {t(`tabs.${tab.key}`)}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className={cn(tabStyles, 'block cursor-default border-transparent text-fg-3')}
              >
                {t(`tabs.${tab.key}`)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
