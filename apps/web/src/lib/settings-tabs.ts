import type { Permission } from '@nestvault/services';

export type SettingsTabKey = 'params' | 'plan' | 'members' | 'audit';

export interface SettingsTab {
  key: SettingsTabKey;
  /** Path below `/[poolId]/definicoes`; empty for the first tab. */
  path: string;
  /** False until the screen exists: the tab shows, disabled, so the header is already complete. */
  available: boolean;
  /** The tab only appears for people holding this permission (cosmetic: the service decides). */
  requires?: Permission;
}

/** The four tabs of the Definições header, in order. A task that builds a tab flips `available`. */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { key: 'params', path: '', available: true },
  { key: 'plan', path: '/plano', available: false },
  { key: 'members', path: '/membros', available: true },
  { key: 'audit', path: '/auditoria', available: true, requires: 'audit.read' },
];

export const settingsPath = (poolId: string, tab: SettingsTab) =>
  `/${poolId}/definicoes${tab.path}`;
