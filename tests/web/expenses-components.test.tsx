import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@nestvault/ui';
import { CategoriesTab } from '@webapp/components/expenses/categories-tab';
import { MovementFiltersBar } from '@webapp/components/expenses/movement-filters';
import { MovementRow } from '@webapp/components/expenses/movement-row';
import { MovementsTab } from '@webapp/components/expenses/movements-tab';
import type { CategoryView, TransactionView, TotalsView } from '@webapp/lib/expenses-types';
import { NO_FILTERS } from '@webapp/lib/expenses-view';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      <ToastProvider>{node}</ToastProvider>
    </NextIntlClientProvider>,
  );

const id = (n: number) => `0192f3a1-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;

const category = (n: number, over: Partial<CategoryView> = {}): CategoryView => ({
  id: id(n),
  systemKey: null,
  name: `Categoria ${String(n)}`,
  kind: 'expense',
  color: '#3BA7F2',
  colorOverride: null,
  global: false,
  monthlyBudget: null,
  hidden: false,
  ...over,
});

const row = (over: Partial<TransactionView> = {}): TransactionView => ({
  id: id(50),
  accountId: id(60),
  date: '2026-03-06',
  description: 'COMPRA CONTINENTE',
  amount: '-12.5',
  categoryId: id(1),
  kind: 'expense',
  transfer: false,
  pairId: null,
  transferLocked: false,
  manualCategory: false,
  depositInterest: false,
  note: null,
  noteUpdatedBy: null,
  noteUpdatedAt: null,
  suggestedKeyword: 'CONTINENTE',
  ...over,
});

const noop = () => undefined;
const rowProps = {
  accountLabel: 'Conta à ordem · Ana',
  currency: 'EUR',
  categories: [category(1), category(2, { kind: 'income' }), category(3, { hidden: true })],
  canWrite: true,
  canRules: true,
  onCategory: noop,
  onToggleTransfer: noop,
  onNote: noop,
  onRule: noop,
  onDelete: noop,
};
const inTable = (node: React.ReactNode) =>
  wrap(
    <table>
      <tbody>{node}</tbody>
    </table>,
  );

describe('MovementRow', () => {
  it('shows the date, the money and the category choice, hidden categories left out', () => {
    const html = inTable(<MovementRow row={row()} {...rowProps} />);
    expect(html).toContain('06/03/2026');
    expect(html).toContain('COMPRA CONTINENTE');
    expect(html).toContain('-12,50');
    expect(html).toContain('Categoria 1');
    expect(html).toContain('Categoria 2');
    expect(html).not.toContain('Categoria 3');
    expect(html).toContain('Conta à ordem · Ana');
  });

  it('shows the note indicator only when there is a note, and offers to add one otherwise', () => {
    const without = inTable(<MovementRow row={row()} {...rowProps} />);
    expect(without).toContain(messages.expenses.movements.addNote);
    const withNote = inTable(<MovementRow row={row({ note: 'Renda de março' })} {...rowProps} />);
    expect(withNote).toContain('title="Renda de março"');
    expect(withNote).not.toContain(`aria-label="${messages.expenses.movements.addNote}"`);
  });

  it('strikes through a transfer and tags it as internal', () => {
    const html = inTable(
      <MovementRow row={row({ transfer: true, kind: 'transfer' })} {...rowProps} />,
    );
    expect(html).toContain('line-through');
    expect(html).toContain(messages.expenses.movements.internal);
    expect(html).toContain('aria-pressed="true"');
  });

  it('gives a viewer a disabled select and no write buttons', () => {
    const html = inTable(
      <MovementRow row={row()} {...rowProps} canWrite={false} canRules={false} />,
    );
    expect(html).toContain('disabled');
    expect(html).not.toContain(messages.expenses.movements.deleteMovement);
    expect(html).not.toContain(messages.expenses.movements.markTransfer);
    expect(html).not.toContain(messages.expenses.movements.createRule);
  });

  it('renders a hostile description as text', () => {
    const html = inTable(
      <MovementRow row={row({ description: '<img src=x onerror=alert(1)>' })} {...rowProps} />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('offers no rule without a keyword suggestion', () => {
    const html = inTable(<MovementRow row={row({ suggestedKeyword: '' })} {...rowProps} />);
    expect(html).not.toContain(messages.expenses.movements.createRule);
  });
});

const totals: TotalsView = {
  income: '100.00',
  expenses: '50.00',
  invested: '0.00',
  transfers: '10.00',
  uncategorized: 3,
  count: 4,
  rates: {},
};

describe('MovementsTab', () => {
  const props = {
    poolId: id(99),
    filters: NO_FILTERS,
    months: ['2026-02', '2026-03'],
    initial: { transactions: [row()], nextCursor: null },
    initialTotals: totals,
    accounts: [{ id: id(60), name: 'Conta à ordem', currency: 'EUR', holderIds: [id(70)] }],
    categories: [category(1)],
    holders: [{ id: id(70), name: 'Ana', userId: null }],
    canWrite: true,
    canNotes: true,
    canRules: true,
  };

  it('shows the totals of the filter and the table', () => {
    const html = wrap(<MovementsTab {...props} />);
    expect(html).toContain('100,00');
    expect(html).toContain('50,00');
    expect(html).toContain(messages.expenses.movements.uncategorized);
    expect(html).toContain('data-testid="movement-row"');
    expect(html).toContain('Conta à ordem · Ana');
    expect(html).toContain(messages.expenses.movements.shown.replace('{count}', '1'));
  });

  it('says so when nothing matches, and offers the next page while there is one', () => {
    const empty = wrap(
      <MovementsTab {...props} initial={{ transactions: [], nextCursor: null }} />,
    );
    expect(empty).toContain(messages.expenses.movements.empty);
    const more = wrap(
      <MovementsTab {...props} initial={{ transactions: [row()], nextCursor: 'c' }} />,
    );
    expect(more).toContain(messages.expenses.movements.loadMore);
  });

  it('hides internal transfers when the checkbox is off', () => {
    const transfer = row({
      id: id(51),
      transfer: true,
      kind: 'transfer',
      description: 'TRF INTERNA',
    });
    const shown = wrap(
      <MovementsTab {...props} initial={{ transactions: [row(), transfer], nextCursor: null }} />,
    );
    expect(shown).toContain('TRF INTERNA');
    const hidden = wrap(
      <MovementsTab
        {...props}
        filters={{ ...NO_FILTERS, showTransfers: false }}
        initial={{ transactions: [row(), transfer], nextCursor: null }}
      />,
    );
    expect(hidden).not.toContain('TRF INTERNA');
  });
});

describe('MovementFiltersBar', () => {
  it('reflects the filters of the URL', () => {
    const html = wrap(
      <MovementFiltersBar
        poolId={id(99)}
        filters={{ ...NO_FILTERS, month: '2026-03', q: 'LIDL', withNotes: true }}
        months={['2026-02', '2026-03']}
        accounts={[{ id: id(60), name: 'Conta à ordem' }]}
        categories={[category(1)]}
      />,
    );
    expect(html).toContain('value="LIDL"');
    expect(html).toContain('Março 2026');
    expect(html).toContain(messages.expenses.movements.clear);
    expect(html).toContain('checked=""');
  });
});

describe('CategoriesTab', () => {
  const props = {
    poolId: id(99),
    categories: [
      category(1, { monthlyBudget: '120.0000' }),
      category(2, { kind: 'income', global: true, systemKey: 'salary', name: null }),
      category(3, { hidden: true }),
    ],
    rules: [
      { id: id(10), keyword: 'LIDL', categoryId: id(1), accountId: null, position: 0 },
      { id: id(11), keyword: 'EDP', categoryId: id(1), accountId: id(60), position: 1 },
    ],
    accounts: [{ id: id(60), name: 'Conta à ordem' }],
    usage: { categories: { [id(1)]: 23 }, rules: { [id(10)]: 11 } },
    canWrite: true,
  };

  it('lists categories by kind with budget and usage, global names from the messages', () => {
    const html = wrap(<CategoriesTab {...props} />);
    expect(html).toContain('Categoria 1');
    expect(html).toContain('120,00');
    expect(html).toContain('23');
    expect(html).toContain(messages.categories.salary);
    expect(html).toContain(messages.expenses.categories.groupIncome);
    expect(html).toContain(messages.expenses.categories.hidden);
  });

  it('lists the rules in order with their account and matches', () => {
    const html = wrap(<CategoriesTab {...props} />);
    expect(html.indexOf('LIDL')).toBeLessThan(html.indexOf('EDP'));
    expect(html).toContain(messages.expenses.rules.allAccounts);
    expect(html).toContain('Conta à ordem');
    expect(html).toContain(messages.expenses.rules.reapply);
  });

  it('has no write controls for a member without categories.write', () => {
    const html = wrap(<CategoriesTab {...props} canWrite={false} />);
    expect(html).not.toContain(messages.expenses.rules.reapply);
    expect(html).not.toContain('draggable="true"');
    expect(html).toContain('LIDL');
  });

  it('shows the empty state without rules', () => {
    expect(wrap(<CategoriesTab {...props} rules={[]} />)).toContain(messages.expenses.rules.empty);
  });
});
