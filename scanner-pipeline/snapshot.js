const path = require('path');
const fs = require('fs');
const { normalizeUrl, slugFromUrl, ensureDir, writeJson } = require('./utils');
const { collectPageMetrics } = require('./page-metrics');
const { collectCtaMetrics } = require('./cta-metrics');
const { collectImageMetrics } = require('./image-metrics');
const { collectFunnelMetrics } = require('./funnel-metrics');
const { collectHeroMetrics } = require('./hero-metrics');
const { collectOverlayMetrics, dismissCookieConsent } = require('./overlay-metrics');
const { scoreSnapshot } = require('./scoring');
const { buildChannelModulePlan } = require('./channel-module-plan');
const { toLegacyWebsiteFindings } = require('./audit-adapter');
const { collectChannelMetrics } = require('./channel-metrics');
const { analyzeCtaCompetition } = require('./cta-competition');
const { collectTrustMetrics } = require('./trust-metrics');
const { analyzeBookingFlow } = require('./booking-flow');
const { generateFindings } = require('./findings');
const { scoreHeroClarity } = require('./hero-scorecard');
const { discoverSite } = require('./site-discovery');
const { inspectSelectedPages } = require('./page-journey');
const { buildVisualEvidencePackage, buildVisualReviewTemplate, loadVisualReview, reconcileVisualEvidence, writeVisualEvidenceFiles } = require('./visual-evidence');
const { inferClinicIdentity, buildGoogleBusinessTemplate, scoreGoogleBusiness, loadGoogleBusinessEvidence, buildUnifiedEvidenceSummary, writeGoogleBusinessFiles } = require('./google-business');
const { probeGoogleBusiness, mergeProbeIntoEvidence } = require('./google-business-probe');
const { resilientGoto } = require('./navigation');
const { buildFacebookTemplate, scoreFacebook, loadFacebookEvidence, writeFacebookFiles, buildCrossChannelIntegrity, applyFacebookVisualSurfaceEvidence } = require('./facebook');
const { probeFacebookPage, probeFacebookCandidate, rankFacebookCandidates, mergeFacebookEvidence } = require('./facebook-probe');
const { writeReportFiles, buildReportModel } = require('./report-engine');
const { writeOwnerReportFiles } = require('./owner-report');
const { runAuditIntelligence, writeAuditIntelligence } = require('./openai-audit-intelligence');
const { runFacebookVisualExtraction, writeFacebookVisualExtraction } = require('./facebook-visual-extraction');
const { loadRevenueInputs, buildCrossChannelGrowthModel } = require('./cross-channel-action-engine');
const { loadResponseBenchmark, normalizeResponseBenchmark } = require('./post-submission-response');
const { buildPublicationGuardrails } = require('./publication-guardrails');
const { classifyDigitalFrontDoor, normalizeFacebookCandidates, canonicalFacebookPageUrl } = require('./digital-front-door');

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
};

function loadPlaywright() {
  try { return require('playwright'); }
  catch (error) {
    const e = new Error('Playwright is not installed. Run: npm install --save-dev playwright && npx playwright install chromium');
    e.cause = error; throw e;
  }
}

async function settlePage(page, timeoutMs = 15000) {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 8000) }).catch(() => {});
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
    window.scrollTo(0, 0);
    await new Promise(resolve => setTimeout(resolve, 500));
  }).catch(() => {});
}


async function resilientScreenshot(page, screenshotPath, { fullPage = false, timeoutMs = 12000 } = {}) {
  try {
    await page.screenshot({ path: screenshotPath, fullPage, timeout: timeoutMs });
    return { ok: true, fallbackUsed: false, method: 'playwright' };
  } catch (error) {
    // Some slow sites keep web-font promises unresolved long enough for Playwright's
    // screenshot preflight to time out. Fall back to Chromium CDP capture rather
    // than failing the entire audit. This captures the rendered state as-is.
    try {
      const session = await page.context().newCDPSession(page);
      let params = { format: 'png', fromSurface: true, captureBeyondViewport: true };
      if (fullPage) {
        const metrics = await session.send('Page.getLayoutMetrics');
        const size = metrics.cssContentSize || metrics.contentSize;
        if (size && size.width && size.height) {
          params.clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
        }
      }
      const shot = await session.send('Page.captureScreenshot', params);
      fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
      await session.detach().catch(() => {});
      return { ok: true, fallbackUsed: true, method: 'cdp', primaryError: String(error.message || error) };
    } catch (fallbackError) {
      const combined = new Error(`Screenshot failed in Playwright and CDP fallback: ${fallbackError.message || fallbackError}`);
      combined.cause = error;
      throw combined;
    }
  }
}

async function collectAll(page) {
  const [pageMetrics, ctaMetrics, imageMetrics, funnelMetrics, heroMetrics, overlayMetrics, channelMetrics] = await Promise.all([
    collectPageMetrics(page), collectCtaMetrics(page), collectImageMetrics(page), collectFunnelMetrics(page), collectHeroMetrics(page), collectOverlayMetrics(page), collectChannelMetrics(page)
  ]);
  const ctaCompetition = analyzeCtaCompetition(ctaMetrics, channelMetrics);
  const trustMetrics = collectTrustMetrics(funnelMetrics);
  return { pageMetrics, ctaMetrics, imageMetrics, funnelMetrics, heroMetrics, overlayMetrics, channelMetrics, ctaCompetition, trustMetrics };
}

