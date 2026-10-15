import { getTranslations } from 'next-intl/server';

import { Topbar } from '@webapp/components/topbar';
import type { SettingsTabKey } from '@webapp/lib/settings-tabs';
import { getPoolPermissions } from '@webapp/server/pool';

import { SettingsTabs } from './settings-tabs';

/** Title, one-line lead and tabs of a Definições screen. Each settings page renders this first. */
export async function SettingsHeader({
  poolId,
  active,
  lead,
}: {
  poolId: string;
  active: SettingsTabKey;
  lead?: string;
}) {
  const [t, permissions] = await Promise.all([
    getTranslations('settings'),
    getPoolPermissions(poolId),
  ]);
  return (
    <>
      <Topbar title={t('title')} />
      {!!lead && <p className="-mt-3 mb-5 text-sm text-fg-3">{lead}</p>}
      <SettingsTabs poolId={poolId} active={active} permissions={permissions} />
    </>
  );
}
