const path = require('path');
const { ensureDir, slugFromUrl } = require('./utils');
const { collectPageMetrics } = require('./page-metrics');
const { collectCtaMetrics } = require('./cta-metrics');
const { collectFunnelMetrics } = require('./funnel-metrics');
const { collectChannelMetrics } = require('./channel-metrics');
const { collectHeroMetrics } = require('./hero-metrics');
const { collectOverlayMetrics } = require('./overlay-metrics');
const { scoreHeroClarity } = require('./hero-scorecard');
const { resilientGoto } = require('./navigation');

async function inspectPage(browser, pageDef, rootDir, options = {}) {
  const dir = ensureDir(path.join(rootDir,'pages',slugFromUrl(pageDef.url)));
  const results = {};
  for (const [name,vp] of Object.entries({desktop:{width:1440,height:1000},mobile:{width:390,height:844,isMobile:true,hasTouch:true}})) {
    const context = await browser.newContext({viewport:{width:vp.width,height:vp.height},isMobile:!!vp.isMobile,hasTouch:!!vp.hasTouch,ignoreHTTPSErrors:true});
    const page = await context.newPage();
    try {
      let navigation = await resilientGoto(page, pageDef.url, { timeoutMs: options.timeoutMs || 30000, fallbackTimeoutMs: options.navigationFallbackTimeoutMs || 60000, slowThresholdMs: options.slowLoadThresholdMs || 8000 });
      let response = navigation.response;
      await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{}); await page.waitForTimeout(250);
      const [pageMetrics,ctaMetrics,funnelMetrics,channelMetrics,heroMetrics,overlayMetrics] = await Promise.all([
        collectPageMetrics(page),collectCtaMetrics(page),collectFunnelMetrics(page),collectChannelMetrics(page),collectHeroMetrics(page),collectOverlayMetrics(page)
      ]);
      const heroScorecard = scoreHeroClarity(heroMetrics,ctaMetrics.primaryCta,overlayMetrics,{},pageMetrics);
      const viewportShot=path.join(dir,`${name}-viewport.png`); await page.screenshot({path:viewportShot,fullPage:false});
      const fullShot=path.join(dir,`${name}-full.png`); await page.screenshot({path:fullShot,fullPage:true});
      results[name]={url:page.url(),httpStatus:response?.status()||null,screenshots:{viewport:viewportShot,fullPage:fullShot},pageMetrics,ctaMetrics,funnelMetrics,channelMetrics,heroMetrics,overlayMetrics,heroScorecard,navigation:{durationMs:navigation.durationMs,slowLoad:navigation.slowLoad,fallbackUsed:navigation.fallbackUsed,attempts:navigation.attempts}};
    } catch(error) { results[name]={url:pageDef.url,error:String(error.message||error)}; }
    finally { await context.close(); }
  }
  return { ...pageDef, directory:dir, desktop:results.desktop, mobile:results.mobile };
}

async function inspectSelectedPages(browser, discovery, outDir, options={}) {
  const selected = discovery.selectedDeepPages || [];
  const concurrency = Math.max(1, Math.min(Number(options.deepPageConcurrency || 2), 4));
  const results = new Array(selected.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= selected.length) return;
      results[index] = await inspectPage(browser, selected[index], outDir, options);
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency, selected.length)}, () => worker()));
  return { selectedCount:selected.length, pages:results, concurrencyUsed:concurrency };
}
module.exports={inspectPage,inspectSelectedPages};
