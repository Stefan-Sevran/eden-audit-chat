const { scoreHeroClarity, scoreCtaProminence } = require('./hero-scorecard');
const { band } = require('./score-ledger');
const { evaluateAppointmentAccess } = require('./capability-gates');
function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, Math.round(n))); }

function scoreMobileTextLegibility(resp = {}) {
  let score = 100;
  const tinyChars = resp.tinyTextCharacterPercent ?? resp.tinyTextPercent ?? 0;
  const smallChars = resp.smallTextCharacterPercent ?? tinyChars;
  const aboveTiny = resp.aboveFoldTinyTextCharacterPercent ?? tinyChars;
  const median = resp.medianFontSizePx;
  if (tinyChars >= 75) score -= 38; else if (tinyChars >= 50) score -= 28; else if (tinyChars >= 30) score -= 18; else if (tinyChars >= 15) score -= 9;
  if (smallChars >= 85) score -= 18; else if (smallChars >= 60) score -= 12; else if (smallChars >= 35) score -= 6;
  if (aboveTiny >= 60) score -= 16; else if (aboveTiny >= 35) score -= 10; else if (aboveTiny >= 20) score -= 5;
  if (median != null && median < 11) score -= 18; else if (median != null && median < 12) score -= 12; else if (median != null && median < 14) score -= 5;
  // Deterministic DOM typography alone cannot establish perfect visual legibility
  // (e.g. text over imagery, unusual font rendering). Reserve 100 for later visual validation.
  return clamp(score, 0, 98);
}


function scoreMobileUxScorecard({ pageMetrics={}, cta={}, heroScorecard={}, overlayMetrics={}, ctaCompetition={} }={}) {
  const resp=pageMetrics.responsiveness||{};
  const textLegibility=scoreMobileTextLegibility(resp);
  const responsiveFoundation = resp.viewportMetaPresent === false ? 35 : (resp.fixedWidthCandidateCount||0)>0 ? 65 : 100;
  const tinyTargets=resp.tinyInteractiveTargetPercent||0;
  const criticalTiny=resp.criticalTinyInteractiveTargetPercent ?? tinyTargets;
  const aboveFoldTiny=resp.aboveFoldTinyInteractiveTargetPercent ?? tinyTargets;
  const highIntentTiny=resp.targetCategories?.highIntent?.tinyPercent ?? criticalTiny;
  const formTiny=resp.targetCategories?.formControl?.tinyPercent ?? criticalTiny;
  const navTiny=resp.targetCategories?.navigation?.tinyPercent ?? tinyTargets;
  // Patient-impact weighted target quality. Tiny footer/social links are retained as
  // diagnostics but no longer dominate the score. High-intent and form controls matter most.
  const penalty = Math.min(75,
    highIntentTiny*0.55 +
    formTiny*0.10 +
    aboveFoldTiny*0.15 +
    navTiny*0.05 +
    tinyTargets*0.02
  );
  const tapTargetQuality = clamp(98-penalty,20,98);
  const overflow=pageMetrics.document?.horizontalOverflowPx||0;
  const horizontalFit = clamp(overflow>120?20:overflow>40?45:overflow>0?70:(resp.fixedWidthCandidateCount||0)>0?60:100);
  let primaryActionUsability=cta?100:25;
  if(cta){
    if(!['booking','consultation'].includes(cta.intent)) primaryActionUsability-=22;
    if(!cta.aboveFold) primaryActionUsability-=18;
    if(!cta.targetLargeEnough) primaryActionUsability-=18;
    if((cta.fontSizePx||16)<14) primaryActionUsability-=12;
    if((cta.contrastRatio||0)<4.5) primaryActionUsability-=12;
  }
  primaryActionUsability=clamp(primaryActionUsability,0,96);
  const heroReadability=clamp(heroScorecard.overall??70);
  const coverage=overlayMetrics.cookieConsentViewportCoveragePercent||0;
  const firstVisitObstruction=clamp(100-Math.min(45,coverage*1.6));
  const attention=ctaCompetition.attentionFragmentationScore||0;
  const attentionFocus=clamp(100-attention*0.35);
  const components={responsiveFoundation,textLegibility,tapTargetQuality,horizontalFit,primaryActionUsability,heroReadability,firstVisitObstruction,attentionFocus};
  const weights={responsiveFoundation:.16,textLegibility:.16,tapTargetQuality:.12,horizontalFit:.11,primaryActionUsability:.18,heroReadability:.13,firstVisitObstruction:.07,attentionFocus:.07};
  const overall=clamp(Object.entries(weights).reduce((sum,[k,w])=>sum+(components[k]||0)*w,0));
  return {overall,band:band(overall),components,weights,
    componentKinds:{
      responsiveFoundation:'capability-check',
      textLegibility:'deterministic-quality-score',
      tapTargetQuality:'patient-impact-quality-score',
      horizontalFit:'capability-check',
      primaryActionUsability:'patient-impact-quality-score',
      heroReadability:'quality-score',
      firstVisitObstruction:'measured-quality-score',
      attentionFocus:'quality-score'
    },
    interpretation:'A 100 on a narrow capability check means the tested failure was not detected; it does not mean the overall mobile experience is perfect.',
    diagnostics:{
    tinyInteractiveTargetPercent:tinyTargets,
    criticalTinyInteractiveTargetPercent:criticalTiny,
    aboveFoldTinyInteractiveTargetPercent:aboveFoldTiny,
    highIntentTinyInteractiveTargetPercent:highIntentTiny,
    formControlTinyInteractiveTargetPercent:formTiny,
    navigationTinyInteractiveTargetPercent:navTiny,
    targetCategories:resp.targetCategories||null,
    horizontalOverflowPx:overflow,
    fixedWidthCandidateCount:resp.fixedWidthCandidateCount||0
  }};
}

