// Frozen reference snapshot — Playwright codegen output for the synthetic
// fixture. Captured live by `npx playwright codegen http://127.0.0.1:<port>/synthetic`
// against `scripts/fixtures/site-server.mjs` on 2026-05-19.
//
// User actions during recording: open page → fill "Display name" with "테스트"
// → click "Run Demo" → verified the result page rendered "Workflow Complete"
// and "Hello, 테스트".
//
// Verbatim, unedited output from the codegen Inspector. Used as the Path A
// baseline in `docs/baseline-comparison.md`. Do NOT edit — comparison
// integrity depends on this being raw tool output. Five `page.locator('html').click()`
// calls are codegen-recorded accidental clicks that the user did not
// intentionally perform; preserved verbatim because they are part of the
// real baseline experience.

import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://127.0.0.1:57209/synthetic');
  await page.locator('html').click();
  await page.getByRole('textbox', { name: 'Display name' }).click();
  await page.getByRole('textbox', { name: 'Display name' }).click();
  await page.getByRole('textbox', { name: 'Display name' }).fill('테스트');
  await page.getByRole('button', { name: 'Run Demo' }).click();
  await page.locator('html').click();
  await page.getByText('Hello, 테스트').click();
  await page.getByRole('heading', { name: 'Workflow Complete' }).click();
  await page.getByText('Workflow Complete Hello, 테스트').click();
  await page.locator('html').click();
});
