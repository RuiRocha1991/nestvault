'use client';

import { Button, Card, Chip, useToast } from '@nestvault/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DeleteHolderDialog } from './delete-holder-dialog';
import { HolderDialog, type HolderView } from './holder-dialog';

type Dialog = { kind: 'form'; holder?: HolderView } | { kind: 'delete'; holder: HolderView };

export interface HoldersCardProps {
  poolId: string;
  holders: readonly HolderView[];
  suggestedColor: string;
  /** The transfer detection window of the pool, in days (only shown in the note). */
  transferDays: number;
  /** Hiding is cosmetic: every service call checks `accounts.write` again. */
  canWrite: boolean;
}

/** Definições → Agregado familiar (modal 26): who owns the accounts and how they appear in extracts. */
export function HoldersCard({
  poolId,
  holders,
  suggestedColor,
  transferDays,
  canWrite,
}: HoldersCardProps) {
  const t = useTranslations('holders');
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  function finish(message: 'saved' | 'deleted') {
    setDialog(null);
    toast.show(t(`toast.${message}`));
    router.refresh();
  }

  const close = () => {
    setDialog(null);
  };

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold">{t('title')}</h2>
        {canWrite && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setDialog({ kind: 'form' });
            }}
          >
            <Plus aria-hidden />
            {t('add')}
          </Button>
        )}
      </div>
      <p className="m-0 text-sm text-fg-3">{t('lead')}</p>
      <p className="m-0 text-sm text-fg-3">{t('transfersNote', { days: transferDays })}</p>
      {holders.length === 0 ? (
        <p className="m-0 text-sm text-fg-3">{t('empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {holders.map((holder) => (
            <li key={holder.id} className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-[30px] shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                style={{ background: holder.color }}
              >
                {holder.name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold">
                  <span className="break-words">{holder.name}</span>
                  {holder.member && <Chip tone="accent">{t('member')}</Chip>}
                </div>
                {holder.aliases.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {holder.aliases.map((alias) => (
                      <Chip key={alias}>{alias}</Chip>
                    ))}
                  </div>
                )}
              </div>
              {canWrite && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={t('edit', { name: holder.name })}
                    onClick={() => {
                      setDialog({ kind: 'form', holder });
                    }}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  {!holder.member && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={t('remove', { name: holder.name })}
                      onClick={() => {
                        setDialog({ kind: 'delete', holder });
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'form' && (
        <HolderDialog
          poolId={poolId}
          {...(dialog.holder ? { holder: dialog.holder } : {})}
          suggestedColor={suggestedColor}
          onClose={close}
          onDone={() => {
            finish('saved');
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteHolderDialog
          poolId={poolId}
          holder={dialog.holder}
          onClose={close}
          onDone={() => {
            finish('deleted');
          }}
        />
      )}
    </Card>
  );
}
