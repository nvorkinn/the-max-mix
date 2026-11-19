import { expect, type Locator, type Page } from '@playwright/test';
/** Shows the Settings tab, on its first page, or on one section picked in its navigation. */
export async function openSettings(page: Page, section?: string): Promise<Locator> {
  await page.getByRole('tab', { name: 'Settings' }).click();
  const dialog = page.getByRole('tabpanel', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  if (section) await showSection(dialog, section);
  return dialog;
}

/** Picks a section in the Settings tab's navigation. */
export async function showSection(dialog: Locator, section: string): Promise<void> {
  await dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: section, exact: true })
    .click();
  await expect(dialog.getByRole('region', { name: section, exact: true })).toBeVisible();
}
