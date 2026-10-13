import type { Page } from '@playwright/test';

import messages from '../../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { E2E_USER } from './user';

const login = messages.auth.login;

/** Next.js adds its own `role=alert` route announcer, so the page's alert is picked by its text. */
export const alertWith = (page: Page, text: string) =>
  page.getByRole('alert').filter({ hasText: text });

export async function fillAndSubmit(page: Page, email: string, password: string) {
  await page.getByLabel(login.email).fill(email);
  await page.getByLabel(login.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: login.submit, exact: true }).click();
}

/** Opens the sign-in screen (or `url`) and signs in as the E2E owner. */
export async function signInAsOwner(page: Page, url = '/login') {
  await page.goto(url);
  await fillAndSubmit(page, E2E_USER.email, E2E_USER.password);
}
