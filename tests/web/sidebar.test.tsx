import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '@webapp/components/sidebar';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

const POOL = '0192f3a1-aaaa-7000-8000-000000000000';
const XTB = '0192f3a1-bbbb-7000-8000-000000000001';
const FUND = '0192f3a1-bbbb-7000-8000-000000000002';

let pathname = `/${POOL}/portfolios`;
vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}));
vi.mock('@webapp/components/shell', () => ({
  MENU_BUTTON_ID: 'menu-button',
  SIDEBAR_ID: 'sidebar',
  useShell: () => ({ drawerOpen: false, openDrawer: vi.fn() }),
}));

const render = () =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      <Sidebar
        pool={{ id: POOL, name: 'Casa', role: 'owner' } as never}
        pools={[]}
        portfolios={[
          { id: XTB, name: 'XTB', color: '#9d6bff' },
          { id: FUND, name: 'Fundo de Emergência', color: '#f2913d' },
        ]}
        theme="dark"
        userName="Rui"
      />
    </NextIntlClientProvider>,
  );

/** The `<a>` tags of the sidebar as `[href, aria-current?]`. */
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*>/g)].map((match) => ({
    href: /href="([^"]*)"/.exec(match[0])?.[1],
    current: match[0].includes('aria-current="page"'),
  }));

describe('Sidebar portfolios', () => {
  beforeEach(() => {
    pathname = `/${POOL}/portfolios`;
  });

  it('lists every portfolio under Portfolios with its colour dot', () => {
    const html = render();
    expect(html).toContain('XTB');
    expect(html).toContain('Fundo de Emergência');
    expect(html).toContain('background:#9d6bff');
    expect(html).toContain('background:#f2913d');
    const hrefs = links(html).map((link) => link.href);
    expect(hrefs).toContain(`/${POOL}/portfolios`);
    expect(hrefs).toContain(`/${POOL}/portfolios/${XTB}`);
  });

  it('highlights Portfolios on "Todos" and the portfolio itself when it is open', () => {
    const all = links(render());
    expect(all.find((link) => link.href === `/${POOL}/portfolios`)?.current).toBe(true);
    expect(all.find((link) => link.href === `/${POOL}/portfolios/${XTB}`)?.current).toBe(false);

    pathname = `/${POOL}/portfolios/${XTB}`;
    const one = links(render());
    expect(one.find((link) => link.href === `/${POOL}/portfolios`)?.current).toBe(false);
    expect(one.find((link) => link.href === `/${POOL}/portfolios/${XTB}`)?.current).toBe(true);
    expect(one.find((link) => link.href === `/${POOL}/portfolios/${FUND}`)?.current).toBe(false);
  });

  it('shows no child items for a pool without portfolios', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
        <Sidebar
          pool={{ id: POOL, name: 'Casa', role: 'owner' } as never}
          pools={[]}
          portfolios={[]}
          theme="dark"
          userName="Rui"
        />
      </NextIntlClientProvider>,
    );
    expect(links(html).filter((link) => link.href?.includes('/portfolios/'))).toEqual([]);
  });
});
