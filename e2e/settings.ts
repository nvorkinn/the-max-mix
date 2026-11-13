import { expect, type Locator, type Page } from '@playwright/test';

/** Opens Settings from the header, on the overview, or on one section picked in its navigation. */
export async function openSettings(page: Page, section?: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  if (section) await showSection(dialog, section);
  return dialog;
}

/** Picks a section in the open Settings' navigation. */
export async function showSection(dialog: Locator, section: string): Promise<void> {
  await dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: section, exact: true })
    .click();
  await expect(dialog.getByRole('heading', { name: section, exact: true })).toBeVisible();
}