function evaluateStalenessEvidence(desktop={},mobile={}) {
  const pages=[desktop.pageMetrics||{},mobile.pageMetrics||{}];
  const latestFooterYear=Math.max(...pages.map(p=>p.legacy?.latestFooterYear||0));
  const oldFooterYear=pages.some(p=>p.legacy?.oldFooterYearSignal);
  const obsolete=pages.some(p=>p.legacy?.obsoleteFlashDetected);
  const noViewport=mobile.pageMetrics?.responsiveness?.viewportMetaPresent===false;
  const legacyTable=pages.some(p=>p.legacy?.legacyTableLayoutSignal);
  const tinyMobile=(mobile.pageMetrics?.responsiveness?.tinyTextCharacterPercent||0)>=50;
  const modernVideo=(desktop.heroMetrics?.mediaType==='video'||mobile.heroMetrics?.mediaType==='video') && !obsolete;
  const responsive=mobile.pageMetrics?.responsiveness?.viewportMetaPresent===true && (mobile.pageMetrics?.responsiveness?.fixedWidthCandidateCount||0)===0;
  let evidencePoints=0;
  if(oldFooterYear) evidencePoints+=1;
  if(obsolete) evidencePoints+=3;
  if(noViewport) evidencePoints+=2;
  if(legacyTable) evidencePoints+=2;
  if(tinyMobile) evidencePoints+=2;
  if(modernVideo) evidencePoints-=1;
  if(responsive) evidencePoints-=1;
  const risk=evidencePoints>=5?'very-high':evidencePoints>=3?'high':evidencePoints>=2?'medium':evidencePoints>=1?'low':'very-low';
  const staleSignal=evidencePoints>=3;
  return {risk,staleSignal,evidencePoints,latestFooterYear:latestFooterYear||null,signals:{oldFooterYear,obsoleteTechnology:obsolete,noMobileViewport:noViewport,legacyTableLayout:legacyTable,tinyFixedTypography:tinyMobile,modernVideoCounterSignal:modernVideo,responsiveCounterSignal:responsive}};
}

function technicalFreshnessScore(staleness = {}) {
  const riskPenalty = { 'very-low': 0, low: 8, medium: 22, high: 45, 'very-high': 70 }[staleness.risk] ?? 15;
  return clamp(100 - riskPenalty, 0, 100);
}

