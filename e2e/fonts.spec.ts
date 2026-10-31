import { expect, test } from '@playwright/test';

// The kiosk can boot without DNS, so the app font must come from the app's own origin. Every other host is
// blocked here, and the test records any attempt to reach one.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

for (const viewport of [{ name: 'kiosk', width: 1024, height: 600 }]) {
  test(`Plus Jakarta Sans loads from the app with external requests blocked (${viewport.name})`, async ({ page }) => {
    const origin = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1').origin;
    const fontRequests: string[] = [];
    page.on('request', request => {
      if (request.resourceType() === 'font') fontRequests.push(request.url());
    });
    await page.route(
      url => url.origin !== origin,
      route =>
        // Demo artwork is remote; answer it locally so the page renders as usual, and abort everything else.
        route.request().resourceType() === 'image'
          ? route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
          : route.abort()
    );

    await page.setViewportSize(viewport);
    await page.goto('/?demo=true&kiosk=1');
    await expect(page.getByRole('heading', { name: 'One More Time' })).toBeVisible();

    // document.fonts.check() also passes when no @font-face matches, so look at the bundled faces' own status.
    const loaded = await page.locator('html').evaluate(async html => {
      const { fonts } = html.ownerDocument;
      await fonts.ready;
      return [...fonts]
        .filter(face => face.family.replaceAll('"', '') === 'Plus Jakarta Sans' && face.status === 'loaded')
        .map(face => face.weight);
    });
    expect(loaded.length).toBeGreaterThan(0);
    expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily)).toMatch(
      /^"Plus Jakarta Sans"/
    );
    expect(fontRequests.length).toBeGreaterThan(0);
    for (const url of fontRequests) expect(new URL(url).origin).toBe(origin);
    expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}
