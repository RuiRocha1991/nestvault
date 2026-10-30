import { Card, Chip, EmptyState } from '@nestvault/ui';
import { getTranslations } from 'next-intl/server';

/** A Free pool opens a Pro page: the prompt replaces the content (the demo preview is NES-103). */
export async function UpgradePrompt() {
  const t = await getTranslations('realEstate.locked');
  return (
    <Card>
      <EmptyState
        title={
          <span className="inline-flex items-center gap-2">
            {t('title')}
            <Chip tone="accent">{t('tag')}</Chip>
          </span>
        }
        description={t('text')}
      />
    </Card>
  );
}
