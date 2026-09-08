const fs = require('fs');
const path = require('path');
const { writeJson } = require('./utils');

const VISUAL_SCHEMA_VERSION = '1.0';

function rel(outDir, filePath) {
  if (!filePath) return null;
  const r = path.relative(outDir, filePath);
  return r.startsWith('..') ? filePath : r;
}

function screenshotRef(outDir, filePath, role, viewport, pageType = 'homepage') {
  if (!filePath) return null;
  return { role, viewport, pageType, path: rel(outDir, filePath) };
}

function buildVisualEvidencePackage(manifest) {
  const outDir = manifest.outputDir;
  const shots = [];
  const add = item => { if (item?.path) shots.push(item); };

  for (const [viewport, capture] of [['desktop', manifest.desktop], ['mobile', manifest.mobile]]) {
    const s = capture?.screenshots || {};
    add(screenshotRef(outDir, s.hero, 'first-visit-viewport', viewport));
    add(screenshotRef(outDir, s.full, 'full-page', viewport));
    add(screenshotRef(outDir, s.postConsentHero, 'post-consent-viewport', viewport));
    add(screenshotRef(outDir, s.videoFrame2s, 'dynamic-hero-2s', viewport));
    add(screenshotRef(outDir, s.videoFrame5s, 'dynamic-hero-5s', viewport));
  }

  for (const page of manifest.pageJourney?.pages || []) {
    const pageType = page.pageType || page.role || page.category || 'deep-page';
    const url = page.finalUrl || page.url || null;
    const containers = [page.screenshots, page.desktop?.screenshots, page.mobile?.screenshots].filter(Boolean);
    for (const s of containers) {
      for (const [key, value] of Object.entries(s)) {
        if (typeof value !== 'string' || !/\.(png|jpe?g|webp)$/i.test(value)) continue;
        const viewport = /mobile/i.test(key + ' ' + value) ? 'mobile' : (/desktop/i.test(key + ' ' + value) ? 'desktop' : 'unknown');
        add({ role: `deep-page-${key}`, viewport, pageType, url, path: rel(outDir, value) });
      }
    }
  }

  for (const stage of manifest.bookingFlow?.fieldsByStage || []) {
    if (stage.evidenceScreenshot) add({ role: `booking-stage-${stage.stage}`, viewport: 'mobile', pageType: 'booking', stage: stage.stage, path: rel(outDir, stage.evidenceScreenshot) });
  }

  const d = manifest.desktop || {}, m = manifest.mobile || {};
  const deterministicContext = {
    overall: manifest.scoring?.overall ?? null,
    categories: manifest.scoring?.categories || {},
    pillars: manifest.scoring?.pillars || {},
    hero: manifest.scoring?.explainability?.hero || null,
    mobileUx: manifest.scoring?.explainability?.mobileUx || null,
    booking: manifest.scoring?.explainability?.booking || null,
    appointmentAccess: manifest.scoring?.explainability?.appointmentAccess || null,
    cta: {
      desktop: d.ctaMetrics?.primaryCta || null,
      mobile: m.ctaMetrics?.primaryCta || null
    },
    overlays: { desktop: d.overlayMetrics || null, mobile: m.overlayMetrics || null },
    trust: { desktop: d.trustMetrics || null, mobile: m.trustMetrics || null },
    bookingFacts: manifest.bookingFlow ? {
      analyzed: !!manifest.bookingFlow.analyzed,
      requiredFieldCount: manifest.bookingFlow.requiredFieldCount ?? manifest.bookingFlow.totalRequiredFieldCount ?? null,
      captchaDetected: !!manifest.bookingFlow.captchaDetected,
      thirdPartyAdsDetected: !!manifest.bookingFlow.thirdPartyAdsDetected,
      loginRequired: !!manifest.bookingFlow.loginRequired,
      paymentRequired: !!manifest.bookingFlow.paymentRequired,
      stages: manifest.bookingFlow.totalInteractionStageCount ?? null
    } : null
  };

  return {
    schemaVersion: VISUAL_SCHEMA_VERSION,
    auditVersion: manifest.version,
    reviewedUrl: manifest.reviewedUrl,
    finalUrl: manifest.finalUrl,
    status: 'evidence-ready',
    screenshots: shots,
    deterministicContext,
    reviewPolicy: {
      hardFactsRemainAuthoritative: ['required fields','booking steps','login/payment requirement','URLs','contact channels','viewport/overflow','CTA dimensions','contrast ratio'],
      visualReviewBestFor: ['visual hierarchy','perceived clutter','whitespace','hero attractiveness','image credibility','background interference','ad distraction','trust presentation','visual prominence'],
      contradictionRule: 'Large deterministic-vs-visual disagreements are surfaced for review rather than silently averaged.'
    }
  };
}

function buildVisualReviewTemplate(evidencePackage) {
  const evidencePaths = evidencePackage.screenshots.map(x => x.path);
  return {
    schemaVersion: VISUAL_SCHEMA_VERSION,
    reviewedUrl: evidencePackage.reviewedUrl,
    reviewer: { type: 'vision-model-or-human', model: null, reviewedAt: null },
    evidencePaths,
    assessments: {
      heroClarity: { score: null, confidence: null, rationale: '', evidence: [] },
      primaryActionQuality: { score: null, confidence: null, rationale: '', evidence: [] },
      mobileVisualQuality: { score: null, confidence: null, rationale: '', evidence: [] },
      trustPresentation: { score: null, confidence: null, rationale: '', evidence: [] },
      bookingSurfaceQuality: { score: null, confidence: null, rationale: '', evidence: [] },
      adDistraction: { severity: null, confidence: null, rationale: '', evidence: [] },
      imageAuthenticity: { score: null, confidence: null, rationale: '', evidence: [] }
    },
    notes: 'Scores are 0-100. confidence is high|medium|low. severity is none|low|medium|high. Visual review must cite screenshot paths from evidencePaths.'
  };
}

