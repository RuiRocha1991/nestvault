'use client';

import {
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  formatMoney,
  Table,
  Td,
  Th,
  useToast,
} from '@nestvault/ui';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import type { AccountView, CategoryView, RuleView, UsageView } from '@webapp/lib/expenses-types';
import { moveId } from '@webapp/lib/expenses-view';
import { sendJson } from '@webapp/lib/post-json';

import { ApplyRulesDialog } from './apply-rules-dialog';
import { CategoryDialog } from './category-dialog';
import { ConfirmDeleteDialog } from './confirm-delete-dialog';
import { DeleteCategoryDialog } from './delete-category-dialog';
import { RuleDialog } from './rule-dialog';
import { useCategoryLabel } from './use-category-label';

export interface CategoriesTabProps {
  poolId: string;
  categories: readonly CategoryView[];
  rules: readonly RuleView[];
  accounts: readonly Pick<AccountView, 'id' | 'name'>[];
  usage: UsageView;
  /** `categories.write`; the buttons are cosmetic, the service decides. */
  canWrite: boolean;
}

type Dialog =
  | { kind: 'category'; category?: CategoryView }
  | { kind: 'deleteCategory'; category: CategoryView }
  | { kind: 'rule'; rule?: RuleView }
  | { kind: 'deleteRule'; rule: RuleView }
  | { kind: 'apply' };

const GROUPS = [
  ['expense', 'groupExpense'],
  ['income', 'groupIncome'],
  ['refund', 'groupRefund'],
  ['transfer', 'groupTransfer'],
  ['invest', 'groupInvest'],
] as const;

const apiBase = (poolId: string) => `/api/v1/pools/${encodeURIComponent(poolId)}`;

