function collectTrustMetrics(funnel = {}) {
  const signals = {
    reviews: !!funnel.reviewsVisible,
    beforeAfter: !!funnel.beforeAfterVisible,
    pricing: !!funnel.pricingVisible,
    clinicianProfiles: !!funnel.doctorProfileVisible,
    clinicianMention: !!funnel.clinicianMentionVisible,
    patientVolume: !!funnel.patientCountTrustVisible,
    accreditationTechnology: !!funnel.accreditationTrustVisible,
    mapsPresence: !!((funnel.mapsLinks || []).length || funnel.mapEmbedVisible)
  };
  const weights = { reviews:18, beforeAfter:16, pricing:10, clinicianProfiles:18, clinicianMention:5, patientVolume:14, accreditationTechnology:12, mapsPresence:7 };
  const score = Object.entries(signals).reduce((sum,[k,v]) => sum + (v ? weights[k] : 0), 0);
  const missing = Object.entries(signals).filter(([,v]) => !v).map(([k]) => k);
  return { score: Math.min(100, score), signals, missing, signalCount: Object.values(signals).filter(Boolean).length };
}
module.exports = { collectTrustMetrics };