async function captureViewport(browser, targetUrl, name, viewport, outDir, options = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor || 1,
    isMobile: !!viewport.isMobile, hasTouch: !!viewport.hasTouch, userAgent: options.userAgent || undefined, ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  const consoleErrors = [], failedRequests = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500)); });
  page.on('requestfailed', req => failedRequests.push({ url: req.url().slice(0,1000), error: req.failure()?.errorText || '' }));

  const navigation = await resilientGoto(page, targetUrl, {
    timeoutMs: options.timeoutMs || 30000,
    fallbackTimeoutMs: options.navigationFallbackTimeoutMs || 60000,
    slowThresholdMs: options.slowLoadThresholdMs || 8000
  });
  const response = navigation.response;
  const navigationAttempts = navigation.attempts;
  await settlePage(page, options.timeoutMs || 15000);
  await page.waitForTimeout(options.firstVisitOverlayWaitMs == null ? 900 : options.firstVisitOverlayWaitMs);

  const heroPath = path.join(outDir, `${name}-hero.png`);
  const fullPath = path.join(outDir, `${name}-full.png`);
  const heroShot = await resilientScreenshot(page, heroPath, { fullPage: false, timeoutMs: options.screenshotTimeoutMs || 12000 });
  const fullShot = await resilientScreenshot(page, fullPath, { fullPage: true, timeoutMs: options.screenshotTimeoutMs || 12000 });

  const firstVisit = await collectAll(page);
  const screenshots = { hero: heroPath, full: fullPath };
  const screenshotEvidence = { hero: heroShot, full: fullShot, fallbackUsed: !!(heroShot.fallbackUsed || fullShot.fallbackUsed) };

  // Dynamic hero sampling: preserve what a first-time patient can actually see at multiple moments.
  if (firstVisit.heroMetrics.mediaType === 'video') {
    await page.waitForTimeout(1600);
    const frame2 = path.join(outDir, `${name}-hero-video-2s.png`);
    await resilientScreenshot(page, frame2, { fullPage: false, timeoutMs: options.screenshotTimeoutMs || 12000 });
    await page.waitForTimeout(2800);
    const frame5 = path.join(outDir, `${name}-hero-video-5s.png`);
    await resilientScreenshot(page, frame5, { fullPage: false, timeoutMs: options.screenshotTimeoutMs || 12000 });
    screenshots.videoFrame2s = frame2; screenshots.videoFrame5s = frame5;
  }

  // Keep the first-visit measurement immutable. Post-consent is captured in a separate fresh context.
  let consentDismissal = { dismissed: false, actionText: '' };
  let clean = null;
  if (firstVisit.overlayMetrics.cookieConsentDetected && options.capturePostConsent !== false) {
    const cleanContext = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor || 1,
      isMobile: !!viewport.isMobile, hasTouch: !!viewport.hasTouch, userAgent: options.userAgent || undefined, ignoreHTTPSErrors: true
    });
    const cleanPage = await cleanContext.newPage();
    try {
      await resilientGoto(cleanPage, targetUrl, { timeoutMs: options.timeoutMs || 30000, fallbackTimeoutMs: options.navigationFallbackTimeoutMs || 60000, slowThresholdMs: options.slowLoadThresholdMs || 8000 });
      await settlePage(cleanPage, options.timeoutMs || 15000);
      await cleanPage.waitForTimeout(options.firstVisitOverlayWaitMs == null ? 900 : options.firstVisitOverlayWaitMs);
      consentDismissal = await dismissCookieConsent(cleanPage);
      if (consentDismissal.dismissed) {
        await cleanPage.waitForTimeout(250);
        const cleanHero = path.join(outDir, `${name}-hero-post-consent.png`);
        await resilientScreenshot(cleanPage, cleanHero, { fullPage: false, timeoutMs: options.screenshotTimeoutMs || 12000 });
        screenshots.postConsentHero = cleanHero;
        clean = await collectAll(cleanPage);
      }
    } finally { await cleanContext.close(); }
  }

  const result = {
    viewport: name, requestedUrl: targetUrl, finalUrl: page.url(), httpStatus: response?.status() || null, ok: response?.ok() ?? null,
    screenshots,
    screenshotEvidence,
    pageMetrics: firstVisit.pageMetrics,
    ctaMetrics: firstVisit.ctaMetrics,
    imageMetrics: firstVisit.imageMetrics,
    funnelMetrics: firstVisit.funnelMetrics,
    heroMetrics: firstVisit.heroMetrics,
    overlayMetrics: firstVisit.overlayMetrics,
    consentDismissal,
    postConsentMetrics: clean,
    channelMetrics: firstVisit.channelMetrics,
    ctaCompetition: firstVisit.ctaCompetition,
    trustMetrics: firstVisit.trustMetrics,
    browserDiagnostics: { navigationAttempts, navigationDurationMs: navigation.durationMs, slowLoad: navigation.slowLoad, navigationFallbackUsed: navigation.fallbackUsed, consoleErrors: consoleErrors.slice(0,30), failedRequests: failedRequests.slice(0,50) }
  };
  await context.close();
  return result;
}


function filterCredentialPhones(phoneNumbers=[], registrationIdentifierCandidates=[]) {
  const credentialDigits=(registrationIdentifierCandidates||[]).map(x=>String(x?.identifier||'').replace(/\D/g,'')).filter(Boolean);
  return [...new Set(phoneNumbers||[])].filter(raw=>{
    const d=String(raw||'').replace(/\D/g,'');
    if(!d) return false;
    // A displayed phone candidate must never be a full or partial slice of a
    // nearby licence / registration identifier. Thai clinic licence numbers
    // commonly begin with 20... and can otherwise masquerade as a 10-digit phone
    // if a parser drops the leading digit.
    if(credentialDigits.some(id=>id.includes(d)||d.includes(id))) return false;
    return true;
  });
}

