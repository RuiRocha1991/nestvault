'use client';

import { Button, Card, EmptyState, Eyebrow, formatMoney, useToast } from '@nestvault/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { HolderDialog, type HolderView } from '@webapp/components/holders/holder-dialog';
import { HoldersCard } from '@webapp/components/holders/holders-card';
import type {
  AccountsScreenData as AccountsScreenDto,
  PortfolioOption as PortfolioDto,
  SavingsProduct as ProductDto,
} from '@webapp/lib/accounts-types';
import { TYPE_META, TYPE_ORDER } from '@webapp/lib/accounts-view';
import { sendJson } from '@webapp/lib/post-json';

import { AccountCard } from './account-card';
import { AccountDialog } from './account-dialog';
import { DeleteDialog, type DeleteTarget } from './delete-dialog';
import { InterestDialog } from './interest-dialog';
import { ProductDialog } from './product-dialog';
import { ProductsBlock } from './products-block';

type Dialog =
  | { kind: 'account'; accountId?: string; fromProductId?: string }
  | { kind: 'product'; product?: ProductDto }
  | { kind: 'interest'; accountId: string }
  | { kind: 'delete'; target: DeleteTarget };

export interface AccountsScreenProps {
  poolId: string;
  screen: AccountsScreenDto;
  products: readonly ProductDto[];
  portfolios: readonly PortfolioDto[];
  holders: readonly HolderView[];
  suggestedColor: string;
  transferDays: number;
  /** Hiding is cosmetic: every service call checks `accounts.write` again. */
  canWrite: boolean;
}

/** "Contas e poupanças" (mockup 13): products, the accounts by type and the household's people. */
export function AccountsScreen({
  poolId,
  screen,
  products,
  portfolios,
  holders,
  suggestedColor,
  transferDays,
  canWrite,
}: AccountsScreenProps) {
  const t = useTranslations('accounts');
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [person, setPerson] = useState(false);

  const accountNames = new Map(screen.accounts.map((account) => [account.id, account.name]));
  const productNames = new Map(products.map((product) => [product.id, product.name]));
  const portfolioNames = new Map(portfolios.map((portfolio) => [portfolio.id, portfolio.name]));
  const institutions = [
    ...new Set(
      [...screen.accounts.map((a) => a.institution), ...products.map((p) => p.institution)].filter(
        (name): name is string => !!name,
      ),
    ),
  ];

  const close = () => {
    setDialog(null);
  };
  function finish(message: string) {
    setDialog(null);
    toast.show(t(`toast.${message}`));
    router.refresh();
  }

  async function removeInterest(id: string) {
    const response = await sendJson(
      'DELETE',
      `/api/v1/pools/${encodeURIComponent(poolId)}/interest/${encodeURIComponent(id)}`,
    );
    if (response.ok) {
      toast.show(t('toast.interestDeleted'));
      router.refresh();
    }
  }

  const editing =
    dialog?.kind === 'account' && dialog.accountId
      ? screen.accounts.find((account) => account.id === dialog.accountId)
      : undefined;
  const interestAccount =
    dialog?.kind === 'interest'
      ? screen.accounts.find((account) => account.id === dialog.accountId)
      : undefined;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="m-0 mr-auto min-w-0 flex-1 text-sm text-fg-3">{t('lead')}</p>
        {canWrite && (
          <Button
            variant="primary"
            onClick={() => {
              setDialog({ kind: 'account' });
            }}
          >
            <Plus aria-hidden />
            {t('add')}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <ProductsBlock
          products={products}
          accountNames={accountNames}
          canWrite={canWrite}
          onAdd={() => {
            setDialog({ kind: 'product' });
          }}
          onEdit={(product) => {
            setDialog({ kind: 'product', product });
          }}
          onDelete={(product) => {
            setDialog({
              kind: 'delete',
              target: { kind: 'product', id: product.id, name: product.name },
            });
          }}
          onNewDeposit={(product) => {
            setDialog({ kind: 'account', fromProductId: product.id });
          }}
        />

        {screen.accounts.length === 0 && (
          <Card>
            <EmptyState
              title={t('empty.title')}
              description={canWrite ? t('empty.text') : t('empty.viewerText')}
            />
          </Card>
        )}

        {TYPE_ORDER.filter((type) => screen.accounts.some((a) => a.type === type)).map((type) => {
          const cards = screen.accounts.filter((account) => account.type === type);
          return (
            <section
              key={type}
              aria-label={t(`types.${TYPE_META[type].messageKey}`)}
              className="flex flex-col gap-3"
            >
              <Eyebrow>
                {t('sectionTotal', {
                  label: t(`types.${TYPE_META[type].messageKey}`),
                  total: formatMoney(screen.totalsEur[type]),
                })}
              </Eyebrow>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-4">
                {cards.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    holders={holders}
                    accountNames={accountNames}
                    products={productNames}
                    portfolioName={portfolioNames.get(account.portfolioId ?? '') ?? null}
                    canWrite={canWrite}
                    onEdit={() => {
                      setDialog({ kind: 'account', accountId: account.id });
                    }}
                    onDelete={() => {
                      setDialog({
                        kind: 'delete',
                        target: { kind: 'account', id: account.id, name: account.name },
                      });
                    }}
                    onAddInterest={() => {
                      setDialog({ kind: 'interest', accountId: account.id });
                    }}
                    onRemoveInterest={(id) => {
                      void removeInterest(id);
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}

        <HoldersCard
          poolId={poolId}
          holders={holders}
          suggestedColor={suggestedColor}
          transferDays={transferDays}
          canWrite={canWrite}
        />
      </div>

      {dialog?.kind === 'account' && (!dialog.accountId || !!editing) && (
        <AccountDialog
          poolId={poolId}
          {...(editing ? { account: editing } : {})}
          {...(dialog.fromProductId ? { fromProductId: dialog.fromProductId } : {})}
          holders={holders}
          portfolios={portfolios}
          products={products}
          accounts={screen.accounts}
          onNewPerson={() => {
            setPerson(true);
          }}
          onClose={close}
          onDone={() => {
            finish('accountSaved');
          }}
        />
      )}
      {dialog?.kind === 'product' && (
        <ProductDialog
          poolId={poolId}
          {...(dialog.product ? { product: dialog.product } : {})}
          accounts={screen.accounts}
          institutions={institutions}
          onClose={close}
          onDone={() => {
            finish('productSaved');
          }}
        />
      )}
      {dialog?.kind === 'interest' && !!interestAccount && (
        <InterestDialog
          poolId={poolId}
          accountId={interestAccount.id}
          accountName={interestAccount.name}
          today={screen.asOf}
          onClose={close}
          onDone={() => {
            finish('interestSaved');
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          poolId={poolId}
          target={dialog.target}
          onClose={close}
          onDone={() => {
            finish(dialog.target.kind === 'account' ? 'accountDeleted' : 'productDeleted');
          }}
        />
      )}
      {person && (
        <HolderDialog
          poolId={poolId}
          suggestedColor={suggestedColor}
          onClose={() => {
            setPerson(false);
          }}
          onDone={() => {
            setPerson(false);
            toast.show(t('toast.personSaved'));
            router.refresh();
          }}
        />
      )}
    </>
  );
}
