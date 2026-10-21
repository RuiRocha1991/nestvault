'use client';

import { Button, Card, Table, Td, Th, formatMoney, formatPct } from '@nestvault/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { SavingsProduct as ProductDto } from '@webapp/lib/accounts-types';

export interface ProductsBlockProps {
  products: readonly ProductDto[];
  accountNames: ReadonlyMap<string, string>;
  canWrite: boolean;
  onAdd: () => void;
  onEdit: (product: ProductDto) => void;
  onDelete: (product: ProductDto) => void;
  onNewDeposit: (product: ProductDto) => void;
}

/** "Produtos de poupança": the terms each bank offers, with their deposits count and capital. */
export function ProductsBlock({
  products,
  accountNames,
  canWrite,
  onAdd,
  onEdit,
  onDelete,
  onNewDeposit,
}: ProductsBlockProps) {
  const t = useTranslations('accounts');
  const period = (n: number | null, unit: 'm' | 'd' | null, none: string) =>
    n === null || unit === null ? none : t(unit === 'm' ? 'period.months' : 'period.days', { n });

  return (
    <Card data-testid="products-block">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="m-0 text-lg font-semibold">{t('products.title')}</h2>
          <p className="m-0 text-sm text-fg-3">{t('products.lead')}</p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={onAdd}>
            <Plus aria-hidden />
            {t('products.add')}
          </Button>
        )}
      </div>
      {products.length === 0 ? (
        <p className="m-0 text-sm text-fg-3">{t('products.empty')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('products.columns.product')}</Th>
              <Th numeric>{t('products.columns.tanb')}</Th>
              <Th>{t('products.columns.pays')}</Th>
              <Th>{t('products.columns.term')}</Th>
              <Th>{t('products.columns.goesTo')}</Th>
              <Th numeric>{t('products.columns.deposits')}</Th>
              <Th numeric>{t('products.columns.capital')}</Th>
              {canWrite && (
                <Th>
                  <span className="sr-only">{t('products.columns.actions')}</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <Td>
                  <b className="font-semibold">{product.name}</b>
                  {!!product.institution && (
                    <span className="block text-sm text-fg-3">{product.institution}</span>
                  )}
                </Td>
                <Td numeric>
                  {formatPct(product.rate, { digits: 2 })}
                  {product.tax !== null && (
                    <span className="block text-xs text-fg-3">
                      {t('products.tax', { tax: formatPct(product.tax, { digits: 1 }) })}
                    </span>
                  )}
                </Td>
                <Td>
                  {product.payN === null
                    ? t('period.atEnd')
                    : t('period.every', {
                        period: period(product.payN, product.payU, t('period.atEnd')),
                      })}
                </Td>
                <Td>{period(product.termN, product.termU, t('period.none'))}</Td>
                <Td>
                  {(product.payToAccountId && accountNames.get(product.payToAccountId)) ||
                    t('products.toDeposit')}
                </Td>
                <Td numeric>{product.depositsCount}</Td>
                <Td numeric>{formatMoney(product.capital)}</Td>
                {canWrite && (
                  <Td className="whitespace-nowrap text-right">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        onNewDeposit(product);
                      }}
                    >
                      <Plus aria-hidden />
                      {t('products.newDeposit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={t('products.edit', { name: product.name })}
                      onClick={() => {
                        onEdit(product);
                      }}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon
                      aria-label={t('products.remove', { name: product.name })}
                      onClick={() => {
                        onDelete(product);
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
