function analyzeCtaCompetition(ctaMetrics = {}, channelMetrics = {}) {
  const visible = (ctaMetrics.competingAboveFoldCtas || []).filter(c => c && c.aboveFold);
  const byIntent = {};
  for (const c of visible) byIntent[c.intent || 'other'] = (byIntent[c.intent || 'other'] || 0) + 1;
  const uniqueIntents = Object.keys(byIntent).filter(k => byIntent[k] > 0);
  const conversionIntents = new Set(['booking','consultation','call','whatsapp','message','contact']);
  const conversionOptions = uniqueIntents.filter(x => conversionIntents.has(x));
  const primary = ctaMetrics.primaryCta || null;
  const runnerUp = (ctaMetrics.secondaryCtas || [])[0] || null;
  const scoreGap = primary && runnerUp ? Math.round((primary.score - runnerUp.score) * 10) / 10 : null;

  let fragmentation = 0;
  fragmentation += Math.min(45, Math.max(0, visible.length - 1) * 9);
  fragmentation += Math.min(25, Math.max(0, conversionOptions.length - 1) * 7);
  fragmentation += Math.min(20, Math.max(0, (channelMetrics.aboveFoldChannelCount || 0) - 2) * 5);
  if (scoreGap != null && scoreGap > 65) fragmentation -= 12;
  if (primary?.intent === 'booking' && primary?.region === 'hero') fragmentation -= 8;
  fragmentation = Math.max(0, Math.min(100, Math.round(fragmentation)));

  return {
    aboveFoldMeaningfulCtaCount: visible.length,
    byIntent,
    uniqueIntentCount: uniqueIntents.length,
    conversionOptionCount: conversionOptions.length,
    primaryToRunnerUpScoreGap: scoreGap,
    attentionFragmentationScore: fragmentation,
    interpretation: fragmentation >= 65 ? 'high' : fragmentation >= 35 ? 'moderate' : 'low'
  };
}
module.exports = { analyzeCtaCompetition };
