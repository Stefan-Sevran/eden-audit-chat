const VERSION = '2.4.7';

function clampScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function isKnownScore(value) {
  return value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(Number(value));
}

function weightedScore(parts = []) {
  const usable = parts.filter(
    x => isKnownScore(x.score) && Number(x.weight) > 0
  );
  if (!usable.length) return null;

  const totalWeight = usable.reduce((sum, x) => sum + Number(x.weight), 0);
  const total = usable.reduce(
    (sum, x) => sum + Number(x.score) * Number(x.weight),
    0
  );
  return clampScore(total / totalWeight);
}

function destinationLabel(destination) {
  if (!destination) return null;
  const map = {
    'clinic-owned': 'clinic-owned site',
    'aggregator-directory': 'aggregator/directory',
    'social-platform': 'social platform',
    'external-booking-provider': 'external booking provider',
    'external-third-party': 'external third party',
    'unknown': 'unknown destination'
  };
  return map[destination.type] || destination.type || null;
}

function buildObservedRoute(manifest = {}) {
  const control = manifest.destinationControl || {};
  const destinations = Array.isArray(control.destinations)
    ? control.destinations
    : [];

  const googleWebsite = destinations.find(x => x.id === 'google-website');
  const googleBooking = destinations.find(x => x.id === 'google-booking');
  const facebookWebsite = destinations.find(x => x.id === 'facebook-website');
  const facebookBooking = destinations.find(x => x.id === 'facebook-booking');
  const websiteBooking = destinations.find(x => x.id === 'website-booking');

  const candidates = [];

  if (googleWebsite) {
    const steps = ['Google', destinationLabel(googleWebsite)];
    if (websiteBooking) steps.push(destinationLabel(websiteBooking));
    candidates.push({
      id: 'google-website-path',
      channel: 'Google',
      steps: steps.filter(Boolean),
      evidenceIds: [googleWebsite.id, websiteBooking?.id].filter(Boolean)
    });
  }

  if (googleBooking) {
    candidates.push({
      id: 'google-direct-booking-path',
      channel: 'Google',
      steps: ['Google', destinationLabel(googleBooking)].filter(Boolean),
      evidenceIds: [googleBooking.id]
    });
  }

  if (facebookWebsite) {
    const steps = ['Facebook', destinationLabel(facebookWebsite)];
    if (websiteBooking) steps.push(destinationLabel(websiteBooking));
    candidates.push({
      id: 'facebook-website-path',
      channel: 'Facebook',
      steps: steps.filter(Boolean),
      evidenceIds: [facebookWebsite.id, websiteBooking?.id].filter(Boolean)
    });
  }

  if (facebookBooking) {
    candidates.push({
      id: 'facebook-direct-booking-path',
      channel: 'Facebook',
      steps: ['Facebook', destinationLabel(facebookBooking)].filter(Boolean),
      evidenceIds: [facebookBooking.id]
    });
  }

  return candidates;
}

function chooseWeakness(components, manifest = {}) {
  const blocking = [
    ...(manifest.crossChannelContinuity?.contradictions || []),
    ...(manifest.destinationControl?.contradictions || []),
    ...(manifest.journeyEvidence?.contradictions || [])
  ].filter(x => x.blocksPublication === true);

  if (blocking.length) {
    return {
      type: 'blocking-evidence-conflict',
      title: blocking[0].title || 'Patient-path evidence conflict',
      reason: blocking[0].reason || '',
      sourceId: blocking[0].id || null
    };
  }

  const available = components
    .filter(x => isKnownScore(x.score))
    .sort((a, b) => Number(a.score) - Number(b.score));

  const weakest = available[0];
  if (!weakest) {
    return {
      type: 'unknown',
      title: 'Patient-path weakness not yet measurable',
      reason: 'Insufficient verified evidence is available to identify a dominant weakness.'
    };
  }

  if (weakest.id === 'continuity') {
    return {
      type: 'continuity',
      title: 'Cross-channel continuity is the weakest measured layer',
      reason: 'One or more patient entry points do not align cleanly with the clinic website or booking journey.'
    };
  }

  if (weakest.id === 'control') {
    return {
      type: 'control',
      title: 'Destination ownership/control is the weakest measured layer',
      reason: 'Too much of the patient journey is controlled by aggregators, social platforms or unclassified third parties.'
    };
  }

  return {
    type: 'booking',
    title: 'Booking journey quality is the weakest measured layer',
    reason: 'The observed booking journey has the greatest measured friction or weakest completion support.'
  };
}