function summarize(desktop, mobile) {
  const dF = desktop.funnelMetrics, mF = mobile.funnelMetrics;
  const dC = desktop.ctaMetrics, mC = mobile.ctaMetrics;
  const dO = desktop.overlayMetrics || {}, mO = mobile.overlayMetrics || {};
  const dH = desktop.heroMetrics || {}, mH = mobile.heroMetrics || {};
  const registrationIdentifierCandidates = [
    ...(desktop.pageMetrics?.trustEvidence?.registrationIdentifierCandidates || []),
    ...(mobile.pageMetrics?.trustEvidence?.registrationIdentifierCandidates || [])
  ].filter((item,index,arr)=>arr.findIndex(x=>x.identifier===item.identifier)===index).slice(0,12);
  const phoneDisplayedNumbers=filterCredentialPhones([...(desktop.pageMetrics?.contact?.displayedPhoneNumbers||[]), ...(mobile.pageMetrics?.contact?.displayedPhoneNumbers||[])], registrationIdentifierCandidates);
  return {
    phoneVisible: dF.phoneLinks.length > 0 || mF.phoneLinks.length > 0 || !!desktop.pageMetrics?.contact?.phoneDisplayed || !!mobile.pageMetrics?.contact?.phoneDisplayed,
    phoneActionable: dF.phoneLinks.length > 0 || mF.phoneLinks.length > 0,
    phoneDisplayedNumbers,
    contactPageVisible: !!(dF.contactPageVisible || mF.contactPageVisible || (dF.contactLinks?.length||0) || (mF.contactLinks?.length||0)),
    bookingCtaVisible: [dC.primaryCta, mC.primaryCta].some(c => c && ['booking','consultation'].includes(c.intent)) || dF.onlineBookingVisible || mF.onlineBookingVisible,
    bookingCtaAboveFoldDesktop: !!(dC.primaryCta?.aboveFold && ['booking','consultation'].includes(dC.primaryCta?.intent)),
    bookingCtaAboveFoldMobile: !!(mC.primaryCta?.aboveFold && ['booking','consultation'].includes(mC.primaryCta?.intent)),
    messengerWhatsappVisible: dF.whatsappLinks.length > 0 || dF.messengerLinks.length > 0 || mF.whatsappLinks.length > 0 || mF.messengerLinks.length > 0,
    whatsappVisible: (desktop.channelMetrics?.whatsappLinks?.length || 0) > 0 || (mobile.channelMetrics?.whatsappLinks?.length || 0) > 0,
    whatsappPatientContactVisible: (desktop.channelMetrics?.whatsappDirectLinks?.length || 0) > 0 || (mobile.channelMetrics?.whatsappDirectLinks?.length || 0) > 0,
    messengerVisible: dF.messengerLinks.length > 0 || mF.messengerLinks.length > 0,
    lineVisible: (dF.lineLinks?.length || 0) > 0 || (mF.lineLinks?.length || 0) > 0 || !!desktop.channelMetrics?.patientContact?.line || !!mobile.channelMetrics?.patientContact?.line,
    viberVisible: (desktop.channelMetrics?.viberLinks?.length || 0) > 0 || (mobile.channelMetrics?.viberLinks?.length || 0) > 0,
    socialPresence: {
      facebook: !!(desktop.channelMetrics?.socialPresence?.facebook || mobile.channelMetrics?.socialPresence?.facebook),
      instagram: !!(desktop.channelMetrics?.socialPresence?.instagram || mobile.channelMetrics?.socialPresence?.instagram),
      youtube: !!(desktop.channelMetrics?.socialPresence?.youtube || mobile.channelMetrics?.socialPresence?.youtube),
      tiktok: !!(desktop.channelMetrics?.socialPresence?.tiktok || mobile.channelMetrics?.socialPresence?.tiktok),
      line: !!(desktop.channelMetrics?.socialPresence?.line || mobile.channelMetrics?.socialPresence?.line),
      whatsapp: !!(desktop.channelMetrics?.socialPresence?.whatsapp || mobile.channelMetrics?.socialPresence?.whatsapp),
      viber: !!(desktop.channelMetrics?.socialPresence?.viber || mobile.channelMetrics?.socialPresence?.viber)
    },
    onlineBookingVisible: dF.onlineBookingVisible || mF.onlineBookingVisible,
    nativeBookingVisible: (dF.nativeBookingLinks?.length || 0) > 0 || (mF.nativeBookingLinks?.length || 0) > 0,
    externalBookingProviderVisible: (dF.externalBookingLinks?.length || 0) > 0 || (mF.externalBookingLinks?.length || 0) > 0,
    channelHandoff: {
      socialHandoffVisible: !!(dF.socialHandoffVisible || mF.socialHandoffVisible || dC.primaryCta?.intent === 'social-handoff' || mC.primaryCta?.intent === 'social-handoff'),
      facebook: [dC.primaryCta,mC.primaryCta,...(dC.candidates||[]),...(mC.candidates||[])].some(c => c?.intent === 'social-handoff' && /facebook\.com|fb\.com/i.test(c.href||'')),
      desktopPrimaryIntent: dC.primaryCta?.intent || null,
      mobilePrimaryIntent: mC.primaryCta?.intent || null
    },
    googleMapsVisible: dF.mapsLinks.length > 0 || mF.mapsLinks.length > 0 || dF.mapEmbedVisible || mF.mapEmbedVisible || !!desktop.channelMetrics?.locationNavigation?.locationIntent || !!mobile.channelMetrics?.locationNavigation?.locationIntent,
    reviewsVisible: dF.reviewsVisible || mF.reviewsVisible,
    doctorProfileVisible: dF.doctorProfileVisible || mF.doctorProfileVisible,
    clinicianMentionVisible: dF.clinicianMentionVisible || mF.clinicianMentionVisible,
    beforeAfterVisible: dF.beforeAfterVisible || mF.beforeAfterVisible,
    pricingVisible: dF.pricingVisible || mF.pricingVisible,
    patientCountTrustVisible: dF.patientCountTrustVisible || mF.patientCountTrustVisible,
    accreditationTrustVisible: dF.accreditationTrustVisible || mF.accreditationTrustVisible,
    trustSignalsVisible: dF.reviewsVisible || dF.doctorProfileVisible || dF.beforeAfterVisible || dF.patientCountTrustVisible || dF.accreditationTrustVisible || mF.reviewsVisible || mF.doctorProfileVisible || mF.beforeAfterVisible || mF.patientCountTrustVisible || mF.accreditationTrustVisible,
    horizontalOverflowDesktopPx: desktop.pageMetrics.document.horizontalOverflowPx,
    horizontalOverflowMobilePx: mobile.pageMetrics.document.horizontalOverflowPx,
    formFieldCount: Math.max(dF.totalFormFields, mF.totalFormFields),
    primaryDesktopCta: dC.primaryCta,
    primaryMobileCta: mC.primaryCta,
    heroMediaType: dH.mediaType === 'video' || mH.mediaType === 'video' ? 'video' : (dH.mediaType !== 'none' ? dH.mediaType : mH.mediaType),
    firstVisitCookieConsentDetected: !!(dO.cookieConsentDetected || mO.cookieConsentDetected),
    firstVisitCookieCoverageDesktopPercent: dO.cookieConsentViewportCoveragePercent || 0,
    firstVisitCookieCoverageMobilePercent: mO.cookieConsentViewportCoveragePercent || 0,
    postConsentCaptureAvailable: !!(desktop.screenshots?.postConsentHero || mobile.screenshots?.postConsentHero),
    desktopAttentionFragmentation: desktop.ctaCompetition?.attentionFragmentationScore || 0,
    mobileAttentionFragmentation: mobile.ctaCompetition?.attentionFragmentationScore || 0,
    mobileHeroCrowding: mobile.heroMetrics?.crowdingScore || 0,
    mobileHeroClarity: scoreHeroClarity(mobile.heroMetrics || {}, mobile.ctaMetrics?.primaryCta || {}, mobile.overlayMetrics || {}, mobile.ctaCompetition || {}, mobile.pageMetrics || {}).overall,
    obsoleteFlashDetected: !!(desktop.pageMetrics?.legacy?.obsoleteFlashDetected || mobile.pageMetrics?.legacy?.obsoleteFlashDetected),
    staleFooterYearSignal: !!(desktop.pageMetrics?.legacy?.staleFooterYearSignal || mobile.pageMetrics?.legacy?.staleFooterYearSignal),
    latestFooterYear: desktop.pageMetrics?.legacy?.latestFooterYear || mobile.pageMetrics?.legacy?.latestFooterYear || null,
    registrationIdentifierCandidates,
    mobileViewportMetaPresent: mobile.pageMetrics?.responsiveness?.viewportMetaPresent ?? null,
    // Precise typography diagnostics. "100%" here means sampled leaf-text elements below 12px,
    // not 100% of every rendered character on the page.
    mobileTinyTextPercent: mobile.pageMetrics?.responsiveness?.tinyTextPercent || 0,
    mobileTinyTextElementPercent: mobile.pageMetrics?.responsiveness?.tinyTextElementPercent || 0,
    mobileTinyTextCharacterPercent: mobile.pageMetrics?.responsiveness?.tinyTextCharacterPercent || 0,
    mobileSmallTextCharacterPercent: mobile.pageMetrics?.responsiveness?.smallTextCharacterPercent || 0,
    mobileAboveFoldTinyTextCharacterPercent: mobile.pageMetrics?.responsiveness?.aboveFoldTinyTextCharacterPercent || 0,
    mobileMedianFontSizePx: mobile.pageMetrics?.responsiveness?.medianFontSizePx ?? null
  };
}



