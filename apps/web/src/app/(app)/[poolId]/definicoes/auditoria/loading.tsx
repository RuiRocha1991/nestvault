import { Card } from '@nestvault/ui';
import { getTranslations } from 'next-intl/server';

const ROWS = 8;

// Skeleton while the first page of the log loads (the tabs stay out: they need the same data).
export default async function AuditLoading() {
  const t = await getTranslations('audit');
  return (
    <Card role="status" aria-live="polite" aria-label={t('states.loading')}>
      <span className="sr-only">{t('states.loading')}</span>
      <div aria-hidden className="h-[34px] w-2/3 animate-pulse rounded-sm bg-panel-2" />
      {Array.from({ length: ROWS }, (_, index) => (
        <div key={index} aria-hidden className="h-[42px] animate-pulse rounded-sm bg-panel-2" />
      ))}
    </Card>
  );
}