function buildRecommendation(manifest = {}, weakness = {}) {
  const destinations = manifest.destinationControl?.destinations || [];
  const googleWebsite = destinations.find(x => x.id === 'google-website');
  const facebookWebsite = destinations.find(x => x.id === 'facebook-website');
  const websiteBooking = destinations.find(x => x.id === 'website-booking');

  const recommendations = [];

  if (googleWebsite?.type === 'aggregator-directory') {
    recommendations.push(
      'Point the Google Business Profile website action to a clinic-owned landing page rather than an aggregator/directory.'
    );
  }

  if (facebookWebsite?.type === 'aggregator-directory') {
    recommendations.push(
      'Point the Facebook website action to a clinic-owned landing page rather than an aggregator/directory.'
    );
  }

  if (googleWebsite?.type === 'social-platform' || facebookWebsite?.type === 'social-platform') {
    recommendations.push(
      'Use a clinic-owned landing page as the primary patient destination, while keeping social profiles as supporting channels.'
    );
  }

  if (websiteBooking?.type === 'aggregator-directory') {
    recommendations.push(
      'Move appointment intent from the clinic website into a clinic-controlled or dedicated booking flow instead of an aggregator.'
    );
  }

  if (websiteBooking?.type === 'external-booking-provider') {
    recommendations.push(
      'Keep the dedicated booking provider if it converts well, but preserve clinic branding, analytics and return-path continuity around the handoff.'
    );
  }

  if (weakness.type === 'continuity') {
    recommendations.push(
      'Standardize patient-facing website, booking and contact destinations across Google, Facebook and the clinic website.'
    );
  }

  if (weakness.type === 'booking') {
    recommendations.push(
      'Reduce booking friction in the safely observed journey: fewer unnecessary questions, clearer date/time selection and a stronger pre-submit confirmation path.'
    );
  }

  if (!recommendations.length) {
    recommendations.push(
      'Preserve the strongest clinic-owned path and continue verifying that Google, Facebook and booking destinations remain aligned.'
    );
  }

  return [...new Set(recommendations)];
}

function buildPatientPathQuality(manifest = {}) {
  const continuityScore = clampScore(
    manifest.crossChannelContinuity?.summary?.continuityScore
  );
  const controlScore = clampScore(
    manifest.destinationControl?.summary?.controlScore
  );
  const journeyScore = clampScore(
    manifest.journeyEvidence?.friction?.journeyScore
  );

  const components = [
    {
      id: 'continuity',
      title: 'Cross-channel continuity',
      score: continuityScore,
      weight: 40,
      source: 'cross-channel-continuity-v245'
    },
    {
      id: 'control',
      title: 'Destination ownership & control',
      score: controlScore,
      weight: 30,
      source: 'destination-control-v246'
    },
    {
      id: 'booking',
      title: 'Booking journey quality',
      score: journeyScore,
      weight: 30,
      source: 'journey-evidence-v244'
    }
  ];

  const measuredComponents = components.filter(
    x => isKnownScore(x.score)
  );

  const score = weightedScore(components);
  const coveragePercent = Math.round(
    (measuredComponents.length / components.length) * 100
  );

  const routes = buildObservedRoute(manifest);
  const weakness = chooseWeakness(components, manifest);
  const recommendations = buildRecommendation(manifest, weakness);

  const blockingContradictions = [
    ...(manifest.crossChannelContinuity?.contradictions || []),
    ...(manifest.destinationControl?.contradictions || []),
    ...(manifest.journeyEvidence?.contradictions || [])
  ].filter(x => x.blocksPublication === true);

  const confidence =
    measuredComponents.length === 3
      ? 'verified'
      : measuredComponents.length === 2
        ? 'supported'
        : 'unknown';

  const publishable =
    measuredComponents.length >= 2 &&
    blockingContradictions.length === 0;

  const claims = [
    {
      id: 'patient-path-quality-score',
      title: 'Patient path quality score',
      value: score,
      confidence,
      publishable,
      reason: publishable
        ? 'Score combines measured continuity, destination-control and booking-journey components using fixed weights.'
        : 'Score is withheld until at least two components are measured and blocking evidence conflicts are resolved.',
      sources: measuredComponents.map(x => x.source)
    },
    {
      id: 'patient-path-main-weakness',
      title: 'Main patient-path weakness',
      value: weakness.title,
      confidence: measuredComponents.length >= 2 ? 'supported' : 'unknown',
      publishable: publishable && weakness.type !== 'unknown',
      reason: weakness.reason,
      sources: measuredComponents.map(x => x.source)
    }
  ];

  const gaps = components
    .filter(x => !isKnownScore(x.score))
    .map(x => ({
      id: `patient-path-${x.id}-missing`,
      title: `${x.title} score unavailable`,
      reason: `The ${x.title.toLowerCase()} component remains unmeasured and is excluded from the weighted score rather than treated as zero.`
    }));

  return {
    schemaVersion: VERSION,
    generatedAt: new Date().toISOString(),
    methodology: {
      weights: {
        continuity: 40,
        control: 30,
        booking: 30
      },
      unknownPolicy: 'Unknown components are excluded from the weighted calculation and reduce confidence/coverage rather than lowering the score.',
      publicationPolicy: 'Clinic-facing patient-path score requires at least two measured components and no unresolved blocking evidence conflict.'
    },
    score,
    confidence,
    publishable,
    coveragePercent,
    components,
    routes,
    mainWeakness: weakness,
    recommendations,
    claims,
    gaps,
    blockingContradictions,
    clinicFacingSummary: {
      score,
      scoreLabel: score == null ? 'Not yet measurable' : `${score}/100`,
      mainWeakness: weakness.title,
      observedPath: routes[0]?.steps?.join(' → ') || null,
      recommendedPath: recommendations[0] || null,
      caveat:
        publishable
          ? null
          : 'Withheld from publication until evidence coverage and contradiction requirements are satisfied.'
    }
  };
}

module.exports = {
  VERSION,
  clampScore,
  isKnownScore,
  weightedScore,
  buildObservedRoute,
  buildPatientPathQuality
};