function applyCanonicalFacebookResponse(probe, assessment) {
  if (!probe || !assessment?.responseMetrics) return probe;
  const m=assessment.responseMetrics;
  probe.response={
    ...(probe.response||{}),
    clinicRepliesObserved:m.answeredIntentCount ?? probe.response?.clinicRepliesObserved ?? null,
    answeredIntentCount:m.answeredIntentCount ?? null,
    unansweredIntentCount:m.unansweredIntentCount ?? null,
    responseCoveragePercent:m.responseCoveragePercent ?? null,
    scoringPopulation:m.scoringPopulation ?? 'high-intent',
    scoringObservedIntentComments:m.scoringObservedIntentComments ?? null,
    scoringAnsweredIntentCount:m.scoringAnsweredIntentCount ?? null,
    scoringUnansweredIntentCount:m.scoringUnansweredIntentCount ?? null,
    scoringResponseCoveragePercent:m.scoringResponseCoveragePercent ?? null,
    generalInterestObservedCount:m.generalInterestObservedCount ?? null,
    generalInterestAnsweredCount:m.generalInterestAnsweredCount ?? null,
    generalInterestUnansweredCount:m.generalInterestUnansweredCount ?? null,
    generalInterestResponseCoveragePercent:m.generalInterestResponseCoveragePercent ?? null,
    medianResponseMinutes:m.medianResponseMinutes ?? null,
    p75ResponseMinutes:m.p75ResponseMinutes ?? null,
    answeredWithin5MinPercent:m.answeredWithin5MinPercent ?? null,
    answeredWithin60MinPercent:m.answeredWithin60MinPercent ?? null,
    unansweredAfter24hPercent:m.unansweredAfter24hPercent ?? null
  };
  return probe;
}

async function runFacebookOnlyAudit(options = {}) {
  const facebookTargetUrl = options.facebookPageUrl;
  if (!facebookTargetUrl) throw new Error('--facebook-only requires --facebook-page-url https://www.facebook.com/Page');
  const progress = typeof options.onProgress === 'function' ? options.onProgress : (()=>{});
  const root = options.outputRoot || path.resolve(process.cwd(), 'audit-output');
  const outDir = ensureDir(options.outputDir || path.join(root, slugFromUrl(facebookTargetUrl)));
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: options.headless !== false });
  try {
    const clinicIdentity = { clinicName: options.clinicName || null, location: options.clinicLocation || null };
    const channelPlan = {
      architecture: 'facebook-only',
      coreWebsiteScanUnchanged: true,
      modules: [{ id:'facebook-page', detected:true, priority:'high', reason:'Facebook is the requested primary digital surface.', urls:[facebookTargetUrl], execution:'facebook-only-module', affectsCoreWebsiteRuntime:false }],
      recommendedNextModules:['facebook-page'],
      note:'Website crawling is intentionally skipped in --facebook-only mode.'
    };
    const template = buildFacebookTemplate({ identity: clinicIdentity, channelPlan, reviewedUrl: facebookTargetUrl });
    const suppliedEvidence = loadFacebookEvidence(options.facebookEvidencePath || process.env.EDEN_FACEBOOK_EVIDENCE || null);
    const baseEvidence = suppliedEvidence || template;
    progress('Running Facebook-only authenticated patient-journey probe…');
    const facebookProbe = await probeFacebookPage(browser, facebookTargetUrl, {
      outputDir: outDir,
      clinicName: clinicIdentity.clinicName,
      websiteUrl: null,
      websitePhoneNumbers: [],
      timeoutMs: options.facebookTimeoutMs || 20000,
      authRequested: !!options.facebookAuth,
      storageStatePath: options.facebookSessionPath || process.env.EDEN_FACEBOOK_SESSION || path.resolve(process.cwd(), '.eden-facebook-session.json'),
      commentPostLimit: options.commentPostLimit || 5,
      facebookDeepSample:true,
      feedCardCandidateCap: options.feedCardCandidateCap || 10,
      targetReliableEngagementSamples: options.targetReliableEngagementSamples || 5,
      contentScrollSteps: options.contentScrollSteps || 5
    });
    const effectiveEvidence = mergeFacebookEvidence(baseEvidence, facebookProbe);
    const assessment = scoreFacebook(effectiveEvidence);
    applyCanonicalFacebookResponse(facebookProbe,assessment);
    effectiveEvidence.response={...(effectiveEvidence.response||{}),...(facebookProbe.response||{})};
    const manifest = {
      version:'2.2.28',
      mode:'facebook-only',
      createdAt:new Date().toISOString(),
      outputDir:outDir,
      clinicIdentity,
      channelModulePlan:channelPlan,
      facebookTemplate:template,
      facebookProbe,
      facebook:{ supplied:!!suppliedEvidence, probed:true, assessment },
      crossChannelIntegrity:buildCrossChannelIntegrity({ facebookAssessment:assessment, facebookEvidence:effectiveEvidence, googleBusinessAssessment:null }),
      policy:'Facebook-only mode skips website and Google Business scoring. Unknown Facebook evidence remains unknown rather than being inferred as zero.'
    };
    writeJson(path.join(outDir,'snapshot.json'),manifest);
    writeJson(path.join(outDir,'channel-module-plan.json'),channelPlan);
    writeFacebookFiles(outDir,template,effectiveEvidence,assessment);
    writeJson(path.join(outDir,'facebook-probe.json'),facebookProbe);
    writeJson(path.join(outDir,'cross-channel-integrity.json'),manifest.crossChannelIntegrity);
    progress('Building client-facing Audit Report…');
    manifest.report = writeReportFiles(outDir, manifest, { humanReviewPath: options.humanReviewPath || process.env.EDEN_HUMAN_REVIEW || null });
    writeJson(path.join(outDir,'snapshot.json'),manifest);
    progress('Facebook-only evidence package complete.');
    return manifest;
  } finally { await browser.close(); }
}

