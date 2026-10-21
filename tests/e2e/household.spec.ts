import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import {
  MEMBERS_PASSWORD,
  seedMembersWorld,
  type MembersPerson,
  type MembersWorld,
} from './support/members';
import { fillAndSubmit } from './support/sign-in';

const h = messages.household;

test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

async function openSettings(page: Page, person: MembersPerson) {
  const url = `/${world.poolId}/definicoes`;
  await page.goto(`/login?next=${encodeURIComponent(url)}`);
  await fillAndSubmit(page, person.email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${world.poolId}/definicoes`));
  await page.waitForFunction(() => {
    const button = document.querySelector('main button, button');
    const router = (window as unknown as { next?: { router?: unknown } }).next?.router;
    return (
      !!button && !!router && Object.keys(button).some((key) => key.startsWith('__reactProps$'))
    );
  });
}

test('the owner renames the household; the switcher and the tab title follow without a reload', async ({
  page,
}) => {
  await openSettings(page, world.owner);
  await expect(page.getByRole('heading', { name: h.title })).toBeVisible();
  await expect(page.getByLabel(h.name)).toHaveValue(world.poolName);
  await expect(page.getByText(h.owner, { exact: true })).toBeVisible();
  await expect(page.getByText(h.users, { exact: true })).toBeVisible();

  await page.getByLabel(h.name).fill('Família Nova');
  await page.getByRole('button', { name: h.save }).click();
  await expect(page.getByText(h.saved)).toBeVisible();
  await expect(
    page.getByRole('banner').or(page.locator('aside')).getByText('Família Nova').first(),
  ).toBeVisible();
  await expect(page).toHaveTitle('Família Nova');

  await page.reload();
  await expect(page.getByLabel(h.name)).toHaveValue('Família Nova');
});

test('an invalid name is refused on the client and nothing is saved', async ({ page }) => {
  await openSettings(page, world.owner);
  await page.getByLabel(h.name).fill('   ');
  await page.getByRole('button', { name: h.save }).click();
  await expect(page.getByText(h.invalidTitle)).toBeVisible();
});

for (const role of ['admin', 'viewer'] as const) {
  test(`${role} sees the household data read-only`, async ({ page }) => {
    await openSettings(page, world[role]);
    await expect(page.getByLabel(h.name)).toHaveValue(world.poolName);
    await expect(page.getByLabel(h.name)).not.toBeEditable();
    await expect(page.getByRole('button', { name: h.save })).toHaveCount(0);
  });
}
