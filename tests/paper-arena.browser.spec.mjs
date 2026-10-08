import { test, expect } from '@playwright/test';

test('production Paper Arena boots and executes a virtual fill in-browser', async ({ page }) => {
  const errors = [];
  const errorDetails = [];
  const consoleErrors = [];
  await page.addInitScript(() => { window.addEventListener('error', e => { (window.__finErrors ||= []).push({message:e.message, filename:e.filename, line:e.lineno, col:e.colno}); }); });
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => errors.push(String(err?.stack || err?.message || err)));
  await page.goto('https://finpilot-ai-8wn6.onrender.com/?paperSmoke=2', { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.waitForTimeout(3000);
  const diagnostics = await page.evaluate(() => ({ show: typeof window.show, nav: document.getElementById('nav')?.innerText || '', active: document.querySelector('.view.active')?.id || '' }));
  const scriptDiagnostics = await page.evaluate(async () => {
    const out = [];
    for (const s of [...document.scripts]) {
      if (!s.src) continue;
      try {
        const src = await (await fetch(s.src, {cache:'no-store'})).text();
        try { new Function(src); out.push({src:s.src, syntax:'ok'}); }
        catch (e) { out.push({src:s.src, syntax:String(e?.message||e), sample:src.slice(0,180)}); }
      } catch (e) { out.push({src:s.src, fetch:String(e?.message||e)}); }
    }
    return out;
  });
  const browserErrors = await page.evaluate(() => window.__finErrors || []);
  console.log('PAPER_BOOT_DIAGNOSTICS', JSON.stringify({errors, consoleErrors, browserErrors, diagnostics, scriptDiagnostics}));
  expect(diagnostics.show, 'FinPilot show() must initialize; page errors: '+errors.join(' | ')+'; nav: '+diagnostics.nav).toBe('function');
  expect(await page.evaluate(() => Boolean(window.FinPilotBridge)), 'FinPilot bridge missing; page errors: '+errors.join(' | ')).toBe(true);
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
  await page.waitForTimeout(1500);
  // The browser test first attempts the real verified quote path. For deterministic execution,
  // it then switches the ticket to an explicitly synthetic SMOKE instrument.
  await page.locator('#paperSymbol').evaluate(el => { el.value = 'SMOKE'; });
  await page.locator('#paperPrice').evaluate(el => { el.value = '100'; });

  await page.getByRole('button', { name: /Run AI Council/i }).click();
  await expect(page.locator('#paperlab')).toContainText(/PAPER (BUY|SELL|HOLD)/, { timeout: 30000 });

  const execution = await page.evaluate(() => {
    const core = window.FinPilotPaperCore;
    const st = window.FinPilotBridge.state;
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