async function runSnapshotAudit(inputUrl, options = {}) {
  const targetUrl = normalizeUrl(inputUrl);
  const digitalFrontDoor = classifyDigitalFrontDoor(targetUrl);
  const progress = typeof options.onProgress === 'function' ? options.onProgress : (()=>{});
  const root = options.outputRoot || path.resolve(process.cwd(), 'audit-output');
  const outDir = ensureDir(options.outputDir || path.join(root, slugFromUrl(targetUrl)));
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: options.headless !== false });
  try {
    progress('Capturing desktop first-visit evidence…');
    const desktop = await captureViewport(browser, targetUrl, 'desktop', VIEWPORTS.desktop, outDir, options);
    progress('Desktop capture complete. Capturing mobile first-visit evidence…');
    const mobile = await captureViewport(browser, targetUrl, 'mobile', VIEWPORTS.mobile, outDir, options);
    progress('Mobile capture complete. Building summary…');
    const summary = summarize(desktop, mobile);
    const manifest = { version: '2.2.28', createdAt: new Date().toISOString(), reviewedUrl: targetUrl, finalUrl: desktop.finalUrl || mobile.finalUrl, outputDir: outDir, digitalFrontDoor, summary, desktop, mobile };
    manifest.websiteAssessment = digitalFrontDoor.conventionalWebsite ? {status:'applicable',frontDoorType:digitalFrontDoor.type} : {status:'not-applicable',frontDoorType:digitalFrontDoor.type,reason:`Website scoring is not published because the clinic's primary digital front door is ${digitalFrontDoor.label}.`};
    if (digitalFrontDoor.conventionalWebsite && options.multiPageAudit !== false) {
      progress('Discovering and ranking internal patient pages…');
      manifest.siteDiscovery = await discoverSite(browser, targetUrl, options).catch(error => ({ error:String(error.message || error), discoveredCount:0, selectedDeepPages:[] }));
      if (manifest.siteDiscovery?.selectedDeepPages?.length) {
        progress(`Deep-inspecting ${manifest.siteDiscovery.selectedDeepPages.length} high-value pages…`);
        manifest.pageJourney = await inspectSelectedPages(browser, manifest.siteDiscovery, outDir, options).catch(error => ({ error:String(error.message || error), selectedCount:0, pages:[] }));
      }
      if (manifest.siteDiscovery) {
        const discovered = Number(manifest.siteDiscovery.discoveredCount || 0);
        const rankedCount = Array.isArray(manifest.siteDiscovery.ranked) ? manifest.siteDiscovery.ranked.length : 0;
        const deepCount = Number(manifest.pageJourney?.selectedCount || 0);
        const effective = Math.max(discovered, rankedCount, deepCount);
        if (effective > discovered) {
          manifest.siteDiscovery.rawDiscoveredCount = discovered;
          manifest.siteDiscovery.discoveredCount = effective;
          manifest.siteDiscovery.discoveryStatus = discovered === 0 ? 'partial-recovered' : 'reconciled';
          manifest.siteDiscovery.reconciliationNote = 'Discovery count was reconciled against ranked/deep-inspected URLs after partial navigation failures.';
        } else {
          manifest.siteDiscovery.discoveryStatus = manifest.siteDiscovery.error ? 'partial' : 'complete';
        }
      }
    }
    progress('Inspecting appointment/booking journey safely…');
    const bookingFlow = !digitalFrontDoor.conventionalWebsite ? { analyzed:false, reason:`Not applicable to ${digitalFrontDoor.label}; conversion is assessed through the primary channel module.` } : options.analyzeBookingFlow === false ? { analyzed:false, reason:'Disabled by option.' } : await analyzeBookingFlow(browser, manifest, options).catch(error => ({ analyzed:false, error:String(error.message || error) }));
    manifest.bookingFlow = bookingFlow;
    const deepNavigations = (manifest.pageJourney?.pages || []).flatMap(p => [p?.desktop?.navigation, p?.mobile?.navigation]).filter(Boolean);
    const navigationDurations = [desktop?.browserDiagnostics?.navigationDurationMs, mobile?.browserDiagnostics?.navigationDurationMs, ...deepNavigations.map(n=>n.durationMs)].filter(Number.isFinite);
    manifest.performanceEvidence = {
      homepageDesktopNavigationMs: desktop?.browserDiagnostics?.navigationDurationMs ?? null,
      homepageMobileNavigationMs: mobile?.browserDiagnostics?.navigationDurationMs ?? null,
      slowHomepageLoadDetected: !!(desktop?.browserDiagnostics?.slowLoad || mobile?.browserDiagnostics?.slowLoad),
      navigationFallbackUsed: !!(desktop?.browserDiagnostics?.navigationFallbackUsed || mobile?.browserDiagnostics?.navigationFallbackUsed || deepNavigations.some(n=>n.fallbackUsed)),
      deepPageConcurrencyUsed: manifest.pageJourney?.concurrencyUsed || 1,
      measuredNavigationCount: navigationDurations.length,
      slowNavigationCount: [desktop?.browserDiagnostics, mobile?.browserDiagnostics, ...deepNavigations].filter(n=>n?.slowLoad).length,
      maxNavigationMs: navigationDurations.length ? Math.max(...navigationDurations) : null,
      note: 'Navigation timings measure browser navigation readiness, not full Core Web Vitals. Slow/retried loads are preserved as audit evidence rather than crashing the scan.'
    };
    progress('Scoring evidence and generating findings…');
    const scoring = scoreSnapshot({ desktop, mobile, bookingFlow });
    manifest.scoring = scoring;
    if (bookingFlow?.analyzed) {
      bookingFlow.experienceSemantics = {
        preSubmissionScore: bookingFlow.bookingEntryScore ?? bookingFlow.scorecard?.overall ?? bookingFlow.overall ?? scoring?.categories?.bookingJourney ?? null,
        preSubmissionLabel: bookingFlow.bookingCompletionVerified===false ? 'Booking Entry Experience' : 'Booking Request Experience',
        submissionCompleted: false,
        postSubmissionConfirmationVerified: false,
        actualResponseTimeMinutes: null,
        endToEndBookingScore: null,
        note: bookingFlow.bookingCompletionVerified===false ? 'The booking entry point is clearly accessible, but the scanner did not observe enough booking mechanics to publish an end-to-end booking score. Response and booking completion require instrumentation or an explicitly approved mystery-booking test.' : 'Automated audit safely evaluates the journey through the point of submission. Post-submit acknowledgement, human response and appointment confirmation remain unverified unless an explicitly approved mystery-booking test is run.'
      };
    }
    manifest.channelModulePlan = buildChannelModulePlan({ desktop, mobile, summary, digitalFrontDoor });
    manifest.clinicIdentity = inferClinicIdentity({ desktop, mobile, options });
    progress('Packaging visual evidence and reconciling optional visual review…');
    manifest.visualEvidence = buildVisualEvidencePackage(manifest);
    const visualReview = loadVisualReview(options.visualReviewPath || process.env.EDEN_VISUAL_REVIEW || null);
    manifest.visualReview = visualReview ? { supplied: true, reviewer: visualReview.reviewer || null } : { supplied: false };
    manifest.visualReconciliation = reconcileVisualEvidence(scoring, visualReview);
    progress('Preparing Google Business evidence module…');
    manifest.googleBusinessTemplate = buildGoogleBusinessTemplate({ identity:manifest.clinicIdentity, channelPlan:manifest.channelModulePlan, reviewedUrl:targetUrl });
    const gbpEvidence = loadGoogleBusinessEvidence(options.googleBusinessEvidencePath || process.env.EDEN_GBP_EVIDENCE || null);
    let googleBusinessProbe = null;
    let effectiveGoogleBusinessEvidence = gbpEvidence || manifest.googleBusinessTemplate;
    if (!gbpEvidence && options.googleBusinessProbe !== false) {
      progress('Probing public Google Maps / Business profile safely…');
      googleBusinessProbe = await probeGoogleBusiness(browser, manifest.googleBusinessTemplate, { outputDir:outDir, timeoutMs:options.googleBusinessTimeoutMs || 25000 }).catch(error => ({status:'probe-failed',error:String(error.message||error)}));
      effectiveGoogleBusinessEvidence = mergeProbeIntoEvidence(manifest.googleBusinessTemplate, googleBusinessProbe, summary);
    }
    manifest.googleBusinessProbe = googleBusinessProbe;
    manifest.googleBusiness = { supplied:!!gbpEvidence, probed:!!googleBusinessProbe, evidence:effectiveGoogleBusinessEvidence, assessment:scoreGoogleBusiness(effectiveGoogleBusinessEvidence) };
    progress('Preparing Facebook patient-journey evidence module…');
    manifest.facebookTemplate = buildFacebookTemplate({ identity:manifest.clinicIdentity, channelPlan:manifest.channelModulePlan, reviewedUrl:options.facebookPageUrl || null });
    const facebookEvidence = loadFacebookEvidence(options.facebookEvidencePath || process.env.EDEN_FACEBOOK_EVIDENCE || null);
    const facebookBaseEvidence = facebookEvidence || manifest.facebookTemplate;
    const facebookPrimary=digitalFrontDoor.type==='facebook-primary';
    const facebookProbeOptions = { outputDir:outDir, clinicName:manifest.clinicIdentity?.clinicName, websiteUrl:targetUrl, websitePhoneNumbers:summary.phoneDisplayedNumbers || [], timeoutMs:options.facebookTimeoutMs || 20000, authRequested:!!options.facebookAuth, storageStatePath:options.facebookSessionPath || process.env.EDEN_FACEBOOK_SESSION || path.resolve(process.cwd(), '.eden-facebook-session.json'), facebookDeepSample:facebookPrimary, feedCardCandidateCap:facebookPrimary?10:5, targetReliableEngagementSamples:facebookPrimary?5:3, commentPostLimit:facebookPrimary?5:5, contentScrollSteps:facebookPrimary?5:4, facebookEvidenceAcquisitionAttempts:facebookPrimary?2:1 };
    const discoveredFacebookCandidates = normalizeFacebookCandidates([digitalFrontDoor.type==='facebook-primary'?targetUrl:null, facebookBaseEvidence.reviewedUrl, facebookBaseEvidence.sourceLinks?.expectedFacebookUrl, ...(facebookBaseEvidence.sourceLinks?.websiteFacebookUrls||[])]).slice(0,3);
    let facebookTargetUrl = canonicalFacebookPageUrl(options.facebookPageUrl) || (digitalFrontDoor.type==='facebook-primary' ? canonicalFacebookPageUrl(targetUrl) : null);
    let facebookCandidateResolution = null;
    if (!facebookTargetUrl && discoveredFacebookCandidates.length > 1 && options.facebookProbe !== false) {
      progress(`Resolving ${discoveredFacebookCandidates.length} Facebook page candidates…`);
      const candidateResults=[];
      for (const candidateUrl of discoveredFacebookCandidates) candidateResults.push(await probeFacebookCandidate(browser,candidateUrl,facebookProbeOptions));
      const ranked=rankFacebookCandidates(candidateResults);
      const winner=ranked[0]||null;
      facebookTargetUrl = winner?.score >= 35 ? winner.targetUrl : null;
      facebookCandidateResolution={schemaVersion:'2.2.28',status:facebookTargetUrl?'selected':'unresolved',strategy:'multi-candidate-identity-accessibility-ranking',candidates:ranked,selectedUrl:facebookTargetUrl,selectionReason:winner?`Highest candidate score ${winner.score}/100 (${winner.identityConfidence} identity confidence; ${winner.displayState||'unknown state'}).`:null,rejectedCandidates:ranked.slice(1).map(x=>({url:x.targetUrl,score:x.score,displayState:x.displayState,reason:x.displayState==='unavailable-content'?'unavailable-content':`lower canonical score than selected candidate`}))};
    } else {
      facebookTargetUrl = facebookTargetUrl || discoveredFacebookCandidates[0] || null;
      facebookCandidateResolution={schemaVersion:'2.2.28',status:facebookTargetUrl?'selected':'not-found',strategy:options.facebookPageUrl?'explicit-url':digitalFrontDoor.type==='facebook-primary'?'primary-front-door':'single-candidate',candidates:facebookTargetUrl?[{targetUrl:facebookTargetUrl,selected:true}]:[],selectedUrl:facebookTargetUrl,selectionReason:options.facebookPageUrl?'Explicit Facebook URL supplied.':digitalFrontDoor.type==='facebook-primary'?'Canonical Facebook front door supplied as audit input.':facebookTargetUrl?'Only one Facebook candidate discovered.':null,rejectedCandidates:[]};
    }
    manifest.facebookCandidateResolution = facebookCandidateResolution;
    let facebookProbe = null;
    let effectiveFacebookEvidence = facebookBaseEvidence;
    if (facebookTargetUrl && options.facebookProbe !== false) {
      progress('Probing selected Facebook destination and patient actions safely…');
      facebookProbe = await probeFacebookPage(browser, facebookTargetUrl, facebookProbeOptions).catch(error => ({status:'probe-failed',targetUrl:facebookTargetUrl,error:String(error.message||error)}));
      effectiveFacebookEvidence = mergeFacebookEvidence(facebookBaseEvidence, facebookProbe);
    }
    const facebookAssessment = scoreFacebook(effectiveFacebookEvidence);
    applyCanonicalFacebookResponse(facebookProbe,facebookAssessment);
    if (facebookProbe?.response) effectiveFacebookEvidence.response={...(effectiveFacebookEvidence.response||{}),...facebookProbe.response};
    manifest.facebookProbe = facebookProbe;
    manifest.facebook = { supplied:!!facebookEvidence, probed:!!facebookProbe, assessment:facebookAssessment };
    manifest.crossChannelIntegrity = buildCrossChannelIntegrity({ facebookAssessment:manifest.facebook.assessment, facebookEvidence:effectiveFacebookEvidence, googleBusinessAssessment:manifest.googleBusiness.assessment });
    manifest.unifiedEvidenceSummary = buildUnifiedEvidenceSummary({ scoring, visualReconciliation:manifest.visualReconciliation, googleBusinessAssessment:manifest.googleBusiness.assessment, facebookAssessment:manifest.facebook.assessment, channelPlan:manifest.channelModulePlan });
    manifest.findings = generateFindings(manifest);
    const auditFindings = toLegacyWebsiteFindings(manifest);
    writeJson(path.join(outDir, 'snapshot.json'), manifest);
    writeJson(path.join(outDir, 'page-metrics.json'), { desktop: desktop.pageMetrics, mobile: mobile.pageMetrics });
    writeJson(path.join(outDir, 'cta-metrics.json'), { desktop: desktop.ctaMetrics, mobile: mobile.ctaMetrics });
    writeJson(path.join(outDir, 'image-metrics.json'), { desktop: desktop.imageMetrics, mobile: mobile.imageMetrics });
    writeJson(path.join(outDir, 'funnel-metrics.json'), { desktop: desktop.funnelMetrics, mobile: mobile.funnelMetrics });
    writeJson(path.join(outDir, 'hero-metrics.json'), { desktop: desktop.heroMetrics, mobile: mobile.heroMetrics });
    writeJson(path.join(outDir, 'overlay-metrics.json'), { desktop: desktop.overlayMetrics, mobile: mobile.overlayMetrics });
    writeJson(path.join(outDir, 'conversion-score.json'), scoring);
    writeJson(path.join(outDir, 'channel-metrics.json'), { desktop: desktop.channelMetrics, mobile: mobile.channelMetrics });
    writeJson(path.join(outDir, 'cta-competition.json'), { desktop: desktop.ctaCompetition, mobile: mobile.ctaCompetition });
    writeJson(path.join(outDir, 'trust-metrics.json'), { desktop: desktop.trustMetrics, mobile: mobile.trustMetrics });
    writeJson(path.join(outDir, 'booking-flow.json'), bookingFlow);
    writeJson(path.join(outDir, 'performance-evidence.json'), manifest.performanceEvidence || {});
    writeJson(path.join(outDir, 'automated-findings.json'), manifest.findings);
    writeJson(path.join(outDir, 'audit-findings.json'), auditFindings);
    if (manifest.siteDiscovery) writeJson(path.join(outDir, 'site-discovery.json'), manifest.siteDiscovery);
    if (manifest.pageJourney) writeJson(path.join(outDir, 'page-journey.json'), manifest.pageJourney);
    writeJson(path.join(outDir, 'explainable-scorecard.json'), manifest.scoring.explainability || {});
    writeJson(path.join(outDir, 'channel-module-plan.json'), manifest.channelModulePlan || {});
    writeVisualEvidenceFiles(outDir, manifest.visualEvidence, buildVisualReviewTemplate(manifest.visualEvidence), manifest.visualReconciliation);
    writeGoogleBusinessFiles(outDir, manifest.googleBusinessTemplate, effectiveGoogleBusinessEvidence, manifest.googleBusiness.assessment, manifest.unifiedEvidenceSummary);
    if (googleBusinessProbe) writeJson(path.join(outDir, 'google-business-probe.json'), googleBusinessProbe);
    writeFacebookFiles(outDir, manifest.facebookTemplate, effectiveFacebookEvidence, manifest.facebook.assessment);
    if (facebookProbe) writeJson(path.join(outDir, 'facebook-probe.json'), facebookProbe);
    writeJson(path.join(outDir, 'facebook-candidate-resolution.json'), manifest.facebookCandidateResolution || {});
    writeJson(path.join(outDir, 'cross-channel-integrity.json'), manifest.crossChannelIntegrity || {});
    progress('Running API validation + narrative layer…');
    const draftReportModel = buildReportModel(manifest, {});
    manifest.aiAuditIntelligence = await runAuditIntelligence(manifest, draftReportModel, { enabled: options.aiEnabled !== false, force: !!options.aiForce, model: options.openaiModel || process.env.EDEN_OPENAI_MODEL || null });
    progress('Running dedicated Facebook visual extraction bridge…');
    manifest.facebookVisualExtraction = await runFacebookVisualExtraction(manifest, { model: options.openaiModel || process.env.EDEN_OPENAI_MODEL || null });
    if (manifest.facebookVisualExtraction?.status === 'completed' && manifest.facebookVisualExtraction?.evidence) {
      // Dedicated targeted extraction is authoritative for Facebook visual null-gap filling.
      // Preserve broad AI assessments/conflicts, but replace only its surface-evidence payload.
      manifest.aiAuditIntelligence = { ...manifest.aiAuditIntelligence, facebookSurfaceEvidence: manifest.facebookVisualExtraction.evidence };
    }
    const fbVisualMerge = applyFacebookVisualSurfaceEvidence(effectiveFacebookEvidence, manifest.aiAuditIntelligence);
    if (fbVisualMerge.applied) {
      effectiveFacebookEvidence = fbVisualMerge.evidence;
      manifest.facebookVisualReconciliation = { status:'applied', fieldsApplied:fbVisualMerge.fieldsApplied, observationMode:manifest.aiAuditIntelligence.facebookSurfaceEvidence?.observationMode || null, confidence:manifest.aiAuditIntelligence.facebookSurfaceEvidence?.confidence || null };
      const rescoredFacebook = scoreFacebook(effectiveFacebookEvidence);
      applyCanonicalFacebookResponse(facebookProbe,rescoredFacebook);
      manifest.facebook.assessment = rescoredFacebook;
      manifest.crossChannelIntegrity = buildCrossChannelIntegrity({ facebookAssessment:manifest.facebook.assessment, facebookEvidence:effectiveFacebookEvidence, googleBusinessAssessment:manifest.googleBusiness.assessment });
      manifest.unifiedEvidenceSummary = buildUnifiedEvidenceSummary({ scoring, visualReconciliation:manifest.visualReconciliation, googleBusinessAssessment:manifest.googleBusiness.assessment, facebookAssessment:manifest.facebook.assessment, channelPlan:manifest.channelModulePlan });
      writeFacebookFiles(outDir, manifest.facebookTemplate, effectiveFacebookEvidence, manifest.facebook.assessment);
    } else {
      manifest.facebookVisualReconciliation = { status: manifest.facebookVisualExtraction?.status === 'completed' ? 'no-null-gaps-filled' : 'not-run', fieldsApplied:[], observationMode:manifest.facebookVisualExtraction?.evidence?.observationMode || null, confidence:manifest.facebookVisualExtraction?.evidence?.confidence || null };
    }
    manifest.facebookVisualBridge = {
      requested: !!manifest.facebookVisualExtraction?.requested,
      screenshotsSent: manifest.facebookVisualExtraction?.screenshotsFound || 0,
      apiStatus: manifest.facebookVisualExtraction?.status || 'not-run',
      displayState: manifest.facebookVisualExtraction?.displayState || manifest.facebookVisualExtraction?.evidence?.displayState || null,
      parsedFields: manifest.facebookVisualExtraction?.parsedFields || [],
      mergeApplied: !!fbVisualMerge.applied,
      fieldsApplied: fbVisualMerge.fieldsApplied || []
    };
    const revenueInputs = options.revenueInputs || loadRevenueInputs(options.revenueInputsPath || null);
    const responseBenchmark = options.responseBenchmark || loadResponseBenchmark(options.responseBenchmarkPath || null);
    manifest.postSubmissionResponseBenchmark = normalizeResponseBenchmark(responseBenchmark);
    manifest.publicationGuardrails = buildPublicationGuardrails(manifest, {});
    manifest.crossChannelGrowth = buildCrossChannelGrowthModel(manifest, { revenueInputs, responseBenchmark });
    writeJson(path.join(outDir, 'publication-guardrails.json'), manifest.publicationGuardrails);
    writeJson(path.join(outDir, 'cross-channel-actions.json'), manifest.crossChannelGrowth.actions);
    writeJson(path.join(outDir, 'revenue-opportunity.json'), manifest.crossChannelGrowth.revenue);
    writeJson(path.join(outDir, 'post-submission-response.json'), manifest.postSubmissionResponseBenchmark || {schemaVersion:'2.2.37',status:'not-measured'});
    writeAuditIntelligence(outDir, manifest.aiAuditIntelligence);
    writeFacebookVisualExtraction(outDir, manifest.facebookVisualExtraction || {schemaVersion:'2.2.19',status:'not-run'});
    writeJson(path.join(outDir, 'facebook-visual-bridge.json'), manifest.facebookVisualBridge || {});
    progress(manifest.aiAuditIntelligence.status === 'completed' ? 'API evidence review complete.' : `API evidence review ${manifest.aiAuditIntelligence.status}: ${manifest.aiAuditIntelligence.reason || manifest.aiAuditIntelligence.error || 'no detail'}`);
    progress('Building client-facing Audit Report…');
    manifest.report = writeReportFiles(outDir, manifest, { humanReviewPath: options.humanReviewPath || process.env.EDEN_HUMAN_REVIEW || null });
    progress('Building owner-facing Audit…');
    manifest.ownerReport = writeOwnerReportFiles(outDir, manifest, { demoUrl: options.demoUrl || process.env.EDEN_DEMO_URL || null, proofUrl: options.proofUrl || process.env.EDEN_PROOF_URL || null, ownerReviewPath: options.ownerReviewPath || process.env.EDEN_OWNER_REVIEW || null, coverImage: options.coverImage || process.env.EDEN_COVER_IMAGE || null, fixImage: options.fixImage || process.env.EDEN_FIX_IMAGE || null });
    writeJson(path.join(outDir, 'snapshot.json'), manifest);
    progress('Audit evidence package complete.');
    return manifest;
  } finally { await browser.close(); }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i=args.indexOf(flag); return i>=0 ? args[i+1] || null : null; };
  const facebookOnly = args.includes('--facebook-only');
  const firstPositional = args.find((v,i) => !v.startsWith('--') && (i===0 || !['--visual-review','--gbp','--google-business','--clinic-name','--clinic-location','--facebook','--facebook-evidence','--facebook-page-url','--facebook-session','--human-review','--openai-model','--revenue-inputs','--response-benchmark','--demo-url','--proof-url','--owner-review','--cover-image','--fix-image'].includes(args[i-1])));
  const inputUrl = facebookOnly ? null : firstPositional;
  const legacyVisualPath = !facebookOnly && args[1] && !args[1].startsWith('--') ? args[1] : null;
  const visualReviewPath = valueAfter('--visual-review') || legacyVisualPath;
  const googleBusinessEvidencePath = valueAfter('--gbp') || valueAfter('--google-business');
  const clinicName = valueAfter('--clinic-name');
  const facebookEvidencePath = valueAfter('--facebook') || valueAfter('--facebook-evidence');
  const facebookPageUrl = valueAfter('--facebook-page-url');
  const facebookAuth = args.includes('--facebook-auth');
  const facebookSessionPath = valueAfter('--facebook-session');
  const clinicLocation = valueAfter('--clinic-location');
  const humanReviewPath = valueAfter('--human-review');
  const openaiModel = valueAfter('--openai-model');
  const revenueInputsPath = valueAfter('--revenue-inputs');
  const responseBenchmarkPath = valueAfter('--response-benchmark');
  const demoUrl = valueAfter('--demo-url');
  const proofUrl = valueAfter('--proof-url');
  const ownerReviewPath = valueAfter('--owner-review');
  const coverImage = valueAfter('--cover-image');
  const fixImage = valueAfter('--fix-image');
  const aiForce = args.includes('--ai');
  const aiEnabled = !args.includes('--no-ai');
  const common = {visualReviewPath,googleBusinessEvidencePath,googleBusinessProbe:true,facebookEvidencePath,facebookPageUrl,facebookAuth,facebookSessionPath,clinicName,clinicLocation,humanReviewPath,openaiModel,revenueInputsPath,responseBenchmarkPath,demoUrl,proofUrl,ownerReviewPath,coverImage,fixImage,aiForce,aiEnabled,onProgress:msg=>console.log(`[audit] ${msg}`)};

  const promise = facebookOnly
    ? runFacebookOnlyAudit(common)
    : (inputUrl ? runSnapshotAudit(inputUrl, common) : Promise.reject(new Error('Usage: node scanners/snapshot.js https://clinicwebsite.com [...] OR node scanners/snapshot.js --facebook-only --clinic-name "Clinic" --clinic-location "City, Country" --facebook-page-url https://facebook.com/Page [--facebook-auth] [--ai|--no-ai] [--openai-model gpt-5.6-terra] [--revenue-inputs revenue-inputs.json] [--response-benchmark response-benchmark.json] [--demo-url https://...] [--proof-url https://...] [--owner-review owner-review.json] [--cover-image cover.jpg] [--fix-image fix.jpg]')));

  promise.then(result => {
    console.log(`Audit snapshot complete: ${result.outputDir}`);
    if (result.mode === 'facebook-only') {
      console.log(JSON.stringify({
        mode:result.mode,
        clinicIdentity:result.clinicIdentity,
        facebook:result.facebook,
        facebookProbe:result.facebookProbe,
        crossChannelIntegrity:result.crossChannelIntegrity,
        policy:result.policy
      }, null, 2));
      return;
    }
    console.log(JSON.stringify({ digitalFrontDoor: result.digitalFrontDoor, websiteAssessment: result.websiteAssessment, ...result.summary, conversionScore: result.digitalFrontDoor?.conventionalWebsite===false ? null : result.scoring.overall, scorePillars: result.digitalFrontDoor?.conventionalWebsite===false ? null : result.scoring.pillars, assessmentProfile: result.digitalFrontDoor?.conventionalWebsite===false ? null : result.scoring.assessmentProfile, channelModulePlan: result.channelModulePlan, visualReconciliation: result.visualReconciliation, googleBusiness: result.googleBusiness, facebook: result.facebook, facebookProbe: result.facebookProbe, facebookVisualExtraction: result.facebookVisualExtraction, facebookVisualBridge: result.facebookVisualBridge, facebookVisualReconciliation: result.facebookVisualReconciliation, crossChannelIntegrity: result.crossChannelIntegrity, unifiedEvidenceSummary: result.unifiedEvidenceSummary, crossChannelGrowth: result.crossChannelGrowth, performanceEvidence: result.performanceEvidence, scoreCategories: result.scoring.categories, mobileUxScorecard: result.scoring.explainability?.mobileUx || null, stalenessEvidence: result.scoring.explainability?.staleness || null, mobileHeroScorecard: result.scoring.explainability?.hero?.mobile || null, bookingScorecard: result.scoring.explainability?.booking || null, discoveredPages: result.siteDiscovery?.discoveredCount || 0, deepInspectedPages: result.pageJourney?.selectedCount || 0, flags: result.scoring.flags }, null, 2));
  }).catch(error => { console.error(`Snapshot failed: ${error.stack || error.message}`); process.exit(1); });
}

module.exports = { runSnapshotAudit, runFacebookOnlyAudit, summarize, filterCredentialPhones, VIEWPORTS };
