'use client';

import { Modal } from '@nestvault/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { ImportScreen, type ImportScreenProps } from './import-screen';

export interface ImportDialogProps extends Omit<ImportScreenProps, 'history' | 'onClose'> {
  /** Modal 22 (a bank statement) or modal 21 (investment transactions): the title; the flow is the same. */
  kind: 'bank' | 'broker';
  onClose: () => void;
}

/**
 * Modals 21 and 22 opened from Contas e poupanças: the same flow as the import page (format
 * detection decides what the file is), in a dialog, without the history.
 */
export function ImportDialog({ kind, onClose, ...flow }: ImportDialogProps) {
  const t = useTranslations('imports.dialog');
  return (
    <Modal
      wide
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={kind === 'bank' ? t('bankTitle') : t('brokerTitle')}
      closeLabel={t('close')}
    >
      <ImportScreen {...flow} onClose={onClose} />
      <Link
        href={`/${encodeURIComponent(flow.poolId)}/importar`}
        className="self-start text-sm text-accent-2 hover:underline"
      >
        {t('fullScreen')}
      </Link>
    </Modal>
  );
}
