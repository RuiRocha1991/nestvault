'use client';

import { Button, useToast } from '@nestvault/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { AccountView, CategoryView } from '@webapp/lib/expenses-types';

import { MovementDialog } from './movement-dialog';

export interface NewMovementButtonProps {
  poolId: string;
  accounts: readonly Pick<AccountView, 'id' | 'name' | 'currency'>[];
  categories: readonly CategoryView[];
  today: string;
}

/** "+ Movimento" of the Despesas header: opens the manual movement dialog, then refreshes the screen. */
export function NewMovementButton({ poolId, accounts, categories, today }: NewMovementButtonProps) {
  const t = useTranslations('expenses');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus aria-hidden />
        {t('newMovement')}
      </Button>
      {open && (
        <MovementDialog
          poolId={poolId}
          accounts={accounts}
          categories={categories}
          today={today}
          onClose={() => {
            setOpen(false);
          }}
          onDone={() => {
            setOpen(false);
            toast.show(t('toasts.movementCreated'));
            router.refresh();
          }}
        />
      )}
    </>
  );
}
