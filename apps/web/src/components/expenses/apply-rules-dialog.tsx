'use client';

import { Button, Modal, Table, Td, Th } from '@nestvault/ui';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { ApplyRulesView, CategoryView } from '@webapp/lib/expenses-types';
import { postJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { ExpenseProblem } from './expense-problem';
import { useCategoryLabel } from './use-category-label';

export interface ApplyRulesDialogProps {
  poolId: string;
  categories: readonly CategoryView[];
  onClose: () => void;
  /** Called with how many movements were recategorized. */
  onDone: (changed: number) => void;
}

type Preview =
  { state: 'loading' } | { state: 'failed' } | { state: 'ready'; result: ApplyRulesView };

/**
 * "Reaplicar a todos": the preview is asked first (`confirm: false`, nothing is written) and the
 * rules are applied only when the user confirms. Categories chosen by hand are never touched.
 */
export function ApplyRulesDialog({ poolId, categories, onClose, onDone }: ApplyRulesDialogProps) {
  const t = useTranslations('expenses.rules');
  const tc = useTranslations('expenses');
  const label = useCategoryLabel();
  const [preview, setPreview] = useState<Preview>({ state: 'loading' });
  const action = useMemberAction(() => {
    if (preview.state === 'ready') onDone(preview.result.changed);
  });
  const url = `/api/v1/pools/${encodeURIComponent(poolId)}/rules/apply`;

  useEffect(() => {
    let cancelled = false;
    void postJson(url, { confirm: false })
      .then(async (response) => {
        if (!response.ok) throw new Error('preview');
        const result = (await response.json()) as ApplyRulesView;
        if (!cancelled) setPreview({ state: 'ready', result });
      })
      .catch(() => {
        if (!cancelled) setPreview({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const byId = new Map(categories.map((category) => [category.id, category]));
  const name = (id: string | null) => {
    const category = id ? byId.get(id) : undefined;
    return category ? label(category) : t('applyNone');
  };
  const result = preview.state === 'ready' ? preview.result : null;

  return (
    <Modal
      open
      wide
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('applyTitle')}
      closeLabel={tc('close')}
      description={t('applyLead')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={action.busy || !result || result.changed === 0}
            onClick={() => {
              void action.run(() => postJson(url, { confirm: true }));
            }}
          >
            {t('applyConfirm', { count: result?.changed ?? 0 })}
          </Button>
        </>
      }
    >
      <ExpenseProblem problem={action.problem} locked={action.locked} />
      {preview.state === 'loading' && <p className="m-0 text-fg-3">{t('applyLoading')}</p>}
      {preview.state === 'failed' && (
        <ExpenseProblem
          problem={{ status: 500, code: null, issuePaths: [], retryAfterSeconds: 0 }}
          locked={0}
        />
      )}
      {!!result && (
        <>
          <p className="m-0 font-semibold">
            {result.changed === 0
              ? t('applyNothing')
              : t('applySummary', { changed: result.changed, matched: result.matched })}
          </p>
          {result.changes.length > 0 && (
            <>
              <p className="m-0 text-sm text-fg-3">
                {t('applySample', { count: result.changes.length })}
              </p>
              <div className="max-h-[320px] overflow-auto">
                <Table aria-label={t('applyTitle')}>
                  <thead>
                    <tr>
                      <Th>{tc('movements.description')}</Th>
                      <Th>{tc('movements.categoryColumn')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.changes.map((change) => (
                      <tr key={change.transactionId}>
                        <Td>{change.description}</Td>
                        <Td>
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span className="text-fg-3">{name(change.fromCategoryId)}</span>
                            <ArrowRight aria-hidden className="size-3.5 text-fg-3" />
                            <b>{name(change.toCategoryId)}</b>
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
