'use client';

import { Button, Card, EmptyState } from '@nestvault/ui';
import { useTranslations } from 'next-intl';

// A generic message only: the error itself (and its digest) never reach the page.
export default function AuditError({ reset }: { reset: () => void }) {
  const t = useTranslations('audit.states');
  return (
    <Card role="alert">
      <EmptyState
        title={t('errorTitle')}
        description={t('errorText')}
        action={<Button onClick={reset}>{t('retry')}</Button>}
      />
    </Card>
  );
}
