const { clamp, ledger } = require('./score-ledger');
const { evaluateHeroValidity } = require('./capability-gates');

function scoreCtaProminence(hero = {}, cta = {}, competition = {}) {
  if (!cta) return { score: 20, band: 'critical', baseline: 100, deductions:[{points:80,reason:'No primary conversion CTA was detected.'}], credits:[] };
  const deductions = [];
  if (cta.intent !== 'booking') {
    const intentPenalty = cta.intent === 'consultation' ? 4 : cta.intent === 'contact' ? 20 : cta.intent === 'social-handoff' ? 18 : 14;
    const reason = cta.intent === 'contact'
      ? 'Detected action is a contact/navigation route rather than a direct booking action.'
      : cta.intent === 'social-handoff'
        ? 'Primary action hands the patient to a social platform rather than a verified booking flow.'
        : 'Primary CTA is less direct than a clear booking action.';
    deductions.push({ points:intentPenalty, reason });
  }
  if (cta.region !== 'hero') deductions.push({ points: cta.aboveFold ? 12 : 20, reason:'Primary CTA is not anchored in the main hero conversion zone.' });
  if (!cta.aboveFold) deductions.push({ points: 14, reason:'Primary CTA is below the initial viewport.' });
  if (!cta.targetLargeEnough) deductions.push({ points: 14, reason:'Tap/click target is smaller than preferred.' });
  if ((cta.fontSizePx || 16) < 12) deductions.push({ points: 10, reason:'CTA text is extremely small for a primary patient action.' });
  else if ((cta.fontSizePx || 16) < 14) deductions.push({ points: 5, reason:'CTA text is smaller than preferred for a primary patient action.' });
  if ((cta.contrastRatio || 0) < 4.5) deductions.push({ points: (cta.contrastRatio || 0) < 3 ? 14 : 8, reason:'CTA contrast is weaker than preferred.' });
  if ((cta.centrality || 0) < 0.45) deductions.push({ points: 6, reason:'CTA is relatively peripheral in the viewport.' });
  else if ((cta.centrality || 0) < 0.65) deductions.push({ points: 3, reason:'CTA could occupy a more dominant visual position.' });
  const fragmentation = competition.attentionFragmentationScore || 0;
  if (fragmentation >= 70) deductions.push({ points: 8, reason:'Strong above-fold competition divides attention.' });
  else if (fragmentation >= 45) deductions.push({ points: 5, reason:'Moderate above-fold competition divides attention.' });
  else if (fragmentation >= 25) deductions.push({ points: 2, reason:'Some competing above-fold actions reduce singular focus.' });
  if ((hero.buttonCount || 0) > 3) deductions.push({ points: Math.min(5,(hero.buttonCount-3)*2), reason:'Several hero controls compete with the primary action.' });
  // 98 ceiling: 99–100 is reserved for rare benchmark-level execution after visual/semantic review.
  return ledger({ baseline:100, deductions, ceiling:95 });
}

function scoreHeroClarity(hero = {}, cta = {}, overlay = {}, competition = {}, pageMetrics = {}) {
  const headlineLines = hero.headlineLineEstimate || 0;
  const leadLines = hero.leadLineEstimate || 0;
  const textArea = hero.textAreaPercent || 0;
  const buttonCount = hero.buttonCount || 0;
  const coverage = overlay.cookieConsentViewportCoveragePercent || 0;

  let headlineReadability = 94;
  if (!hero.headline) headlineReadability = 45;
  headlineReadability -= Math.max(0, headlineLines - 3) * 5;
  if (hero.mediaType === 'video' && !hero.hasOverlayLikely) headlineReadability -= 10;

  let bodyCopyReadability = hero.leadCopy ? 90 : 72;
  bodyCopyReadability -= Math.max(0, leadLines - 4) * 4;
  if ((hero.leadCopy || '').length > 260) bodyCopyReadability -= 6;
  if (hero.mediaType === 'video' && !hero.hasOverlayLikely) bodyCopyReadability -= 8;

  const ctaLedger = scoreCtaProminence(hero, cta, competition);
  const primaryCtaProminence = ctaLedger.score;

  // Direction: 100 = background supports readability; 0 = strongly interferes.
  let backgroundInterference = 91;
  if (hero.mediaType === 'video') backgroundInterference = hero.hasOverlayLikely ? 72 : 50;
  else if (hero.mediaType === 'background-image' || hero.mediaType === 'image') backgroundInterference = hero.hasOverlayLikely ? 82 : 70;

  // Direction: 100 = comfortable density; 0 = overloaded.
  let textDensity = 99 - textArea * 1.05 - Math.max(0, headlineLines - 3) * 2.7 - Math.max(0, leadLines - 4) * 1.8;
  if ((hero.textLength || 0) > 700) textDensity -= 6;

  // Direction: 100 = generous breathing room; 0 = cramped.
  let breathingRoom = 98 - Math.max(0, buttonCount - 2) * 3.5 - Math.max(0, textArea - 18) * 0.72;
  if ((hero.viewportCoveragePercent || 0) < 55) breathingRoom -= 6;

  // Direction: 100 = unobstructed first visit; 0 = heavily obstructed.
  const firstVisitObstruction = 100 - coverage * 1.55;

  const components = {
    headlineReadability: clamp(headlineReadability),
    bodyCopyReadability: clamp(bodyCopyReadability),
    primaryCtaProminence: clamp(primaryCtaProminence),
    backgroundInterference: clamp(backgroundInterference),
    textDensity: clamp(textDensity),
    breathingRoom: clamp(breathingRoom),
    firstVisitObstruction: clamp(firstVisitObstruction)
  };

  const weights = {
    headlineReadability: 0.18,
    bodyCopyReadability: 0.12,
    primaryCtaProminence: 0.20,
    backgroundInterference: 0.16,
    textDensity: 0.12,
    breathingRoom: 0.10,
    firstVisitObstruction: 0.12
  };
  const rawOverall = clamp(Object.entries(weights).reduce((sum,[k,w]) => sum + components[k] * w, 0),0,98);
  const validity = evaluateHeroValidity({hero,cta,pageMetrics});
  const overall = Math.min(rawOverall, validity.gateCeiling);

  const deductions = [];
  if (components.backgroundInterference < 75) deductions.push({ component:'backgroundInterference', points:75-components.backgroundInterference, reason: hero.mediaType === 'video' ? 'Dynamic video can compete with foreground copy; overlay strength matters.' : 'Background imagery may compete with foreground copy.' });
  if (components.textDensity < 75) deductions.push({ component:'textDensity', points:75-components.textDensity, reason:'The initial hero carries relatively dense text for the available viewport.' });
  if (components.breathingRoom < 75) deductions.push({ component:'breathingRoom', points:75-components.breathingRoom, reason:'Text and controls leave limited visual breathing room.' });
  if (components.firstVisitObstruction < 85) deductions.push({ component:'firstVisitObstruction', points:85-components.firstVisitObstruction, reason:`First-visit overlay covers about ${coverage}% of the viewport.` });

  return { overall, rawOverall, band: require('./score-ledger').band(overall), components, weights, deductions, validityGate:validity, componentLedgers:{ primaryCtaProminence:ctaLedger } };
}

module.exports = { scoreHeroClarity, scoreCtaProminence, clamp };
