import { Card } from '@nestvault/ui';
import { getTranslations } from 'next-intl/server';

const CARDS = 3;

// Skeleton while the accounts load.
export default async function AccountsLoading() {
  const t = await getTranslations('accounts.states');
  return (
    <div role="status" aria-live="polite" aria-label={t('loading')} className="flex flex-col gap-4">
      <span className="sr-only">{t('loading')}</span>
      <Card aria-hidden>
        <div className="h-[34px] w-1/3 animate-pulse rounded-sm bg-panel-2" />
        <div className="h-[46px] animate-pulse rounded-sm bg-panel-2" />
      </Card>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
        {Array.from({ length: CARDS }, (_, index) => (
          <Card key={index} aria-hidden>
            <div className="h-[120px] animate-pulse rounded-sm bg-panel-2" />
          </Card>
        ))}
      </div>
    </div>
  );
}
