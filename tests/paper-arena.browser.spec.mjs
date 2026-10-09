import { test, expect } from '@playwright/test';

test('production Paper Arena renders charts and only fills when market data is verified', async ({ page }) => {
  const errors = [];
  const errorDetails = [];
  const consoleErrors = [];
  const requestFailures = [];
  const scriptResponses = [];
  await page.addInitScript(() => { window.addEventListener('error', e => { (window.__finErrors ||= []).push({message:e.message, filename:e.filename, line:e.lineno, col:e.colno}); }); });
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => errors.push(String(err?.stack || err?.message || err)));
  page.on('requestfailed', req => { if (/paper-(engine|lab)\.js/.test(req.url())) requestFailures.push({url:req.url(),failure:req.failure()?.errorText||'unknown'}); });
  page.on('response', res => { if (/paper-(engine|lab)\.js/.test(res.url())) scriptResponses.push({url:res.url(),status:res.status(),type:res.request().resourceType()}); });
  await page.goto('https://finpilot-ai-8wn6.onrender.com/?paperSmoke=3', { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.waitForTimeout(3000);
  const prePaper = await page.evaluate(() => ({ core: typeof window.FinPilotPaperCore, lab: typeof window.paperLab, engineLoaded: Boolean(window.__finPaperEngineLoaded) }));
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
  console.log('PAPER_PRE_DIAGNOSTICS', JSON.stringify({prePaper, requestFailures, scriptResponses}));
  console.log('PAPER_BOOT_DIAGNOSTICS', JSON.stringify({errors, consoleErrors, browserErrors, diagnostics, scriptDiagnostics}));
  expect(diagnostics.show, 'FinPilot show() must initialize; page errors: '+errors.join(' | ')+'; nav: '+diagnostics.nav).toBe('function');
  expect(await page.evaluate(() => Boolean(window.FinPilotBridge)), 'FinPilot bridge missing; page errors: '+errors.join(' | ')).toBe(true);
  await page.evaluate(() => window.show('paperlab'));
  await page.evaluate(() => {
    window.FinPilotBridge.state.paperTrading = window.FinPilotPaperCore.defaultPaper();
    window.FinPilotBridge.save();
    window.FinPilotBridge.render('paperlab');
  });
  await page.waitForTimeout(500);

  await page.waitForTimeout(1000);
  await expect(page.locator('#fpChatLauncher')).toBeVisible();
  await expect(page.locator('#fpBenchmarkLauncher')).toBeVisible();
  expect(await page.evaluate(() => typeof window.FinPilotChat)).toBe('object');
  expect(await page.evaluate(() => typeof window.FinPilotBenchmark)).toBe('object');
  console.log('PAPER_AFTER_SHOW', JSON.stringify(await page.evaluate(() => ({core: typeof window.FinPilotPaperCore, lab: typeof window.paperLab, engineLoaded: Boolean(window.__finPaperEngineLoaded), engineError: window.__finPaperEngineError || null, paperText: document.getElementById('paperlab')?.innerText || ''}))));

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
  await page.waitForTimeout(2500);
  console.log('PAPER_LAB_SOURCE_CHECK', JSON.stringify(await page.evaluate(async () => { try { const t=await (await fetch('/paper-lab.js?diag='+Date.now(),{cache:'no-store'})).text(); return {hasOptionalFields:t.includes("const pm="),hasRenderCall:t.includes('renderPaperChart(market)'),length:t.length,executedHasOptionalFields:String(window.loadPaperMarket||'').includes('const pm='),executedHasRenderCall:String(window.loadPaperMarket||'').includes('renderPaperChart(market)')}; } catch(e){ return {error:String(e?.message||e)}; } }))); 
  console.log('PAPER_LOADER_RUNTIME', JSON.stringify(await page.evaluate(() => ({error:window.__paperMarketLoaderError||null,status:document.getElementById('paperMarketStatus')?.innerText||'',chart:document.getElementById('paperChart')?.innerText||''}))));
  console.log('PAPER_MARKET_AFTER_CLICK', JSON.stringify(await page.evaluate(async () => { let api=null; try { const r=await fetch('/api/stock-report?ticker=BTC&interval=1h&multi=1&diag='+Date.now(),{cache:'no-store'}); api={status:r.status,body:(await r.text()).slice(0,1200)}; } catch(e){ api={error:String(e?.message||e)}; } return {status:document.getElementById('paperMarketStatus')?.innerText||'',chart:document.getElementById('paperChart')?.innerText||'',api}; })));
  await expect(page.locator('#paperChart')).toContainText(/Provider:/, { timeout: 15000 });
  expect(await page.locator('#paperChart svg').count()).toBe(1);
  expect(await page.locator('#paperChart .cu, #paperChart .cd').count()).toBeGreaterThan(1);
  const marketGate = await page.evaluate(async () => { try { const r=await fetch('/api/market-data-os?ticker=BTC&interval=1h&ts='+Date.now(),{cache:'no-store'}); const d=await r.json(); return {eligible:d?.executionEligible===true&&d?.marketDataOS?.decision==='ALLOW_ANALYSIS_AND_PAPER',status:d?.marketDataOS?.status||'UNKNOWN'}; } catch(e) { return {eligible:false,status:'UNAVAILABLE'}; } });
  console.log('PAPER_MARKET_GATE', JSON.stringify(marketGate));
  if (!marketGate.eligible) {
    await expect(page.locator('#paperMarketStatus')).toContainText(/UNVERIFIED|unavailable|verification/i);
    expect(await page.locator('#paperPrice').inputValue()).toMatch(/^(|0|0\\.0+)$/);
    console.log('PAPER_ORDER_SAFETY', 'No verified quote; chart-only mode retained and execution skipped safely.');
    return;
  }
  // Verify the actual visible BUY button using the AI risk-sized fractional quantity.
  const quantity = page.locator('#paperQty');
  const suggestedQtyText = await page.locator('#paperRecommendation').innerText();
  expect(suggestedQtyText).not.toContain('Suggested paper size 0 BTC');
  const verifiedPrice = Number(await page.locator('#paperPrice').inputValue());
  expect(verifiedPrice).toBeGreaterThan(0);
  // A market order without protective levels should be blocked by the risk engine.
  // Supply valid SL/TP and a smaller notional so this smoke test checks the allowed path.
  await page.locator('#paperStop').fill(String(verifiedPrice * 0.98));
  await page.locator('#paperTarget').fill(String(verifiedPrice * 1.03));
  await quantity.fill('0.05');
  await page.getByRole('button', { name: /BUY · MARKET/i }).click();
  await page.waitForTimeout(1200);

  await expect(page.locator('#paperRecommendation')).toContainText('FINPILOT EXECUTION SIGNAL');
  await expect(page.locator('#paperRecommendation')).toContainText(/CFO|Risk|Markets/);
  await expect(page.locator('#paperRiskTower')).toContainText('EXECUTION CONTROL TOWER');
  await expect(page.locator('#paperRiskTower')).toContainText(/PASS|WARN|BLOCK/);
  await expect(page.locator('#paperRiskTower')).not.toContainText('BLOCK');
  await expect(page.locator('#paperRecommendation')).not.toContainText('Suggested paper size 0 BTC');
  const recommendation = await page.locator('#paperRecommendation').innerText();
  expect(recommendation).toContain('FINPILOT EXECUTION SIGNAL');
  expect(await page.locator('#paperExecHigh').innerText()).not.toBe('₹0');
  expect(await page.locator('#paperExecLow').innerText()).not.toBe('₹0');

  const execution = await page.evaluate(() => {
    const st = window.FinPilotBridge.state;
    const p = window.FinPilotPaperCore.ensure(st);
    const orders = p.orders || [];
    const latest = orders.find(o => o.reason === 'Manual paper market') || orders[0];
    const agent = p.agents.find(a => a.id === document.getElementById('paperAgent')?.value) || p.agents[0];
    return {
      status: latest?.status || null,
      virtualOnly: latest?.virtualOnly ?? null,
      side: latest?.side || null,
      symbol: latest?.symbol || null,
      qty: latest?.qty || 0,
      requestedQty: Number(document.getElementById('paperQty')?.value || 0),
      positionQty: agent?.positions.find(x => x.symbol === latest?.symbol)?.qty || 0,
      executionStatus: document.getElementById('paperExecutionStatus')?.innerText || ''
    };
  });
  console.log('PAPER_UI_EXECUTION', JSON.stringify(execution));
  expect(execution.status).toBe('FILLED');
  expect(execution.virtualOnly).toBe(true);
  expect(execution.side).toBe('BUY');
  expect(execution.positionQty).toBeGreaterThan(0);
  expect(execution.qty).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