function loadVisualReview(reviewPath) {
  if (!reviewPath) return null;
  if (!fs.existsSync(reviewPath)) return null;
  return JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
}

function scoreValue(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

function confidenceWeight(conf) {
  if (conf === 'high') return 0.60;
  if (conf === 'medium') return 0.45;
  if (conf === 'low') return 0.30;
  return 0;
}

function boundedBlend(base, visual, confidence, maxDelta) {
  base = scoreValue(base); visual = scoreValue(visual);
  if (base == null || visual == null) return { score: base, applied: false, adjustment: 0 };
  const w = confidenceWeight(confidence);
  if (!w) return { score: base, applied: false, adjustment: 0 };
  const proposed = Math.round(base * (1 - w) + visual * w);
  const low = Math.max(0, base - maxDelta), high = Math.min(100, base + maxDelta);
  const score = Math.max(low, Math.min(high, proposed));
  return { score, applied: score !== base, adjustment: score - base, proposed, cap: maxDelta };
}

function reconcileVisualEvidence(scoring, visualReview) {
  const base = scoring?.categories || {};
  const a = visualReview?.assessments || {};
  if (!visualReview || !a) {
    return {
      status: 'awaiting-visual-review',
      deterministicOverall: scoring?.overall ?? null,
      reconciledOverall: scoring?.overall ?? null,
      categories: base,
      adjustments: [],
      confidence: 'deterministic-only'
    };
  }

  const mappings = [
    ['heroClarity', a.heroClarity, 12],
    ['conversionCta', a.primaryActionQuality, 10],
    ['mobileUx', a.mobileVisualQuality, 8],
    ['trustProof', a.trustPresentation, 10]
  ];
  const categories = { ...base };
  const adjustments = [];
  for (const [category, assessment, cap] of mappings) {
    if (!assessment) continue;
    const result = boundedBlend(base[category], assessment.score, assessment.confidence, cap);
    categories[category] = result.score;
    if (result.applied) adjustments.push({ category, deterministic: base[category], visual: scoreValue(assessment.score), confidence: assessment.confidence, reconciled: result.score, adjustment: result.adjustment, maxAdjustment: cap, rationale: assessment.rationale || '' });
  }

  // Visual booking evidence can flag surface distraction, but cannot erase verified booking facts.
  if (a.bookingSurfaceQuality?.score != null && base.lowFriction != null) {
    const result = boundedBlend(base.lowFriction, a.bookingSurfaceQuality.score, a.bookingSurfaceQuality.confidence, 8);
    categories.lowFriction = result.score;
    if (result.applied) adjustments.push({ category:'lowFriction', deterministic:base.lowFriction, visual:scoreValue(a.bookingSurfaceQuality.score), confidence:a.bookingSurfaceQuality.confidence, reconciled:result.score, adjustment:result.adjustment, maxAdjustment:8, rationale:a.bookingSurfaceQuality.rationale || '' });
  }
  const sev = a.adDistraction?.severity;
  if (['medium','high'].includes(sev) && categories.lowFriction != null) {
    const penalty = sev === 'high' ? 6 : 3;
    const before = categories.lowFriction;
    categories.lowFriction = Math.max(0, before - penalty);
    adjustments.push({ category:'lowFriction', type:'visual-ad-distraction', severity:sev, deterministicOrPrior:before, reconciled:categories.lowFriction, adjustment:-penalty, rationale:a.adDistraction.rationale || '' });
  }

  const bookingContribution = categories.bookingJourney == null ? categories.appointmentAccess : categories.bookingJourney;
  const overall = Math.round(
    (categories.conversionCta || 0) * 0.22 +
    (categories.contactAccess || 0) * 0.14 +
    (categories.mobileUx || 0) * 0.16 +
    (categories.trustProof || 0) * 0.15 +
    (categories.heroClarity || 0) * 0.14 +
    (categories.lowFriction || 0) * 0.07 +
    (bookingContribution || 0) * 0.12
  );

  const disagreement = adjustments.some(x => Math.abs((x.visual ?? x.deterministic ?? 0) - (x.deterministic ?? 0)) >= 20);
  return {
    status: 'reconciled',
    deterministicOverall: scoring?.overall ?? null,
    reconciledOverall: overall,
    categories,
    adjustments,
    confidence: disagreement ? 'review-recommended' : 'high',
    disagreementDetected: disagreement,
    rule: 'Hard browser facts are not overridden. Perceptual categories use confidence-weighted, bounded visual adjustments.'
  };
}

function writeVisualEvidenceFiles(outDir, evidencePackage, reviewTemplate, reconciliation) {
  writeJson(path.join(outDir, 'visual-evidence-manifest.json'), evidencePackage);
  const templatePath = path.join(outDir, 'visual-review-template.json');
  if (!fs.existsSync(templatePath)) writeJson(templatePath, reviewTemplate);
  writeJson(path.join(outDir, 'visual-reconciliation.json'), reconciliation);
}

module.exports = { buildVisualEvidencePackage, buildVisualReviewTemplate, loadVisualReview, reconcileVisualEvidence, writeVisualEvidenceFiles, boundedBlend };