/** The Categorias e regras tab (mockup 12): the categories with their budgets and the ordered rules. */
export function CategoriesTab({
  poolId,
  categories,
  rules: initialRules,
  accounts,
  usage,
  canWrite,
}: CategoriesTabProps) {
  const t = useTranslations('expenses.categories');
  const tr = useTranslations('expenses.rules');
  const tt = useTranslations('expenses');
  const router = useRouter();
  const toast = useToast();
  const label = useCategoryLabel();
  const [rules, setRules] = useState(initialRules);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    setRules(initialRules);
  }, [initialRules]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const close = () => {
    setDialog(null);
  };
  const done = (message: string) => {
    setDialog(null);
    toast.show(message);
    router.refresh();
  };

  async function reorder(next: string[]) {
    const previous = rules;
    const byId = new Map(rules.map((rule) => [rule.id, rule]));
    setRules(
      next.flatMap((id, position) => {
        const rule = byId.get(id);
        return rule ? [{ ...rule, position }] : [];
      }),
    );
    try {
      const response = await sendJson('PUT', `${apiBase(poolId)}/rules/order`, { ids: next });
      if (!response.ok) throw new Error('order');
      toast.show(tr('reordered'));
    } catch {
      setRules(previous);
      toast.show(tr('reorderError'));
    }
  }

  const move = (from: number, to: number) => {
    if (!canWrite) return;
    const next = moveId(
      rules.map((rule) => rule.id),
      from,
      to,
    );
    if (next.join() !== rules.map((rule) => rule.id).join()) void reorder(next);
  };

  const dialogCategory = dialog?.kind === 'deleteCategory' ? dialog.category : undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start gap-4 drawer:grid-cols-[minmax(0,1fr)]">
      <Card className="gap-3">
        <CardHeader
          title={t('title')}
          actions={
            canWrite && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setDialog({ kind: 'category' });
                }}
              >
                <Plus aria-hidden />
                {t('add')}
              </Button>
            )
          }
        />
        <p className="m-0 text-sm text-fg-3">{t('lead')}</p>
        {GROUPS.map(([kind, groupKey]) => {
          const group = categories.filter((category) => category.kind === kind);
          return (
            group.length > 0 && (
              <section key={kind} aria-label={t(groupKey)} className="flex flex-col">
                <h3 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-fg-3">
                  {t(groupKey)}
                </h3>
                <ul className="m-0 flex list-none flex-col p-0">
                  {group.map((category) => {
                    const uses = usage.categories[category.id] ?? 0;
                    return (
                      <li
                        key={category.id}
                        className={`flex items-center gap-2.5 py-2 ${category.hidden ? 'opacity-60' : ''}`}
                      >
                        <i
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-[3px]"
                          style={{ background: category.color }}
                        />
                        <span className="mr-auto min-w-0 truncate">{label(category)}</span>
                        {category.hidden && <Chip>{t('hidden')}</Chip>}
                        {category.monthlyBudget !== null && (
                          <Chip className="tabular-nums">
                            {t('perMonth', { amount: formatMoney(category.monthlyBudget) })}
                          </Chip>
                        )}
                        <span
                          className="w-8 text-right text-sm tabular-nums text-fg-3"
                          title={t('uses', { count: uses })}
                        >
                          {uses}
                        </span>
                        {canWrite && (
                          <>
                            <IconButton
                              label={`${tt('edit')} ${label(category)}`}
                              onClick={() => {
                                setDialog({ kind: 'category', category });
                              }}
                            >
                              <Pencil aria-hidden />
                            </IconButton>
                            {category.global ? (
                              <IconButton
                                label={`${category.hidden ? t('show') : t('hide')} ${label(category)}`}
                                onClick={() => {
                                  void sendJson(
                                    'PATCH',
                                    `${apiBase(poolId)}/categories/${encodeURIComponent(category.id)}/settings`,
                                    { hidden: !category.hidden },
                                  ).then((response) => {
                                    if (response.ok) router.refresh();
                                    else toast.show(tt('problemText'));
                                  });
                                }}
                              >
                                {category.hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                              </IconButton>
                            ) : (
                              <IconButton
                                label={`${tt('delete')} ${label(category)}`}
                                danger
                                onClick={() => {
                                  setDialog({ kind: 'deleteCategory', category });
                                }}
                              >
                                <Trash2 aria-hidden />
                              </IconButton>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )
          );
        })}
      </Card>

      <Card className="gap-3">
        <CardHeader
          title={tr('title')}
          actions={
            canWrite && (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    setDialog({ kind: 'apply' });
                  }}
                >
                  <RefreshCw aria-hidden />
                  {tr('reapply')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setDialog({ kind: 'rule' });
                  }}
                >
                  <Plus aria-hidden />
                  {tr('add')}
                </Button>
              </>
            )
          }
        />
        <p className="m-0 text-sm text-fg-3">{tr('lead')}</p>
        {rules.length === 0 ? (
          <EmptyState title={tr('empty')} description={tr('emptyHint')} />
        ) : (
          <Table aria-label={tr('tableLabel')}>
            <thead>
              <tr>
                <Th className="w-8">
                  <span className="sr-only">{tr('contains')}</span>
                </Th>
                <Th>{tr('contains')}</Th>
                <Th>{tr('category')}</Th>
                <Th className="one:hidden">{tr('account')}</Th>
                <Th numeric>{tr('matches')}</Th>
                <Th>
                  <span className="sr-only">{tt('movements.actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => {
                const category = categoryById.get(rule.categoryId);
                const account = rule.accountId ? accountById.get(rule.accountId) : undefined;
                return (
                  <tr
                    key={rule.id}
                    data-testid="rule-row"
                    draggable={canWrite}
                    onDragStart={() => {
                      setDragging(index);
                    }}
                    onDragOver={(event) => {
                      if (dragging !== null) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragging !== null) move(dragging, index);
                      setDragging(null);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                    }}
                    className={dragging === index ? 'opacity-50' : undefined}
                  >
                    <Td className="w-8 px-1">
                      {canWrite && (
                        <span className="flex flex-col items-center">
                          <GripVertical aria-hidden className="size-4 cursor-grab text-fg-3" />
                          <span className="sr-only">
                            {tr('dragHandle', { keyword: rule.keyword })}
                          </span>
                        </span>
                      )}
                    </Td>
                    <Td>
                      <code className="rounded-sm bg-inset px-2 py-1 font-mono text-sm">
                        {rule.keyword}
                      </code>
                    </Td>
                    <Td>
                      {category && (
                        <Chip dotColor={category.color} className="max-w-full">
                          {label(category)}
                        </Chip>
                      )}
                    </Td>
                    <Td className="text-fg-3 one:hidden">{account?.name ?? tr('allAccounts')}</Td>
                    <Td numeric className="text-fg-3">
                      {usage.rules[rule.id] ?? 0}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {canWrite && (
                        <span className="inline-flex items-center gap-0.5">
                          <IconButton
                            label={tr('moveUp', { keyword: rule.keyword })}
                            disabled={index === 0}
                            onClick={() => {
                              move(index, index - 1);
                            }}
                          >
                            <ArrowUp aria-hidden />
                          </IconButton>
                          <IconButton
                            label={tr('moveDown', { keyword: rule.keyword })}
                            disabled={index === rules.length - 1}
                            onClick={() => {
                              move(index, index + 1);
                            }}
                          >
                            <ArrowDown aria-hidden />
                          </IconButton>
                          <IconButton
                            label={tr('edit', { keyword: rule.keyword })}
                            onClick={() => {
                              setDialog({ kind: 'rule', rule });
                            }}
                          >
                            <Pencil aria-hidden />
                          </IconButton>
                          <IconButton
                            label={tr('delete', { keyword: rule.keyword })}
                            danger
                            onClick={() => {
                              setDialog({ kind: 'deleteRule', rule });
                            }}
                          >
                            <Trash2 aria-hidden />
                          </IconButton>
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {dialog?.kind === 'category' && (
        <CategoryDialog
          poolId={poolId}
          {...(dialog.category ? { category: dialog.category } : {})}
          onClose={close}
          onDone={() => {
            done(tt('toasts.categorySaved'));
          }}
        />
      )}
      {dialog?.kind === 'deleteCategory' && dialogCategory && (
        <DeleteCategoryDialog
          poolId={poolId}
          category={dialogCategory}
          uses={usage.categories[dialogCategory.id] ?? 0}
          others={categories.filter(
            (category) => category.id !== dialogCategory.id && !category.hidden,
          )}
          onClose={close}
          onDone={() => {
            done(tt('toasts.categoryDeleted'));
          }}
        />
      )}
      {dialog?.kind === 'rule' && (
        <RuleDialog
          poolId={poolId}
          {...(dialog.rule ? { rule: dialog.rule } : {})}
          categories={categories}
          accounts={accounts}
          onClose={close}
          onDone={() => {
            done(tr('savedToast'));
          }}
        />
      )}
      {dialog?.kind === 'deleteRule' && (
        <ConfirmDeleteDialog
          title={tr('deleteTitle')}
          text={tr('deleteText', { keyword: dialog.rule.keyword })}
          confirmLabel={tt('delete')}
          path={`${apiBase(poolId)}/rules/${encodeURIComponent(dialog.rule.id)}`}
          onClose={close}
          onDone={() => {
            done(tr('deletedToast'));
          }}
        />
      )}
      {dialog?.kind === 'apply' && (
        <ApplyRulesDialog
          poolId={poolId}
          categories={categories}
          onClose={close}
          onDone={(changed) => {
            done(tr('applied', { count: changed }));
          }}
        />
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-7 items-center justify-center rounded-sm hover:bg-inset disabled:opacity-30 [&_svg]:size-4 ${danger ? 'text-neg' : 'text-fg-2 hover:text-fg'}`}
    >
      {children}
    </button>
  );
}
