import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import {
  MEMBERS_PASSWORD,
  seedMembersWorld,
  type MembersPerson,
  type MembersWorld,
} from './support/members';
import { fillAndSubmit } from './support/sign-in';

const h = messages.holders;

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

const settingsUrl = () => `/${world.poolId}/definicoes`;
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

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

async function openSettings(page: Page, person: MembersPerson) {
  await page.goto(`/login?next=${encodeURIComponent(settingsUrl())}`);
  await fillAndSubmit(page, person.email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${world.poolId}/definicoes`));
  await hydrated(page);
}

test('an admin adds, edits and removes a person (modal 26)', async ({ page }) => {
  await openSettings(page, world.admin);
  await expect(page.getByRole('heading', { name: h.title })).toBeVisible();

  await page.getByRole('button', { name: h.add }).click();
  const add = dialog(page, h.dialog.title);
  await add.getByLabel(h.dialog.name).fill('Simão');
  await add.getByLabel(h.dialog.aliases).fill('simão rocha, s rocha');
  await add.getByRole('button', { name: h.dialog.submit }).click();
  await expect(add).toBeHidden();

  const item = page.getByRole('listitem').filter({ hasText: 'Simão' });
  await expect(item).toContainText('SIMAO ROCHA');
  await expect(item).toContainText('S ROCHA');

  await page.getByRole('button', { name: h.edit.replace('{name}', 'Simão') }).click();
  const edit = dialog(page, h.dialog.editTitle);
  await edit.getByLabel(h.dialog.name).fill('Simão Pedro');
  await edit.getByRole('button', { name: h.dialog.submit }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Simão Pedro' })).toBeVisible();

  await page.getByRole('button', { name: h.remove.replace('{name}', 'Simão Pedro') }).click();
  await dialog(page, h.delete.title.replace('{name}', 'Simão Pedro'))
    .getByRole('button', { name: h.delete.submit })
    .click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Simão Pedro' })).toHaveCount(0);
});

test('every member is listed without being added, and cannot be removed', async ({ page }) => {
  await openSettings(page, world.admin);
  for (const person of [world.owner, world.admin, world.member, world.viewer]) {
    const item = page.getByRole('listitem').filter({ hasText: person.name });
    await expect(item).toContainText(h.member);
    await expect(
      item.getByRole('button', { name: h.remove.replace('{name}', person.name) }),
    ).toHaveCount(0);
    await expect(
      item.getByRole('button', { name: h.edit.replace('{name}', person.name) }),
    ).toBeVisible();
  }
});

test('a viewer sees the people but has no way to change them', async ({ page }) => {
  await openSettings(page, world.viewer);
  await expect(page.getByRole('heading', { name: h.title })).toBeVisible();
  await expect(page.getByRole('button', { name: h.add })).toHaveCount(0);
});

test('the settings tab bar scrolls sideways only when it does not fit', async ({ page }) => {
  await openSettings(page, world.admin);
  const nav = page.getByRole('navigation', { name: messages.settings.tabsLabel });
  const sizes = await nav.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(sizes.scrollHeight).toBe(sizes.clientHeight);
});
