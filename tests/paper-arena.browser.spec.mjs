import { test, expect } from '@playwright/test';

test('production Paper Arena boots and executes a virtual fill in-browser', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(String(err?.message || err)));
  await page.goto('https://finpilot-ai-8wn6.onrender.com/?paperSmoke=1', { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.waitForTimeout(3000);
  const diagnostics = await page.evaluate(() => ({ show: typeof window.show, nav: document.getElementById('nav')?.innerText || '', active: document.querySelector('.view.active')?.id || '' }));
  expect(diagnostics.show, 'FinPilot show() must initialize; page errors: '+errors.join(' | ')+'; nav: '+diagnostics.nav).toBe('function');
  await page.evaluate(() => window.show('paperlab'));

  await expect(page.locator('#paperlab')).toContainText('PAPER ONLY', { timeout: 30000 });
  const boot = await page.evaluate(() => ({
    paperLab: typeof window.paperLab,
    core: typeof window.FinPilotPaperCore,
    paperView: document.getElementById('paperlab')?.innerText || ''
  }));
  expect(boot.paperLab).toBe('function');
  expect(boot.core).toBe('object');

  const verified = page.getByRole('button', { name: /Get verified price/i });
  await verified.click();
  await expect(page.locator('#paperMarketStatus')).not.toContainText('Market data unavailable', { timeout: 30000 });

  await page.getByRole('button', { name: /Run AI Council/i }).click();
  await expect(page.locator('#paperlab')).toContainText(/PAPER (BUY|SELL|HOLD)/, { timeout: 30000 });

  const execution = await page.evaluate(() => {
    const core = window.FinPilotPaperCore;
    const st = window.state;
    const p = core.ensure(st);
    const a = p.agents[0];
    const before = a.cash;
    const order = core.paperOrder(st, a.id, 'SMOKE', 'BUY', 1, 100, 'browser smoke execution');
    return { status: order.status, virtualOnly: order.virtualOnly, positionQty: a.positions.find(x => x.symbol === 'SMOKE')?.qty || 0, cashReduced: a.cash < before };
  });
  expect(execution.status).toBe('FILLED');
  expect(execution.virtualOnly).toBe(true);
  expect(execution.positionQty).toBe(1);
  expect(execution.cashReduced).toBe(true);
  expect(errors).toEqual([]);
});
