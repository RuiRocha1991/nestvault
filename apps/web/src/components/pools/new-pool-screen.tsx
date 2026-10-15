import { Download, Mail } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { CreatePoolForm } from '@webapp/components/pools/create-pool-form';

/** Screen 63. `first` is true for a user without any pool: it adds the two shortcut hints. */
export async function NewPoolScreen({ first }: { first: boolean }) {
  const t = await getTranslations('pools.create');
  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-5 pt-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">{t('title')}</h1>
        <p className="text-md text-fg-2">{t(first ? 'leadFirst' : 'leadNext')}</p>
      </div>
      <section className="flex flex-col gap-3.5 rounded-md bg-panel px-5 py-5 shadow-card">
        <CreatePoolForm />
      </section>
      {first ? (
        <>
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.1em] text-fg-3">
            <span className="h-px flex-1 bg-line" />
            {t('or')}
            <span className="h-px flex-1 bg-line" />
          </div>
          <p className="flex items-center gap-3 rounded-md bg-panel px-5 py-4 text-md text-fg-2 shadow-card">
            <Mail aria-hidden className="size-[18px] shrink-0 text-fg-3" />
            {t('invited')}
          </p>
          <p className="flex items-center gap-3 rounded-md bg-panel px-5 py-4 text-md text-fg-2 shadow-card">
            <Download aria-hidden className="size-[18px] shrink-0 text-fg-3" />
            {t('prototype')}
          </p>
        </>
      ) : (
        <Link href="/pools?escolher=1" className="text-sm font-semibold text-accent-2 no-underline">
          {t('back')}
        </Link>
      )}
    </div>
  );
}
