import { test, expect, request } from '@playwright/test';

// Smoke suite for the deployed web CRM + shared backend. No credentials needed:
// it checks the public surface and that the authenticated API routes the mobile
// app depends on are alive and correctly guarded (401), not down (5xx) or gone (404).
//
// Run:  npx playwright test
// Local: PW_BASE_URL=http://localhost:5173 npx playwright test
// Authenticated flows are intentionally out of scope here — add a logged-in
// fixture with a test account to extend coverage.

const BASE = process.env.PW_BASE_URL ?? 'https://lumeeeeeeeeee-production.up.railway.app';

// The shared rate limiter can return 429 to a busy test IP. That's infra noise,
// not a regression — skip the content assertion in that case, but still fail on a
// genuine 404 (route gone) or 5xx (server broken).
function assertAliveOrSkip(status: number | undefined, path: string) {
  if (status === 429) test.skip(true, `${path} rate-limited (429) — inconclusive`);
  expect(status, `${path} HTTP status`).toBeLessThan(400);
}

test.describe('public web surface', () => {
  test('landing page renders the Lume brand', async ({ page }) => {
    const res = await page.goto('/');
    assertAliveOrSkip(res?.status(), '/');
    await expect(page).toHaveTitle(/Lume/i);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('sign-in page exposes an email field (shared auth surface)', async ({ page }) => {
    const res = await page.goto('/login');
    assertAliveOrSkip(res?.status(), '/login');
    // SPA route — wait for the auth form to hydrate.
    const email = page.locator('input[type="email"], input[name="email"]').first();
    await expect(email).toBeVisible({ timeout: 15_000 });
  });

  for (const path of ['/privacy', '/terms']) {
    test(`legal page ${path} loads`, async ({ page }) => {
      const res = await page.goto(path);
      assertAliveOrSkip(res?.status(), path);
      // SPA shell mounted (content renders into #root after hydration).
      await expect(page.locator('#root')).toBeAttached();
      await page.waitForLoadState('domcontentloaded');
    });
  }
});

test.describe('shared backend API health', () => {
  test('GET /api/health is up', async () => {
    const ctx = await request.newContext({ baseURL: BASE });
    const res = await ctx.get('/api/health');
    // 200 = healthy; 429 = alive but rate-limited (still proves the server is up).
    expect([200, 429]).toContain(res.status());
    await ctx.dispose();
  });

  // The mobile app now calls these authenticated routes directly. They must be
  // alive and guarded — 401 (or a 429 from the rate limiter) is healthy; a 404
  // would mean the route is gone and a 5xx that it's broken.
  test('authenticated routes are alive and guarded', async () => {
    const ctx = await request.newContext({ baseURL: BASE });
    const guarded = (status: number) => [401, 429].includes(status);

    const sms = await ctx.post('/api/messages/send', { data: {} });
    expect(guarded(sms.status()), `POST /api/messages/send -> ${sms.status()}`).toBeTruthy();

    const email = await ctx.post('/api/emails/send-invoice', { data: {} });
    expect(guarded(email.status()), `POST /api/emails/send-invoice -> ${email.status()}`).toBeTruthy();

    const search = await ctx.get('/api/search?q=test');
    expect(guarded(search.status()), `GET /api/search -> ${search.status()}`).toBeTruthy();

    await ctx.dispose();
  });
});
