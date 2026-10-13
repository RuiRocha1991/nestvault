import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Brand } from '@webapp/components/brand';

/** Decorative net-worth card of the brand panel. Sample figures, not user data. */
function DecorativeCard() {
  const t = useTranslations('auth.brand');
  return (
    <div
      aria-hidden
      className="absolute right-10 top-[84px] w-[300px] rotate-3 rounded-lg border border-white/20 bg-white/10 p-4 backdrop-blur-[6px]"
    >
      <small className="block text-xs font-semibold uppercase tracking-[0.08em] opacity-75">
        {t('sampleLabel')}
      </small>
      <b className="mb-2 mt-1 block text-2xl font-extrabold tabular-nums">{t('sampleValue')}</b>
      <svg viewBox="0 0 260 60" width="100%" height="56">
        <defs>
          <linearGradient id="auth-deco-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".45" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,48 C30,44 40,36 70,38 S120,22 150,26 S210,10 260,6 V60 H0Z"
          fill="url(#auth-deco-fill)"
        />
        <path
          d="M0,48 C30,44 40,36 70,38 S120,22 150,26 S210,10 260,6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

const BULLETS = ['isolated', 'persistent', 'permissions'] as const;

/**
 * Two-column layout of the public screens: brand panel + form column. Below 860 px the panel is
 * hidden and only the logo shows above the card.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations('auth.brand');
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] drawer:grid-cols-1">
      <aside className="auth-brand relative flex flex-col gap-8 overflow-hidden px-14 py-12 text-white drawer:hidden">
        <div className="px-3">
          <Brand variant="panel" />
        </div>
        <DecorativeCard />
        <h2 className="mt-auto max-w-[460px] text-[34px] font-extrabold leading-[1.15] tracking-[-0.02em]">
          {t('headline')}
        </h2>
        <p className="max-w-[440px] text-[15px] text-white/80">{t('lead')}</p>
        <ul className="m-0 flex list-none flex-col gap-3 p-0 text-base">
          {BULLETS.map((key) => (
            <li key={key} className="flex items-center gap-2.5">
              <Check
                aria-hidden
                strokeWidth={2.6}
                className="size-[18px] rounded-full bg-white/20 p-[3px]"
              />
              {t(`bullets.${key}`)}
            </li>
          ))}
        </ul>
      </aside>
      <div className="hidden bg-bg px-5 pt-5 drawer:flex">
        <Brand variant="auth" />
      </div>
      <main
        id="content"
        className="flex flex-col items-center justify-center gap-5 bg-bg px-8 py-10 drawer:justify-start drawer:px-4 drawer:pb-8 drawer:pt-6"
      >
        {children}
      </main>
    </div>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-[min(420px,100%)] flex-col gap-[18px] rounded-lg bg-panel p-8 shadow-card drawer:px-5 drawer:py-6">
      {children}
    </div>
  );
}

export function AuthFoot({ children }: { children: ReactNode }) {
  return <p className="max-w-[420px] text-center text-sm text-fg-3">{children}</p>;
}