function buildPillarScorecards({ conversionCta, contact, mobileUx, hero, friction, bookingContribution, appointmentAccess, staleness }) {
  const technicalFreshness = technicalFreshnessScore(staleness);

  // Digital Experience describes the quality of the website surface itself.
  // It intentionally avoids booking/contact duplication so a visually/technically strong
  // site can still be distinguished from a weak conversion architecture.
  const digitalComponents = {
    mobileExperience: mobileUx,
    heroExperience: hero,
    primaryActionQuality: conversionCta,
    technicalFreshness
  };
  const digitalWeights = { mobileExperience: 0.35, heroExperience: 0.30, primaryActionQuality: 0.20, technicalFreshness: 0.15 };
  const digitalExperience = clamp(Object.entries(digitalWeights).reduce((sum,[k,w]) => sum + digitalComponents[k]*w, 0));

  // Patient Conversion Readiness measures how easily a prospective patient can act,
  // reach the clinic, enter a booking path, and retain certainty through the handoff.
  const conversionComponents = {
    primaryActionQuality: conversionCta,
    contactAccess: contact,
    appointmentAccess: appointmentAccess.score,
    bookingOrHandoffJourney: bookingContribution,
    surfaceFriction: friction
  };
  const conversionWeights = { primaryActionQuality: 0.20, contactAccess: 0.20, appointmentAccess: 0.25, bookingOrHandoffJourney: 0.25, surfaceFriction: 0.10 };
  const patientConversionReadiness = clamp(Object.entries(conversionWeights).reduce((sum,[k,w]) => sum + conversionComponents[k]*w, 0));

  return {
    digitalExperience: { overall: digitalExperience, band: band(digitalExperience), components: digitalComponents, weights: digitalWeights },
    patientConversionReadiness: { overall: patientConversionReadiness, band: band(patientConversionReadiness), components: conversionComponents, weights: conversionWeights }
  };
}

function buildAssessmentProfile(pillars = {}, overall = 0) {
  const digital = pillars.digitalExperience?.overall ?? null;
  const conversion = pillars.patientConversionReadiness?.overall ?? null;
  const gap = digital != null && conversion != null ? digital - conversion : null;
  let archetype = 'mixed';
  if (digital != null && conversion != null) {
    if (digital >= 75 && conversion >= 75) archetype = 'balanced-strong';
    else if (digital >= 70 && gap >= 20) archetype = 'strong-surface-conversion-gap';
    else if (digital < 45 && conversion < 45) archetype = 'critical-digital-foundation';
    else if (conversion >= 70 && digital < 65) archetype = 'conversion-capable-surface-improvable';
    else if (gap >= 15) archetype = 'surface-stronger-than-conversion';
    else if (gap <= -15) archetype = 'conversion-stronger-than-surface';
    else archetype = 'mixed-balanced';
  }
  return {
    overall,
    digitalExperience: digital,
    patientConversionReadiness: conversion,
    surfaceConversionGap: gap,
    archetype,
    interpretation: archetype === 'strong-surface-conversion-gap'
      ? 'The website surface is materially stronger than the patient conversion path; prioritize the action-to-appointment handoff.'
      : archetype === 'balanced-strong'
        ? 'The website surface and patient conversion path are both strong; remaining gains are likely in specific friction points and channel/operations depth.'
        : archetype === 'critical-digital-foundation'
          ? 'Both the website foundation and patient conversion path require substantial improvement.'
          : 'Use the two pillar scores and their component evidence to locate the dominant constraint.'
  };
}

