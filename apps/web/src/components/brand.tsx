import { cn } from '@nestvault/ui';
import { useTranslations } from 'next-intl';

const VARIANTS = {
  sidebar: { name: 'text-[26px] bg-grad-warm bg-clip-text text-transparent', tagline: 'text-fg-2' },
  auth: { name: 'text-[24px] bg-grad-warm bg-clip-text text-transparent', tagline: 'text-fg-2' },
  // On the coloured brand panel of the auth screens.
  panel: { name: 'text-[30px] text-white', tagline: 'text-white/75' },
} as const;

/** Logo: name and tagline. */
export function Brand({ variant }: { variant: keyof typeof VARIANTS }) {
  const t = useTranslations('brand');
  const styles = VARIANTS[variant];
  return (
    <div className="flex flex-col leading-none">
      <b className={cn('font-extrabold tracking-[0.02em]', styles.name)}>{t('name')}</b>
      <span className={cn('mt-[5px] text-[9.5px] font-semibold tracking-[0.32em]', styles.tagline)}>
        {t('tagline')}
      </span>
    </div>
  );
}
