import { Card } from '@nestvault/ui';
import { getTranslations } from 'next-intl/server';

const ROWS = 4;

// Skeleton while the members load (the tabs stay out: they need the same permissions).
export default async function MembersLoading() {
  const t = await getTranslations('members.states');
  return (
    <Card role="status" aria-live="polite" aria-label={t('loading')}>
      <span className="sr-only">{t('loading')}</span>
      <div aria-hidden className="h-[34px] w-1/3 animate-pulse rounded-sm bg-panel-2" />
      {Array.from({ length: ROWS }, (_, index) => (
        <div key={index} aria-hidden className="h-[46px] animate-pulse rounded-sm bg-panel-2" />
      ))}
    </Card>
  );
}
