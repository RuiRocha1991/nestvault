import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import {
  MEMBERS_PASSWORD,
  seedMembersWorld,
  type MembersPerson,
  type MembersWorld,
} from './support/members';
import { fillAndSubmit } from './support/sign-in';

const m = messages.months;
const MONTH = '2026-03';

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

/** Waits until clicks work: React hydrated a button and the Next router is published. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('main button, button');
    const router = (window as unknown as { next?: { router?: unknown } }).next?.router;
    return (
      !!button && !!router && Object.keys(button).some((key) => key.startsWith('__reactProps$'))
    );
  });
}

async function openReview(page: Page, person: MembersPerson, path = `mes/${MONTH}`) {
  const url = `/${world.poolId}/${path}`;
  await page.goto(`/login?next=${encodeURIComponent(url)}`);
  await fillAndSubmit(page, person.email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${world.poolId}/mes/`));
  await hydrated(page);
}

test('a member writes the month note and it survives a reload (the timeline marks the month)', async ({
  page,
}) => {
  await openReview(page, world.member);
  await expect(page.getByRole('heading', { name: 'Março de 2026' })).toBeVisible();
  await expect(page.getByTestId('kpi-income')).toBeVisible();

  const note = page.getByLabel(m.note.label);
  await note.fill('Mês de obras em casa');
  await page.getByRole('button', { name: m.note.save }).click();
  await expect(page.getByText(/Editado por/)).toBeVisible();
  await expect(page.getByRole('link', { name: /março de 2026/ })).toContainText(m.timeline.hasNote);

  await page.reload();
  await expect(page.getByLabel(m.note.label)).toHaveValue('Mês de obras em casa');
});

test('the month navigation moves between months through the URL', async ({ page }) => {
  await openReview(page, world.admin);
  await page.getByRole('link', { name: m.previous }).click();
  await expect(page).toHaveURL(new RegExp(`/mes/2026-02$`));
  await expect(page.getByRole('heading', { name: 'Fevereiro de 2026' })).toBeVisible();
  await page.getByRole('link', { name: m.next }).click();
  await expect(page).toHaveURL(new RegExp(`/mes/${MONTH}$`));
});

test('a viewer reads the review but cannot edit the note', async ({ page }) => {
  await openReview(page, world.viewer);
  await expect(page.getByRole('heading', { name: 'Março de 2026' })).toBeVisible();
  await expect(page.getByLabel(m.note.label)).toHaveCount(0);
  await expect(page.getByRole('button', { name: m.note.save })).toHaveCount(0);
  await expect(page.getByText(m.note.readOnlyEmpty)).toBeVisible();
});

test('a bad month is a 404 and "Meses" opens the current month', async ({ page }) => {
  await openReview(page, world.owner);
  const response = await page.goto(`/${world.poolId}/mes/2026-13`);
  expect(response?.status()).toBe(404);
  await page.goto(`/${world.poolId}/meses`);
  await expect(page).toHaveURL(new RegExp(`/${world.poolId}/mes/\\d{4}-\\d{2}$`));
});
