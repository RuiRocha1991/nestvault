import {
  CalendarDays,
  ChartPie,
  House,
  Landmark,
  Receipt,
  SlidersHorizontal,
  Target,
  type LucideIcon,
} from 'lucide-react';

export type NavItemKey =
  'overview' | 'portfolios' | 'goals' | 'expenses' | 'months' | 'accounts' | 'settings';

export interface NavItem {
  key: NavItemKey;
  /** Path below `/[poolId]`; empty for the overview. */
  path: string;
  icon: LucideIcon;
}

export interface NavGroup {
  key: 'general' | 'investments' | 'daily' | 'app';
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { key: 'general', items: [{ key: 'overview', path: '', icon: House }] },
  {
    key: 'investments',
    items: [
      { key: 'portfolios', path: '/portfolios', icon: ChartPie },
      { key: 'goals', path: '/objetivos', icon: Target },
    ],
  },
  {
    key: 'daily',
    items: [
      { key: 'expenses', path: '/despesas', icon: Receipt },
      { key: 'months', path: '/meses', icon: CalendarDays },
      { key: 'accounts', path: '/contas', icon: Landmark },
    ],
  },
  {
    key: 'app',
    items: [{ key: 'settings', path: '/definicoes', icon: SlidersHorizontal }],
  },
];

/** Screens that exist as placeholders until their task lands: URL segment → nav key. */
export const SECTION_PAGES: Readonly<Record<string, NavItemKey>> = {
  portfolios: 'portfolios',
  objetivos: 'goals',
  despesas: 'expenses',
  meses: 'months',
  contas: 'accounts',
  definicoes: 'settings',
};
