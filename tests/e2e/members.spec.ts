import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import {
  HOSTILE_NAME,
  MEMBERS_PASSWORD,
  seedMembersWorld,
  type MembersPerson,
  type MembersWorld,
} from './support/members';
import { fillAndSubmit } from './support/sign-in';

const m = messages.members;

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

const membersUrl = () => `/${world.poolId}/definicoes/membros`;
const ownershipLeave = (page: Page) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: m.ownership.title }) })
    .getByRole('button', { name: m.ownership.leave });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const row = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });

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

async function openMembers(page: Page, person: MembersPerson) {
  await page.goto(`/login?next=${encodeURIComponent(membersUrl())}`);
  await fillAndSubmit(page, person.email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${world.poolId}/definicoes/membros`));
  await hydrated(page);
}

test('the owner sees the people, the pending invites and the ownership card (screen 64)', async ({
  page,
}) => {
  await openMembers(page, world.owner);

  const nav = page.getByRole('navigation', { name: messages.settings.tabsLabel });
  await expect(nav.getByRole('link', { name: messages.settings.tabs.members })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: m.users.title })).toBeVisible();
  for (const person of [world.owner, world.admin, world.member, world.viewer]) {
    await expect(page.getByText(person.email)).toBeVisible();
  }
  await expect(row(page, 'Rui').getByText(m.users.you, { exact: true })).toBeVisible();
  await expect(row(page, 'Rui').getByRole('combobox')).toBeDisabled();
  await expect(row(page, 'Ana').getByRole('combobox')).toBeEnabled();
  await expect(row(page, 'Rui').getByRole('button', { name: m.users.leaveLabel })).toBeVisible();
  await expect(row(page, 'Rui').getByRole('button', { name: /Remover/ })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: m.invites.title })).toBeVisible();
  await expect(page.getByText(world.inviteEmail)).toBeVisible();
  await expect(page.getByText('em 4 dias').or(page.getByText('em 5 dias'))).toBeVisible();
  await expect(page.getByRole('heading', { name: m.ownership.title })).toBeVisible();
  await expect(page.getByText(m.ownership.soleNote)).toBeVisible();
});

test('changing a role shows what is kept and lost, then applies it (modal 75)', async ({
  page,
}) => {
  await openMembers(page, world.owner);

  await row(page, 'Ana').getByRole('combobox').selectOption('member');
  const changing = dialog(page, m.changeRole.title.replace('{name}', 'Ana'));
  await expect(changing).toBeVisible();
  await expect(changing.getByText(m.capabilities.viewData)).toBeVisible();
  await expect(changing.getByText(m.capabilities.structure)).toBeVisible();
  await expect(changing.getByText(m.capabilities.people)).toBeVisible();
  await expect(changing.getByText(m.changeRole.sessionNote.replace('{name}', 'Ana'))).toBeVisible();

  await changing.getByRole('button', { name: m.changeRole.submit }).click();
  await expect(page.getByText(m.toast.roleChanged)).toBeVisible();
  await expect(row(page, 'Ana').getByRole('combobox')).toHaveValue('member');
  await expect(changing).toHaveCount(0);
});

test('cancelling the role dialog changes nothing', async ({ page }) => {
  await openMembers(page, world.owner);
  await row(page, 'Ana').getByRole('combobox').selectOption('viewer');
  await dialog(page, m.changeRole.title.replace('{name}', 'Ana'))
    .getByRole('button', { name: m.dialog.cancel })
    .click();
  await expect(row(page, 'Ana').getByRole('combobox')).toHaveValue('admin');
});

test('removing a person asks first and then drops them from the list (modal 74)', async ({
  page,
}) => {
  await openMembers(page, world.owner);

  await row(page, 'Beto')
    .getByRole('button', { name: /Remover/ })
    .click();
  const removing = dialog(page, m.removeMember.title.replace('{name}', 'Beto'));
  await expect(removing.getByText(m.removeMember.access)).toBeVisible();
  await expect(removing.getByText(m.removeMember.audit)).toBeVisible();
  await removing.getByRole('button', { name: m.removeMember.submit }).click();

  await expect(page.getByText(m.toast.removed)).toBeVisible();
  await expect(row(page, 'Beto')).toHaveCount(0);
  await expect(page.getByText(world.member.email)).toHaveCount(0);
});

test('a pending invite can be cancelled and resent', async ({ page }) => {
  await openMembers(page, world.owner);

  await page
    .getByRole('button', { name: m.invites.resendLabel.replace('{email}', world.inviteEmail) })
    .click();
  await expect(page.getByText(m.toast.inviteResent)).toBeVisible();

  await page
    .getByRole('button', { name: m.invites.cancelLabel.replace('{email}', world.inviteEmail) })
    .click();
  await expect(page.getByText(m.toast.inviteCancelled)).toBeVisible();
  await expect(page.getByText(world.inviteEmail)).toHaveCount(0);
  await expect(page.getByText(m.invites.empty)).toBeVisible();
});

test('the only owner cannot leave and is offered the transfer (modal 73)', async ({ page }) => {
  await openMembers(page, world.owner);

  // As drawn (screen 64): the card's leave button is disabled with the note, the row's Sair is not.
  await expect(ownershipLeave(page)).toBeDisabled();
  await expect(page.getByText(m.ownership.soleNote)).toBeVisible();
  await expect(row(page, 'Rui').getByRole('button', { name: m.users.leaveLabel })).toBeEnabled();
  await row(page, 'Rui').getByRole('button', { name: m.users.leaveLabel }).click();
  const blocked = dialog(page, m.leavePool.title);
  await expect(
    blocked.getByText(m.leaveBlocked.title.replace('{pool}', world.poolName)),
  ).toBeVisible();
  await blocked.getByRole('button', { name: m.leaveBlocked.transfer }).click();
  await expect(dialog(page, m.transfer.title)).toBeVisible();
});

test('transferring the pool needs the right password and makes the owner an admin (modal 67)', async ({
  page,
}) => {
  await openMembers(page, world.owner);

  await page.getByRole('button', { name: m.ownership.transfer }).click();
  const transferring = dialog(page, m.transfer.title);
  await transferring
    .getByLabel(m.transfer.target)
    .selectOption({ label: `Ana (${world.admin.email})` });
  await transferring.getByLabel(m.transfer.password).fill('not-the-right-password');
  await transferring.getByRole('button', { name: m.transfer.submit }).click();
  await expect(transferring.getByText(m.transfer.wrongPassword)).toBeVisible();

  await transferring.getByLabel(m.transfer.password).fill(MEMBERS_PASSWORD);
  await transferring.getByRole('button', { name: m.transfer.submit }).click();
  await expect(page.getByText(m.toast.transferred)).toBeVisible();
  await expect(row(page, 'Ana').getByRole('combobox')).toHaveValue('owner');
  await expect(page.getByRole('heading', { name: m.ownership.title })).toHaveCount(0);
});

test('the owner can keep the ownership when handing the pool over (modal 67)', async ({ page }) => {
  await openMembers(page, world.owner);

  await page.getByRole('button', { name: m.ownership.transfer }).click();
  const transferring = dialog(page, m.transfer.title);
  await expect(transferring.getByText(m.transfer.warning.replace(/<\/?b>/g, ''))).toBeVisible();
  await transferring
    .getByLabel(m.transfer.target)
    .selectOption({ label: `Ana (${world.admin.email})` });
  await transferring.getByLabel(m.transfer.password).fill(MEMBERS_PASSWORD);
  await transferring.getByLabel(m.transfer.keep).check();
  await expect(transferring.getByText(m.transfer.warningKeep.replace(/<\/?b>/g, ''))).toBeVisible();
  await transferring.getByRole('button', { name: m.transfer.submit }).click();

  await expect(page.getByText(m.toast.transferred)).toBeVisible();
  await expect(row(page, 'Ana').getByRole('combobox')).toHaveValue('owner');
  // Still an owner: the ownership card stays and the leave button is no longer blocked.
  await expect(page.getByRole('heading', { name: m.ownership.title })).toBeVisible();
  await expect(page.getByText(m.ownership.soleNote)).toHaveCount(0);
  await expect(ownershipLeave(page)).toBeEnabled();
});

test('a member sees names and roles only, and can leave the pool (modal 72)', async ({ page }) => {
  await openMembers(page, world.member);

  await expect(page.getByRole('heading', { name: m.users.title })).toBeVisible();
  await expect(page.getByText('Rui', { exact: true })).toBeVisible();
  await expect(page.getByText('@e2e.example.test')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: m.invite })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: m.invites.title })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Remover/ })).toHaveCount(0);

  await row(page, 'Beto').getByRole('button', { name: m.users.leaveLabel }).click();
  const leaving = dialog(page, m.leavePool.title);
  await expect(leaving.getByText(m.leavePool.reinvite)).toBeVisible();
  await leaving.getByRole('button', { name: m.leavePool.submit }).click();

  await expect(page).toHaveURL(/\/pools/);
  const gone = await page.goto(membersUrl());
  expect(gone?.status()).toBe(404);
});

test('an admin changes roles but never touches the owner', async ({ page }) => {
  await openMembers(page, world.admin);

  await expect(row(page, 'Rui').getByRole('combobox')).toBeDisabled();
  await expect(row(page, 'Rui').getByRole('button', { name: /Remover/ })).toHaveCount(0);
  await expect(row(page, 'Beto').getByRole('combobox')).toBeEnabled();
  await expect(page.getByRole('heading', { name: m.ownership.title })).toHaveCount(0);
  await expect(page.getByRole('button', { name: m.invite })).toBeVisible();
});

test('names and emails are shown as text, never run as markup', async ({ page }) => {
  world = await seedMembersWorld({ viewerName: HOSTILE_NAME });
  await openMembers(page, world.owner);

  await expect(page.getByText(HOSTILE_NAME, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
});

test('the invite dialog sends an invite and lists it (modal 66)', async ({ page }) => {
  await openMembers(page, world.owner);
  const email = `fresh-${String(Date.now())}@e2e.example.test`;

  await page.getByRole('button', { name: m.invite }).click();
  const inviting = dialog(page, messages.invite.dialog.title);
  await inviting.getByLabel(messages.invite.dialog.email).fill(email);
  await inviting.getByRole('button', { name: messages.invite.dialog.submit }).click();

  await expect(page.getByText(m.toast.inviteSent)).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
});
