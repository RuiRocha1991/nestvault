import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AuditScreen, type AuditScreenProps } from '@webapp/components/audit/audit-screen';
import { SettingsTabs } from '@webapp/components/settings/settings-tabs';
import { parseAuditFilters } from '@webapp/lib/audit-filters';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/pool/definicoes/auditoria',
}));

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      {node}
    </NextIntlClientProvider>,
  );

const ACTOR = '0192f3a1-0000-7000-8000-00000000c41e';
const OTHER = '0192f3a1-0000-7000-8000-00000000d52f';
const TODAY = '2026-10-14';
const filters = parseAuditFilters({}, { actions: [], categories: [] }, TODAY);

const entry = (over: Partial<AuditScreenProps['entries'][number]> = {}) => ({
  id: '0192f3a1-1111-7000-8000-000000000001',
  userId: ACTOR,
  action: 'member.role_changed',
  target: OTHER,
  ipMasked: '85.240.x.x',
  at: '2026-10-14T08:41:07.000Z',
  meta: { previousRole: 'admin', role: 'member' },
  ...over,
});

const screen = (props: Partial<AuditScreenProps> = {}) =>
  wrap(
    <AuditScreen
      filters={filters}
      today={TODAY}
      entries={[entry()]}
      total={1}
      pageSize={25}
      people={{ [ACTOR]: 'Rui', [OTHER]: 'Ana' }}
      members={[
        { id: ACTOR, name: 'Rui' },
        { id: OTHER, name: 'Ana' },
      ]}
      groups={[{ category: 'member', actions: ['member.role_changed'] }]}
      {...props}
    />,
  );

describe('AuditScreen', () => {
  it('shows an entry with the Lisbon time, who, what and the masked address', () => {
    const html = screen();
    expect(html).toContain('14/10/2026');
    expect(html).toContain('09:41:07');
    expect(html).toContain('Rui');
    expect(html).toContain('member.role_changed');
    expect(html).toContain('Ana · Administrador → Membro');
    expect(html).toContain('85.240.x.x');
    expect(html).toContain('1-1 de 1');
  });

  it('shows the filters with the 30 day preset pressed and the dates as dd/mm/aaaa', () => {
    const html = screen();
    expect(html).toContain('Todas as ações');
    expect(html).toContain('Todas as pessoas');
    expect(html).toMatch(/aria-pressed="true"[^>]*>30 dias</);
    expect(html).toContain('value="14/09/2026"');
    expect(html).toContain('value="14/10/2026"');
  });

  it('renders names as text, never as markup', () => {
    const evil = '<script>window.__pwned=1</script>';
    const html = screen({ people: { [ACTOR]: evil, [OTHER]: '<img src=x onerror=alert(1)>' } });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x');
  });

  it('shows a failed sign-in in the warning colour, with nobody named', () => {
    const html = screen({
      entries: [entry({ userId: null, action: 'auth.signin_failed', target: null, meta: {} })],
    });
    expect(html).toContain('Credenciais inválidas');
    expect(html).toContain('text-warn');
    expect(html).toContain('Desconhecido');
  });

  it('falls back to the raw code for an action it has no words for', () => {
    const html = screen({ entries: [entry({ action: 'future.thing', target: null, meta: {} })] });
    expect(html).toContain('future.thing');
  });

  it('shows the empty state with a way to clear the filters when a filter is on', () => {
    const filtered = parseAuditFilters({ range: '7' }, { actions: [], categories: [] }, TODAY);
    const html = screen({ entries: [], total: 0, filters: filtered });
    expect(html).toContain('Nenhuma entrada com estes filtros');
    expect(html).toContain('Limpar filtros');
    expect(html).not.toContain('<table');
  });

  it('has no export button and no edit or delete control (the log is read only)', () => {
    const html = screen();
    expect(html).not.toContain('Exportar');
    expect(html).not.toMatch(/Apagar|Eliminar|Editar/);
    expect(html).toContain('só de leitura');
  });

  it('pages: the first page has no previous, a full last page no next', () => {
    const first = screen({ total: 60 });
    expect(first).toMatch(/aria-disabled="true"[^>]*>Anterior</);
    expect(first).toMatch(/<a [^>]*href="\/pool\/definicoes\/auditoria\?page=2"[^>]*>Seguinte</);
    const last = screen({ total: 1 });
    expect(last).toMatch(/aria-disabled="true"[^>]*>Seguinte</);
  });

  it('labels the row button for assistive technology', () => {
    expect(screen()).toContain('aria-label="Ver detalhe da entrada de 14/10/2026 09:41:07"');
  });
});

describe('SettingsTabs', () => {
  const tabs = (permissions: string[]) =>
    wrap(<SettingsTabs poolId="pool-1" active="audit" permissions={permissions} />);

  it('shows four tabs to an owner, the active one as the current page', () => {
    const html = tabs(['audit.read']);
    for (const label of Object.values(messages.settings.tabs)) expect(html).toContain(label);
    expect(html).toMatch(/aria-current="page"[^>]*>Auditoria</);
    expect(html).toContain('href="/pool-1/definicoes/auditoria"');
  });

  it('leaves the audit tab out for everyone else', () => {
    const html = tabs(['pool.read']);
    expect(html).not.toContain('Auditoria');
    expect(html).toContain('Agregado e parâmetros');
  });

  it('shows a tab whose screen does not exist yet, disabled and without a link', () => {
    const html = tabs(['audit.read']);
    expect(html).toMatch(/aria-disabled="true"[^>]*>Plano e subscrição</);
    expect(html).not.toContain('definicoes/plano');
  });
});
