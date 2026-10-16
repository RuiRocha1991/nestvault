import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@nestvault/ui';
import { MembersScreen, type MembersScreenProps } from '@webapp/components/members/members-screen';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      <ToastProvider>{node}</ToastProvider>
    </NextIntlClientProvider>,
  );

const NOW = '2026-10-14T12:00:00.000Z';
const HOLDS_POOL = { owner: true, admin: false, member: false, viewer: false } as const;
const id = (n: number) => `0192f3a1-0000-7000-8000-00000000000${n}`;

const member = (
  n: number,
  name: string,
  role: 'owner' | 'admin' | 'member' | 'viewer',
  over: Partial<MembersScreenProps['members'][number]> = {},
) => ({
  id: id(n),
  name,
  email: `${name.toLowerCase()}@exemplo.pt`,
  role,
  joinedAt: '2026-10-11T09:00:00.000Z',
  lastActivityAt: '2026-10-14T10:00:00.000Z',
  isYou: false,
  owner: HOLDS_POOL[role],
  editable: false,
  ...over,
});

const CAPABILITIES = {
  owner: ['viewData', 'movements', 'imports', 'structure', 'categories', 'people'],
  admin: ['viewData', 'movements', 'imports', 'structure', 'categories', 'people'],
  member: ['viewData', 'movements', 'imports'],
  viewer: ['viewData'],
} as const;

const screen = (props: Partial<MembersScreenProps> = {}) =>
  wrap(
    <MembersScreen
      poolId="0192f3a1-aaaa-7000-8000-000000000000"
      poolName="Família Rocha"
      now={NOW}
      members={[
        member(1, 'Rui', 'owner', { isYou: true }),
        member(2, 'Ana', 'admin', { editable: true }),
        member(3, 'Liliana', 'member', { editable: true }),
      ]}
      invites={[
        {
          id: id(9),
          email: 'joao@exemplo.pt',
          role: 'viewer',
          expiresAt: '2026-10-19T12:00:00.000Z',
          createdAt: '2026-10-12T12:00:00.000Z',
        },
      ]}
      capabilities={CAPABILITIES}
      canManage
      canInvite
      canTransfer
      {...props}
    />,
  );

describe('MembersScreen as the owner', () => {
  it('lists everybody with name, email, role, joined date and last activity', () => {
    const html = screen();
    expect(html).toContain('Rui');
    expect(html).toContain('ana@exemplo.pt');
    expect(html).toContain('11/10/2026');
    expect(html).toContain('há 2 horas');
    expect(html).toContain('3 pessoas com conta');
    expect(html).toContain('Os administradores não podem remover nem alterar proprietários');
  });

  it('marks the caller with "Tu" and offers Sair on that row only, Remover on the others', () => {
    const html = screen();
    expect(html).toContain('>Tu<');
    expect(html.match(/>Sair</g)).toHaveLength(1);
    expect(html.match(/>Remover</g)).toHaveLength(2);
  });

  it('shows a role select that is disabled for rows the caller cannot edit', () => {
    const html = screen();
    expect(html.match(/<select/g)).toHaveLength(3);
    expect(html.match(/<select[^>]*disabled=""/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Função de Ana"');
  });

  it('shows the pending invites with the time left and the resend and cancel actions', () => {
    const html = screen();
    expect(html).toContain('Convites pendentes');
    expect(html).toContain('joao@exemplo.pt');
    expect(html).toContain('em 5 dias');
    expect(html).toContain('(19/10/2026)');
    expect(html).toContain('Reenviar');
    expect(html).toContain('Cancelar');
  });

  it('highlights an invite that is about to expire and one that already expired', () => {
    const soon = screen({
      invites: [
        {
          id: id(9),
          email: 'a@exemplo.pt',
          role: 'viewer',
          expiresAt: '2026-10-15T09:00:00.000Z',
          createdAt: '2026-10-08T09:00:00.000Z',
        },
        {
          id: id(8),
          email: 'b@exemplo.pt',
          role: 'viewer',
          expiresAt: '2026-10-13T09:00:00.000Z',
          createdAt: '2026-10-06T09:00:00.000Z',
        },
      ],
    });
    expect(soon).toContain('dentro de 21 horas');
    expect(soon).toContain('text-warn');
    expect(soon).toContain('expirado');
  });

  it('offers the invite button, the ownership card and a disabled leave while the only owner', () => {
    const html = screen();
    expect(html).toContain('Convidar utilizador');
    expect(html).toContain('Propriedade do agregado');
    expect(html).toContain('Transferir propriedade');
    expect(html).toContain('Não podes sair enquanto fores o único proprietário.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Sair do agregado/);
    // The own row keeps an enabled Sair: it opens the blocked dialog (modal 73) instead.
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*aria-label="Sair do agregado"/);
  });

  it('lets the leave button work when another owner exists', () => {
    const html = screen({
      members: [
        member(1, 'Rui', 'owner', { isYou: true }),
        member(2, 'Ana', 'owner', { editable: true }),
      ],
    });
    expect(html).not.toContain('Não podes sair enquanto fores o único proprietário.');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Sair do agregado/);
  });
});

describe('MembersScreen for other roles', () => {
  it('shows an admin the emails, the invites and no ownership card', () => {
    const html = screen({ canTransfer: false });
    expect(html).toContain('ana@exemplo.pt');
    expect(html).toContain('Convites pendentes');
    expect(html).not.toContain('Propriedade do agregado');
  });

  it('shows a viewer names and roles only, no controls and just their own Sair', () => {
    const html = screen({
      canManage: false,
      canInvite: false,
      canTransfer: false,
      invites: [],
      members: [
        member(1, 'Rui', 'owner', { email: null }),
        member(2, 'Ana', 'admin', { email: null }),
        member(3, 'Carla', 'viewer', { email: null, isYou: true }),
      ],
    });
    expect(html).not.toContain('<select');
    expect(html).not.toContain('exemplo.pt');
    expect(html).not.toContain('Convidar utilizador');
    expect(html).not.toContain('Convites pendentes');
    expect(html).not.toContain('Os administradores não podem');
    expect(html.match(/>Sair</g)).toHaveLength(1);
    expect(html).not.toContain('>Remover<');
    expect(html).toContain('Leitor');
  });
});

describe('MembersScreen escaping', () => {
  it('renders names and emails as text, never as markup', () => {
    const evil = '<script>window.__pwned=1</script>';
    const html = screen({
      members: [
        member(1, evil, 'owner', { isYou: true, email: '<img src=x onerror=alert(1)>' }),
        member(2, 'Ana', 'admin', { editable: true }),
      ],
      invites: [
        {
          id: id(9),
          email: '"><script>alert(2)</script>',
          role: 'viewer',
          expiresAt: '2026-10-19T12:00:00.000Z',
          createdAt: '2026-10-12T12:00:00.000Z',
        },
      ],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});
