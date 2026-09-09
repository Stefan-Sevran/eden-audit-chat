const VERSION = '2.4.8';

function sentence(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function humanScoreBand(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'not yet measurable';
  if (n >= 85) return 'strong';
  if (n >= 70) return 'good';
  if (n >= 55) return 'mixed';
  if (n >= 40) return 'weak';
  return 'high-friction';
}

function normalizeRoute(route) {
  const steps = Array.isArray(route?.steps) ? route.steps.filter(Boolean) : [];
  return steps.length ? steps.join(' → ') : null;
}

function pickPrimaryRoute(patientPath = {}) {
  const routes = Array.isArray(patientPath.routes) ? patientPath.routes : [];
  if (!routes.length) return null;

  const priority = [
    'google-website-path',
    'google-direct-booking-path',
    'facebook-website-path',
    'facebook-direct-booking-path'
  ];

  for (const id of priority) {
    const match = routes.find(x => x.id === id);
    if (match) return match;
  }

  return routes[0] || null;
}

function buildOwnerPatientPathNarrative(manifest = {}) {
  const patientPath = manifest.patientPathQuality || {};
  const intelligence = manifest.evidenceIntelligence || {};

  const score = patientPath.score ?? null;
  const publishable = patientPath.publishable === true;
  const confidence = patientPath.confidence || 'unknown';
  const coverage = patientPath.coveragePercent ?? null;

  const blocking = Array.isArray(patientPath.blockingContradictions)
    ? patientPath.blockingContradictions
    : [];

  const primaryRoute = pickPrimaryRoute(patientPath);
  const observedPath = normalizeRoute(primaryRoute);

  const weakness = patientPath.mainWeakness || {};
  const recommendations = Array.isArray(patientPath.recommendations)
    ? patientPath.recommendations.filter(Boolean)
    : [];

  const verifiedEvidenceCount = Array.isArray(intelligence.evidence)
    ? intelligence.evidence.filter(x => x.tier === 'verified' && x.publishable === true).length
    : null;

  if (!publishable) {
    return {
      schemaVersion: VERSION,
      publishable: false,
      confidence,
      score,
      coveragePercent: coverage,
      clinicFacing: null,
      reviewerOnly: {
        status: 'withheld',
        reason:
          blocking.length > 0
            ? 'Patient-path narrative withheld because one or more blocking evidence conflicts remain unresolved.'
            : 'Patient-path narrative withheld because evidence coverage is insufficient for clinic-facing publication.',
        blockingContradictionCount: blocking.length,
        blockingContradictionIds: blocking.map(x => x.id).filter(Boolean),
        evidenceCoveragePercent: coverage
      }
    };
  }

  const scoreBand = humanScoreBand(score);
  const scoreText =
    Number.isFinite(Number(score))
      ? `${Math.round(Number(score))}/100`
      : 'not yet measurable';

  const introParts = [];

  if (observedPath) {
    introParts.push(
      `The strongest observed patient path currently runs ${observedPath}`
    );
  } else {
    introParts.push(
      'The Audit verified enough of the clinic’s patient journey to identify a clear conversion pattern'
    );
  }

  if (Number.isFinite(Number(score))) {
    introParts.push(
      `The overall patient-path quality is ${scoreText}, which indicates a ${scoreBand} experience`
    );
  }

  if (Number.isFinite(Number(coverage))) {
    introParts.push(
      `${Math.round(Number(coverage))}% of the scoring model is supported by measured evidence`
    );
  }

  const opening = sentence(introParts.join('. '));

  const weaknessTitle = weakness.title || 'No dominant weakness was identified';
  const weaknessReason = weakness.reason || '';

  const diagnosis = sentence(
    weaknessReason
      ? `${weaknessTitle}. ${weaknessReason}`
      : weaknessTitle
  );

  const recommendedPrimary =
    recommendations[0] ||
    'Preserve the strongest clinic-owned path and continue monitoring cross-channel consistency.';

  const recommendation = sentence(recommendedPrimary);

  const whyItMattersParts = [];

  if (weakness.type === 'control') {
    whyItMattersParts.push(
      'When patient intent is handed to an aggregator, social platform or unclassified third party, the clinic gives up part of the conversion environment, analytics and brand experience'
    );
  } else if (weakness.type === 'continuity') {
    whyItMattersParts.push(
      'When Google, Facebook, website and booking destinations do not line up cleanly, patients can be diverted into stale or inconsistent journeys'
    );
  } else if (weakness.type === 'booking') {
    whyItMattersParts.push(
      'Friction late in the booking journey matters because these patients have already shown strong appointment intent'
    );
  } else {
    whyItMattersParts.push(
      'A patient path performs best when each public channel carries intent cleanly into a clinic-controlled or purpose-built booking destination'
    );
  }

  const whyItMatters = sentence(whyItMattersParts.join(' '));

  const evidenceLineParts = [];
  if (confidence) {
    evidenceLineParts.push(`Confidence: ${confidence}`);
  }
  if (Number.isFinite(Number(coverage))) {
    evidenceLineParts.push(`measured coverage: ${Math.round(Number(coverage))}%`);
  }
  if (Number.isFinite(Number(verifiedEvidenceCount))) {
    evidenceLineParts.push(`${verifiedEvidenceCount} verified publishable evidence items in the wider Audit`);
  }

  const evidenceNote = evidenceLineParts.length
    ? sentence(evidenceLineParts.join('; '))
    : null;

  const executiveSummary =
    `${opening} ${diagnosis} ${recommendation}`.replace(/\s+/g, ' ').trim();

  return {
    schemaVersion: VERSION,
    publishable: true,
    confidence,
    score,
    coveragePercent: coverage,
    clinicFacing: {
      headline:
        Number.isFinite(Number(score))
          ? `Patient path quality: ${Math.round(Number(score))}/100`
          : 'Patient path quality',
      scoreBand,
      observedPath,
      mainWeakness: weaknessTitle,
      opening,
      diagnosis,
      whyItMatters,
      recommendation,
      executiveSummary,
      evidenceNote
    },
    reviewerOnly: {
      status: 'ready',
      sourceVersions: [
        'patient-path-quality-v247',
        'destination-control-v246',
        'cross-channel-continuity-v245',
        'journey-evidence-v244'
      ],
      blockingContradictionCount: 0
    }
  };
}

module.exports = {
  VERSION,
  humanScoreBand,
  pickPrimaryRoute,
  buildOwnerPatientPathNarrative
};
