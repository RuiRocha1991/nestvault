import { expect, test, type Page } from '@playwright/test';

import { STORAGE_STATE } from './support/user';

// The shell pages need a session: they run as the E2E owner created in global-setup.ts.
test.use({ storageState: STORAGE_STATE });

// The shell pages must run under the strict CSP without a single violation (security control 18).
async function collectViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  page.on('pageerror', (error) => violations.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${String(event.lineNumber)} ${event.sample}`,
      );
    });
  });
  return violations;
}

for (const path of ['/demo', '/demo/contas', '/demo/despesas']) {
  test(`no CSP violation on ${path}`, async ({ page }) => {
    const violations = await collectViolations(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    expect(violations).toEqual([]);
  });
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('no CSP violation on /login', async ({ page }) => {
    const violations = await collectViolations(page);
    const response = await page.goto('/login');
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    expect(violations).toEqual([]);
  });
});

test('the app is interactive under the CSP (theme switch works)', async ({ page }) => {
  const violations = await collectViolations(page);
  await page.goto('/demo');
  const before = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('switch').first().click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '');
  expect(violations).toEqual([]);
});

test('an injected inline event handler is blocked', async ({ page }) => {
  await page.goto('/demo');
  // A <script> added from DevTools-evaluated code is trusted by 'strict-dynamic', so the check uses
  // an inline handler, which the policy rejects whoever adds it (what an XSS payload would be).
  const outcome = await page.evaluate(
    () =>
      new Promise<'blocked' | 'ran'>((resolve) => {
        document.addEventListener(
          'securitypolicyviolation',
          () => {
            resolve('blocked');
          },
          {
            once: true,
          },
        );
        const img = document.createElement('img');
        img.setAttribute('onerror', 'window.__injected = true');
        img.src = 'data:,not-an-image';
        document.body.append(img);
        setTimeout(() => {
          resolve((window as { __injected?: boolean }).__injected ? 'ran' : 'blocked');
        }, 800);
      }),
  );
  expect(outcome).toBe('blocked');
});