function scoreSnapshot({ desktop, mobile, bookingFlow = {} }) {
  const dp = desktop?.ctaMetrics?.primaryCta, mp = mobile?.ctaMetrics?.primaryCta;
  const df = desktop?.funnelMetrics || {}, mf = mobile?.funnelMetrics || {};
  const dh = desktop?.heroMetrics || {}, mh = mobile?.heroMetrics || {};
  const dover = desktop?.overlayMetrics || {}, mover = mobile?.overlayMetrics || {};
  const dpage = desktop?.pageMetrics || {}, mpage = mobile?.pageMetrics || {};
  const dcomp = desktop?.ctaCompetition || {}, mcomp = mobile?.ctaCompetition || {};
  const dtrust = desktop?.trustMetrics || {}, mtrust = mobile?.trustMetrics || {};

  const desktopCtaLedger = scoreCtaProminence(dh, dp, dcomp);
  const mobileCtaLedger = scoreCtaProminence(mh, mp, mcomp);
  const conversionCta = clamp((desktopCtaLedger.score + mobileCtaLedger.score) / 2, 0, 98);

  let contact = 0;
  const actionablePhoneCount=(df.phoneLinks?.length || 0) + (mf.phoneLinks?.length || 0);
  const displayedPhone=!!(dpage.contact?.phoneDisplayed||mpage.contact?.phoneDisplayed);
  if (actionablePhoneCount > 0) contact += 25;
  else if (displayedPhone) contact += 12;
  const contactPageVisible=!!(df.contactPageVisible||mf.contactPageVisible||(df.contactLinks?.length||0)||(mf.contactLinks?.length||0));
  if (contactPageVisible) contact += 12;
  if (df.onlineBookingVisible || mf.onlineBookingVisible) contact += 30;
  else if (df.socialHandoffVisible || mf.socialHandoffVisible || dp?.intent === 'social-handoff' || mp?.intent === 'social-handoff') contact += 14;
  if ((df.lineLinks?.length || 0) + (mf.lineLinks?.length || 0) > 0) contact += 14;
  const directWa = (desktop?.channelMetrics?.whatsappDirectLinks?.length || 0) + (mobile?.channelMetrics?.whatsappDirectLinks?.length || 0);
  if (directWa > 0) contact += 14;
  if ((df.messengerLinks?.length || 0) + (mf.messengerLinks?.length || 0) > 0) contact += 9;
  const viberCount=(desktop?.channelMetrics?.viberLinks?.length||0)+(mobile?.channelMetrics?.viberLinks?.length||0);
  if (viberCount > 0) contact += 12;
  const emailCount=(desktop?.channelMetrics?.emailLinks?.length||0)+(mobile?.channelMetrics?.emailLinks?.length||0);
  if (emailCount > 0) contact += 5;
  const facebookCount=(desktop?.channelMetrics?.facebookLinks?.length||0)+(mobile?.channelMetrics?.facebookLinks?.length||0);
  if (facebookCount > 0 && !(df.socialHandoffVisible || mf.socialHandoffVisible || dp?.intent === 'social-handoff' || mp?.intent === 'social-handoff')) contact += 4;
  if ((df.mapsLinks?.length || 0) + (mf.mapsLinks?.length || 0) > 0 || df.mapEmbedVisible || mf.mapEmbedVisible) contact += 5;
  contact = clamp(contact);

  const resp = mpage.responsiveness || {};
  const mobileTextLegibility = scoreMobileTextLegibility(resp);

  const trust = clamp(Math.max(dtrust.score || 0, mtrust.score || 0) || (() => {
    let t = 15;
    if (df.reviewsVisible || mf.reviewsVisible) t += 18;
    if (df.beforeAfterVisible || mf.beforeAfterVisible) t += 18;
    if (df.pricingVisible || mf.pricingVisible) t += 12;
    if (df.doctorProfileVisible || mf.doctorProfileVisible) t += 17;
    if (df.patientCountTrustVisible || mf.patientCountTrustVisible) t += 12;
    if (df.accreditationTrustVisible || mf.accreditationTrustVisible) t += 8;
    return t;
  })());

  const desktopHeroScorecard = scoreHeroClarity(dh, dp, dover, dcomp, dpage);
  const mobileHeroScorecard = scoreHeroClarity(mh, mp, mover, mcomp, mpage);
  const hero = clamp(desktopHeroScorecard.overall * 0.35 + mobileHeroScorecard.overall * 0.65);
  const mobileUxScorecard = scoreMobileUxScorecard({pageMetrics:mpage,cta:mp,heroScorecard:mobileHeroScorecard,overlayMetrics:mover,ctaCompetition:mcomp});
  const mobileUx = mobileUxScorecard.overall;

  // Low-friction surface score excludes booking-flow deductions; booking is scored separately.
  let friction = 96;
  const cookieCoverage = Math.max(dover.cookieConsentViewportCoveragePercent || 0, mover.cookieConsentViewportCoveragePercent || 0);
  if (cookieCoverage >= 30) friction -= 22; else if (cookieCoverage >= 18) friction -= 13; else if (cookieCoverage >= 8) friction -= 6;
  const fragmentation = Math.max(dcomp.attentionFragmentationScore || 0, mcomp.attentionFragmentationScore || 0);
  if (fragmentation >= 70) friction -= 18; else if (fragmentation >= 45) friction -= 10; else if (fragmentation >= 25) friction -= 4;
  if (bookingFlow?.thirdPartyAdsDetected) friction -= 6;
  if (bookingFlow?.captchaDetected) friction -= 3;
  friction = clamp(friction);

  const appointmentAccess = evaluateAppointmentAccess({desktop,mobile,bookingFlow});
  const staleness = evaluateStalenessEvidence(desktop,mobile);
  const bookingJourneyMeasured = !!bookingFlow?.analyzed && bookingFlow?.bookingJourneyScore != null;
  const bookingEntryMeasured = !!bookingFlow?.analyzed && bookingFlow?.bookingEntryScore != null;
  const bookingJourney = bookingJourneyMeasured ? clamp(bookingFlow.bookingJourneyScore) : null;
  const bookingEntryExperience = bookingEntryMeasured ? clamp(bookingFlow.bookingEntryScore) : null;
  // If only the booking entry surface was verified, do not let an unverified
  // end-to-end journey inflate the conversion score. Fall back to appointment
  // access while still exposing bookingEntryExperience in explainability.
  const bookingContribution = bookingJourneyMeasured ? bookingJourney : appointmentAccess.score;
  // Missing digital capability must not be rewarded as "low friction".
  if (!appointmentAccess.onlineBookingAvailable) friction = Math.min(friction, appointmentAccess.score + 15);
  const legacyDetected=!!(dpage.legacy?.obsoleteFlashDetected||mpage.legacy?.obsoleteFlashDetected);
  if(legacyDetected) friction=Math.min(friction,55);
  const overall = clamp(conversionCta * 0.22 + contact * 0.14 + mobileUx * 0.16 + trust * 0.15 + hero * 0.14 + friction * 0.07 + bookingContribution * 0.12);
  const pillars = buildPillarScorecards({ conversionCta, contact, mobileUx, hero, friction, bookingContribution, appointmentAccess, staleness });
  const assessmentProfile = buildAssessmentProfile(pillars, overall);
  const flags = [];
  if (dp?.region === 'navigation') flags.push('Desktop primary CTA ranking still resolves to navigation; review visually.');
  if (mp?.region === 'navigation') flags.push('Mobile primary CTA ranking still resolves to navigation; review visually.');
  if (mover.cookieConsentDetected) flags.push(`First-visit cookie consent covers about ${mover.cookieConsentViewportCoveragePercent}% of the mobile viewport.`);
  if (dh.mediaType === 'video' || mh.mediaType === 'video') flags.push('Dynamic hero video detected; visual quality can vary by frame.');
  if ((mpage.document?.horizontalOverflowPx || 0) > 0) flags.push('Mobile horizontal overflow detected.');
  if (fragmentation >= 50) flags.push(`Above-fold CTA competition is ${fragmentation >= 70 ? 'high' : 'moderate'} (fragmentation ${fragmentation}/100).`);
  if (bookingFlow?.analyzed && bookingFlow.loginRequired) flags.push('Booking path appears to require login/account creation.');
  if (!appointmentAccess.onlineBookingAvailable) flags.push(`No online booking flow was detected; appointment access is classified as ${appointmentAccess.status}.`);
  if (dpage.legacy?.obsoleteFlashDetected || mpage.legacy?.obsoleteFlashDetected) flags.push('Obsolete/broken Flash content was detected on the inspected page.');
  if (mpage.responsiveness?.viewportMetaPresent === false) flags.push('Mobile viewport metadata is missing; the site may render as a scaled desktop layout on phones.');
  const rr = mpage.responsiveness || {};
  if ((rr.tinyTextElementPercent ?? rr.tinyTextPercent ?? 0) >= 20) {
    flags.push(`${rr.tinyTextElementPercent ?? rr.tinyTextPercent}% of sampled visible leaf-text elements are below 12px on mobile; character-weighted share is ${rr.tinyTextCharacterPercent ?? 'unknown'}%.`);
  }

  return {
    version: '1.8.0',
    overall,
    pillars,
    assessmentProfile,
    categories: { conversionCta, contactAccess: contact, mobileUx, mobileTextLegibility, trustProof: trust, heroClarity: hero, lowFriction: friction, bookingJourney, bookingEntryExperience, appointmentAccess:appointmentAccess.score },
    categoryBands: { conversionCta:band(conversionCta), contactAccess:band(contact), mobileUx:band(mobileUx), mobileTextLegibility:band(mobileTextLegibility), trustProof:band(trust), heroClarity:band(hero), lowFriction:band(friction), bookingJourney:bookingJourneyMeasured?band(bookingJourney):'not-verified', bookingEntryExperience:bookingEntryMeasured?band(bookingEntryExperience):'not-applicable', appointmentAccess:band(appointmentAccess.score), overall:band(overall) },
    explainability: { appointmentAccess, mobileUx:mobileUxScorecard, staleness, cta:{ desktop:desktopCtaLedger, mobile:mobileCtaLedger }, hero: { desktop: desktopHeroScorecard, mobile: mobileHeroScorecard }, booking: bookingFlow?.subScores ? { overall: bookingJourney, canonicalScore: bookingJourney, band:bookingJourney==null?'unknown':band(bookingJourney), entryExperienceScore:bookingEntryExperience, entryExperienceBand:bookingEntryExperience==null?'unknown':band(bookingEntryExperience), completionVerified:bookingFlow.bookingCompletionVerified===true, scoreStatus:bookingJourney==null&&bookingEntryExperience!=null?'entry-only':'journey-scored', components: bookingFlow.subScores, weights: bookingFlow.scoreWeights, diagnosticWeightedScore: bookingFlow.scoreReconciliation?.weightedDiagnosticScore ?? null, ledger:bookingFlow.scoreLedger || null, reconciliation:bookingFlow.scoreReconciliation || null, stages:{visibleFormStepCount:bookingFlow.advertisedVisibleStepCount||bookingFlow.visibleFormStepCount||bookingFlow.detectedStepCount||null,advertisedVisibleStepCount:bookingFlow.advertisedVisibleStepCount||bookingFlow.visibleFormStepCount||bookingFlow.detectedStepCount||null,verifiedFormStepCount:bookingFlow.verifiedFormStepCount||bookingFlow.visibleFormStepCount||null,distinctStateCount:bookingFlow.distinctStateCount||bookingFlow.traversedStageCount||bookingFlow.totalInteractionStageCount||null,reviewOrConfirmationStageCount:bookingFlow.reviewOrConfirmationStageCount||0,totalInteractionStageCount:bookingFlow.totalInteractionStageCount||bookingFlow.traversedStageCount||null,fieldsByStage:bookingFlow.fieldsByStage||[],unvisitedStages:bookingFlow.unvisitedStages||[],transitions:bookingFlow.transitions||[]}, avoidedPenalties:bookingFlow.avoidedPenalties||[] } : null },
    scoreSemantics: { holisticPerfectScoreReserved: true, narrowCapabilityChecksMayScore100: true, note: 'A 100 on a narrow binary/capability measurement means the tested defect was not observed. Holistic category and pillar scores should treat 100 as exceptional and effectively reserved.' },
    confidence: bookingFlow?.analyzed ? 'deterministic-v2-plus-booking-path' : 'deterministic-v2',
    flags
  };
}

module.exports = { scoreSnapshot, clamp, scoreMobileTextLegibility, scoreMobileUxScorecard, evaluateStalenessEvidence, technicalFreshnessScore, buildPillarScorecards, buildAssessmentProfile };
