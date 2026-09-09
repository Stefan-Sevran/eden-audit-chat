const VERSION = '2.4.1';

const TIERS = {
  VERIFIED: 'verified',
  SUPPORTED: 'supported',
  PROBABLE: 'probable',
  UNKNOWN: 'unknown'
};

function finite(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
    ? Number(v)
    : null;
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function evidenceItem({
  id,
  pillar,
  claim,
  tier = TIERS.UNKNOWN,
  sources = [],
  publishable = false,
  reason = '',
  value = null,
  scoreImpact = null,
  metadata = null
}) {
  return {
    id,
    pillar,
    claim,
    tier,
    sources: [...new Set((sources || []).filter(Boolean))],
    publishable: Boolean(publishable),
    reason: compact(reason),
    value,
    scoreImpact: finite(scoreImpact),
    metadata: metadata || null
  };
}

function contradiction({
  id,
  severity = 'medium',
  pillar = 'cross-channel',
  field = null,
  title,
  positions = [],
  sources = [],
  blocksPublication = false,
  reason = ''
}) {
  return {
    id,
    severity,
    pillar,
    field,
    title,
    positions,
    sources: [...new Set((sources || []).filter(Boolean))],
    blocksPublication: Boolean(blocksPublication),
    reason: compact(reason)
  };
}

function buildWebsiteEvidence(manifest) {
  const out = [];
  const s = manifest.summary || {};
  const scoring = manifest.scoring || null;

  if (!scoring || manifest.digitalFrontDoor?.conventionalWebsite === false) {
    return out;
  }

  out.push(evidenceItem({
    id: 'website-booking-cta',
    pillar: 'website',
    claim: 'Booking CTA visibility',
    tier: TIERS.VERIFIED,
    sources: ['deterministic-website-scan'],
    publishable: true,
    value: s.bookingCtaVisible === true,
    reason: 'Observed directly by the deterministic website scanner.'
  }));

  out.push(evidenceItem({
    id: 'website-phone-actionable',
    pillar: 'website',
    claim: 'Phone actionability',
    tier: TIERS.VERIFIED,
    sources: ['deterministic-website-scan'],
    publishable: true,
    value: s.phoneActionable === true,
    reason: 'Observed directly by the deterministic website scanner.'
  }));

  if (finite(s.mobileHeroClarity) !== null) {
    out.push(evidenceItem({
      id: 'website-mobile-hero-clarity',
      pillar: 'website',
      claim: 'Mobile hero clarity score',
      tier: TIERS.VERIFIED,
      sources: ['deterministic-website-scan'],
      publishable: true,
      value: finite(s.mobileHeroClarity),
      reason: 'Measured directly from the captured mobile website state.'
    }));
  }

  return out;
}

function buildGoogleEvidence(manifest) {
  const out = [];
  const branch = manifest.googleBusiness?.evidence?.branches?.[0] || {};
  const qualified = branch.identityIsolation?.qualified === true;
  const matchConfidence = branch.discovery?.matchConfidence || null;
  const profile = branch.profile || {};
  const provenance = branch.provenance?.source || 'public-google-maps-browser-probe';

  if (!qualified) {
    return out;
  }

  const tier = matchConfidence === 'high' ? TIERS.VERIFIED : TIERS.SUPPORTED;

  if (finite(profile.rating) !== null) {
    out.push(evidenceItem({
      id: 'google-rating',
      pillar: 'google',
      claim: 'Google rating',
      tier,
      sources: [provenance, ...(branch.discovery?.matchBasis || [])],
      publishable: true,
      value: finite(profile.rating),
      reason: matchConfidence === 'high'
        ? 'Observed on an identity-qualified Google profile with high match confidence.'
        : 'Observed on an identity-qualified Google profile with medium match confidence.'
    }));
  }

  if (finite(profile.reviewCount) !== null) {
    out.push(evidenceItem({
      id: 'google-review-count',
      pillar: 'google',
      claim: 'Google review count',
      tier,
      sources: [provenance, ...(branch.discovery?.matchBasis || [])],
      publishable: true,
      value: finite(profile.reviewCount),
      reason: 'Observed on the identity-qualified Google profile.'
    }));
  }

  if (profile.phone) {
    out.push(evidenceItem({
      id: 'google-phone',
      pillar: 'google',
      claim: 'Google profile phone',
      tier,
      sources: [provenance],
      publishable: true,
      value: profile.phone,
      reason: 'Observed on the identity-qualified Google profile.'
    }));
  }

  if (profile.website) {
    out.push(evidenceItem({
      id: 'google-website',
      pillar: 'google',
      claim: 'Google profile website',
      tier,
      sources: [provenance],
      publishable: true,
      value: profile.website,
      reason: 'Observed on the identity-qualified Google profile.'
    }));
  }

  return out;
}

function buildFacebookEvidence(manifest) {
  const out = [];
  const a = manifest.facebook?.assessment;
  const r = a?.responseMetrics || {};
  if (!a || ['awaiting-evidence', 'not-run'].includes(a.status)) return out;

  if (finite(r.scoringObservedIntentComments) !== null) {
    out.push(evidenceItem({
      id: 'facebook-high-intent-inquiries',
      pillar: 'facebook',
      claim: 'Explicit/high-intent inquiries observed',
      tier: TIERS.SUPPORTED,
      sources: ['sampled-public-facebook-content'],
      publishable: true,
      value: finite(r.scoringObservedIntentComments),
      reason: 'Directly observed in sampled public Facebook content; the sample is not treated as exhaustive history.'
    }));
  }

  if (finite(r.scoringResponseCoveragePercent) !== null) {
    out.push(evidenceItem({
      id: 'facebook-response-coverage',
      pillar: 'facebook',
      claim: 'High-intent public reply coverage',
      tier: TIERS.SUPPORTED,
      sources: ['sampled-public-facebook-content'],
      publishable: true,
      value: finite(r.scoringResponseCoveragePercent),
      reason: 'Calculated from the explicit/high-intent public sample only.'
    }));
  }

  if (r.scoringAnsweredIntentCount > 0 && r.medianResponseMinutes == null) {
    out.push(evidenceItem({
      id: 'facebook-response-time',
      pillar: 'facebook',
      claim: 'Historic response speed',
      tier: TIERS.UNKNOWN,
      sources: ['facebook-timestamp-boundary'],
      publishable: false,
      value: null,
      reason: 'Reply evidence exists, but timestamp precision is insufficient for defensible minute-level latency.'
    }));
  }

  return out;
}

function buildContradictions(manifest) {
  const out = [];
  const branch = manifest.googleBusiness?.evidence?.branches?.[0] || {};
  const consistency = branch.consistency || {};

  if (consistency.brandNameMatches === false) {
    out.push(contradiction({
      id: 'google-brand-identity-mismatch',
      severity: 'high',
      pillar: 'google',
      field: 'identity',
      title: 'Clinic identity differs between the audited clinic and observed Google profile',
      positions: ['audited-clinic-identity', 'google-profile-identity'],
      sources: ['clinic-identity', 'public-google-maps-browser-probe'],
      blocksPublication: true,
      reason: 'Identity mismatch can contaminate every Google-derived score and fact.'
    }));
  }

  if (consistency.websiteMatches === false) {
    out.push(contradiction({
      id: 'google-website-domain-mismatch',
      severity: 'high',
      pillar: 'google',
      field: 'website',
      title: 'Google profile website differs from the audited clinic website',
      positions: ['audited-website', 'google-profile-website'],
      sources: ['deterministic-website-scan', 'public-google-maps-browser-probe'],
      blocksPublication: true,
      reason: 'A mismatched destination can indicate stale profile data or wrong-entity evidence.'
    }));
  }

  if (consistency.phoneMatches === false) {
    out.push(contradiction({
      id: 'google-phone-mismatch',
      severity: 'high',
      pillar: 'google',
      field: 'phone',
      title: 'Website and Google profile expose different clinic phone numbers',
      positions: ['website-phone', 'google-profile-phone'],
      sources: ['deterministic-website-scan', 'public-google-maps-browser-probe'],
      blocksPublication: true,
      reason: 'Conflicting patient contact details require human reconciliation before being used as a score-driving fact.'
    }));
  }

  const diagnostics =
    manifest.googleBusinessProbe?.diagnostics?.evidenceAccumulation ||
    manifest.googleBusiness?.probe?.diagnostics?.evidenceAccumulation ||
    null;

  if (diagnostics?.rating?.conflict === true) {
    out.push(contradiction({
      id: 'google-rating-observation-conflict',
      severity: 'high',
      pillar: 'google',
      field: 'rating',
      title: 'Conflicting Google rating observations were captured in the same scan',
      sources: ['google-profile-multi-state-evidence'],
      blocksPublication: true,
      reason: 'Multiple positive observations disagree; a single public rating should not be asserted until reconciled.'
    }));
  }

  if (diagnostics?.reviewCount?.conflict === true) {
    out.push(contradiction({
      id: 'google-review-count-observation-conflict',
      severity: 'high',
      pillar: 'google',
      field: 'reviewCount',
      title: 'Conflicting Google review-count observations were captured in the same scan',
      sources: ['google-profile-multi-state-evidence'],
      blocksPublication: true,
      reason: 'Multiple positive observations disagree; the public review count should be withheld until reconciled.'
    }));
  }

  for (const conflict of manifest.aiAuditIntelligence?.conflicts || []) {
    if (!conflict) continue;
    out.push(contradiction({
      id: `ai-${conflict.claimId || out.length + 1}`,
      severity: conflict.severity || 'medium',
      pillar: 'cross-channel',
      field: conflict.claimId || null,
      title: conflict.claimId
        ? `Independent evidence review conflict: ${conflict.claimId}`
        : 'Independent evidence review conflict',
      positions: [
        conflict.scannerPosition || null,
        conflict.visualPosition || null
      ].filter(Boolean),
      sources: ['scanner-evidence', 'independent-ai-evidence-review'],
      blocksPublication: Boolean(
        conflict.humanReviewRequired &&
        String(conflict.severity || '').toLowerCase() === 'high'
      ),
      reason: conflict.humanReviewRequired
        ? 'Independent evidence review requires human reconciliation.'
        : 'Independent evidence review detected disagreement that should remain visible internally.'
    }));
  }

  return out;
}

function buildMissingEvidence(manifest) {
  const missing = [];

  if (manifest.digitalFrontDoor?.conventionalWebsite !== false && !manifest.scoring) {
    missing.push({
      id: 'website-scan-missing',
      pillar: 'website',
      reason: 'No deterministic website scoring evidence is present.'
    });
  }

  const branch = manifest.googleBusiness?.evidence?.branches?.[0];
  if (!branch || branch.identityIsolation?.qualified !== true) {
    missing.push({
      id: 'google-identity-unqualified',
      pillar: 'google',
      reason: 'No identity-qualified Google Business profile evidence is available.'
    });
  }

  const fb = manifest.facebook?.assessment;
  if (!fb || ['awaiting-evidence', 'not-run'].includes(fb.status)) {
    missing.push({
      id: 'facebook-evidence-missing',
      pillar: 'facebook',
      reason: 'Facebook public-content evidence is not sufficient for scoring.'
    });
  }

  const r = fb?.responseMetrics || {};
  if (r.scoringAnsweredIntentCount > 0 && r.medianResponseMinutes == null) {
    missing.push({
      id: 'facebook-response-time-unverified',
      pillar: 'facebook',
      reason: 'Historic response-time precision is unavailable.'
    });
  }

  return missing;
}

function buildEvidenceIntelligence(manifest = {}) {
  const evidence = [
    ...buildWebsiteEvidence(manifest),
    ...buildGoogleEvidence(manifest),
    ...buildFacebookEvidence(manifest)
  ];

  const contradictions = buildContradictions(manifest);
  const blockedIds = new Set(
    contradictions
      .filter(c => c.blocksPublication)
      .map(c => c.field)
      .filter(Boolean)
  );

  const finalEvidence = evidence.map(item => {
    const field =
      item.id === 'google-rating' ? 'rating' :
      item.id === 'google-review-count' ? 'reviewCount' :
      item.id === 'google-phone' ? 'phone' :
      item.id === 'google-website' ? 'website' :
      null;

    if (item.pillar === 'google' && field && blockedIds.has(field)) {
      return {
        ...item,
        publishable: false,
        reason: `${item.reason} Publication is withheld because contradictory evidence requires human reconciliation.`
      };
    }
    return item;
  });

  const counts = Object.values(TIERS).reduce((acc, tier) => {
    acc[tier] = finalEvidence.filter(x => x.tier === tier).length;
    return acc;
  }, {});

  return {
    schemaVersion: VERSION,
    generatedAt: new Date().toISOString(),
    policy: {
      verified: 'Direct deterministic evidence or identity-qualified direct observation.',
      supported: 'Multiple or strong direct signals with a bounded sampling/coverage caveat.',
      probable: 'Useful inference or AI interpretation that must not be published as clinic fact without corroboration.',
      unknown: 'Evidence is insufficient; unknown remains unknown rather than being converted to zero or a negative fact.'
    },
    evidence: finalEvidence,
    contradictions,
    missingEvidence: buildMissingEvidence(manifest),
    summary: {
      counts,
      publishableCount: finalEvidence.filter(x => x.publishable).length,
      blockedEvidenceCount: finalEvidence.filter(x => !x.publishable && x.tier !== TIERS.UNKNOWN).length,
      contradictionCount: contradictions.length,
      blockingContradictionCount: contradictions.filter(x => x.blocksPublication).length
    }
  };
}

module.exports = {
  VERSION,
  TIERS,
  buildEvidenceIntelligence
};
