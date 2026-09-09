const VERSION = '2.4.6';

const KNOWN_AGGREGATOR_HOSTS = new Set([
  'cebudentalclinic.com'
]);

const SOCIAL_HOSTS = new Set([
  'facebook.com',
  'm.facebook.com',
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'linkedin.com',
  'www.linkedin.com'
]);

const KNOWN_BOOKING_PROVIDER_PATTERNS = [
  /booksy\./i,
  /calendly\./i,
  /setmore\./i,
  /simplybook\./i,
  /zocdoc\./i,
  /doctolib\./i,
  /acuityscheduling\./i,
  /cliniko\./i,
  /nexhealth\./i,
  /tabby\./i,
  /appointy\./i,
  /fresha\./i
];

function hostOf(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function registrableLike(host) {
  if (!host) return null;
  const parts = String(host).split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const maybeCountrySecondLevel = parts.slice(-2).join('.');
  const countrySuffixes = new Set(['co.uk','com.au','co.th','com.ph','co.jp','com.sg','co.nz']);
  if (countrySuffixes.has(maybeCountrySecondLevel)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function sameRegistrableDomain(a, b) {
  return Boolean(a && b && registrableLike(a) === registrableLike(b));
}

function classifyDestination(url, context = {}) {
  const host = hostOf(url);
  const auditedHost = hostOf(context.auditedUrl);
  const clinicOwnedHosts = new Set(
    [auditedHost, ...(context.clinicOwnedHosts || [])]
      .map(x => hostOf(x) || x)
      .filter(Boolean)
  );

  if (!host) {
    return {
      type: 'unknown',
      host: null,
      controlLevel: 'unknown',
      confidence: 'unknown',
      reason: 'No valid destination URL was available.'
    };
  }

  const clinicOwned =
    [...clinicOwnedHosts].some(owned => sameRegistrableDomain(host, owned));

  if (clinicOwned) {
    return {
      type: 'clinic-owned',
      host,
      controlLevel: 'high',
      confidence: 'verified',
      reason: 'Destination shares the clinic-controlled registrable domain.'
    };
  }

  if (KNOWN_AGGREGATOR_HOSTS.has(host)) {
    return {
      type: 'aggregator-directory',
      host,
      controlLevel: 'low',
      confidence: 'verified',
      reason: 'Destination matches a known clinic/dental directory or aggregator host.'
    };
  }

  if (SOCIAL_HOSTS.has(host)) {
    return {
      type: 'social-platform',
      host,
      controlLevel: 'medium',
      confidence: 'verified',
      reason: 'Destination is a social platform controlled primarily by the platform rather than the clinic.'
    };
  }

  if (KNOWN_BOOKING_PROVIDER_PATTERNS.some(rx => rx.test(host))) {
    return {
      type: 'external-booking-provider',
      host,
      controlLevel: 'medium',
      confidence: 'supported',
      reason: 'Destination host matches a common external scheduling/booking-provider pattern.'
    };
  }

  return {
    type: 'external-third-party',
    host,
    controlLevel: 'unknown',
    confidence: 'supported',
    reason: 'Destination is external to the clinic-owned domain, but its exact role is not known.'
  };
}

function buildDestinationControlIntelligence(manifest = {}) {
  const continuity = manifest.crossChannelContinuity || {};
  const matrix = continuity.channelMatrix || {};
  const auditedUrl =
    manifest.reviewedUrl ||
    manifest.finalUrl ||
    manifest.url ||
    (matrix.website?.host ? `https://${matrix.website.host}` : null);

  const destinations = [];
  const contradictions = [];
  const claims = [];
  const gaps = [];

  function addDestination(id, channel, purpose, url, source) {
    if (!url) {
      gaps.push({
        id: `${id}-missing`,
        title: `${channel} ${purpose} destination`,
        reason: 'No destination URL was observed.'
      });
      return;
    }

    const classification = classifyDestination(url, { auditedUrl });
    destinations.push({
      id,
      channel,
      purpose,
      url,
      source,
      ...classification
    });
  }

  addDestination(
    'google-website',
    'Google',
    'website',
    matrix.google?.websiteDestination,
    'cross-channel-continuity-v245'
  );

  addDestination(
    'google-booking',
    'Google',
    'booking',
    matrix.google?.bookingDestination,
    'cross-channel-continuity-v245'
  );

  addDestination(
    'facebook-website',
    'Facebook',
    'website',
    matrix.facebook?.websiteDestination,
    'cross-channel-continuity-v245'
  );

  addDestination(
    'facebook-booking',
    'Facebook',
    'booking',
    matrix.facebook?.bookingDestination,
    'cross-channel-continuity-v245'
  );

  addDestination(
    'website-booking',
    'Website',
    'booking',
    matrix.bookingJourney?.finalUrl || matrix.bookingJourney?.targetUrl,
    'journey-evidence-v244'
  );

  function claim(id, title, value, confidence, publishable, reason, sources = []) {
    claims.push({
      id, title, value, confidence,
      publishable: Boolean(publishable),
      reason,
      sources
    });
  }

  function conflict(id, severity, title, reason, blocksPublication = false, positions = []) {
    contradictions.push({
      id, severity, title, reason,
      blocksPublication: Boolean(blocksPublication),
      positions
    });
  }

  const primaryPatientEntry = destinations.filter(d =>
    d.purpose === 'website' || d.purpose === 'booking'
  );

  for (const d of primaryPatientEntry) {
    claim(
      `control-${d.id}`,
      `${d.channel} ${d.purpose} destination ownership`,
      d.type,
      d.confidence,
      true,
      d.reason,
      [d.source]
    );

    if (d.type === 'aggregator-directory' && d.purpose === 'website') {
      conflict(
        `control-${d.id}-aggregator-primary`,
        'high',
        `${d.channel} website destination is an aggregator/directory`,
        'The patient-facing website action lands on a third-party aggregator instead of a clinic-controlled website. This may reduce control over trust, conversion, analytics and booking continuity.',
        false,
        [d.url]
      );
    }

    if (d.type === 'social-platform' && d.purpose === 'website') {
      conflict(
        `control-${d.id}-social-primary`,
        'medium',
        `${d.channel} website destination is a social platform rather than a clinic-owned website`,
        'The clinic may be relying on a platform-controlled surface instead of a clinic-controlled conversion destination.',
        false,
        [d.url]
      );
    }

    if (d.type === 'external-third-party' && d.purpose === 'website') {
      conflict(
        `control-${d.id}-external-primary`,
        'medium',
        `${d.channel} website destination is external to the clinic-owned domain`,
        'The external destination may be legitimate, but the clinic does not appear to control the primary patient path end-to-end. Human review should classify the provider before making a stronger claim.',
        false,
        [d.url]
      );
    }
  }

  const googleWebsite = destinations.find(d => d.id === 'google-website');
  const facebookWebsite = destinations.find(d => d.id === 'facebook-website');
  const websiteBooking = destinations.find(d => d.id === 'website-booking');

  if (googleWebsite && googleWebsite.type === 'clinic-owned') {
    claim(
      'control-google-owned-entry',
      'Google sends patients directly to a clinic-controlled website',
      true,
      'verified',
      true,
      'The Google website destination is on the clinic-controlled domain.',
      ['cross-channel-continuity-v245']
    );
  }

  if (facebookWebsite && facebookWebsite.type === 'clinic-owned') {
    claim(
      'control-facebook-owned-entry',
      'Facebook sends patients directly to a clinic-controlled website',
      true,
      'verified',
      true,
      'The Facebook website destination is on the clinic-controlled domain.',
      ['cross-channel-continuity-v245']
    );
  }

  if (websiteBooking) {
    if (websiteBooking.type === 'external-booking-provider') {
      claim(
        'control-external-booking-handoff',
        'Clinic-owned website hands booking to an external booking provider',
        true,
        'supported',
        true,
        'The booking handoff is external but appears consistent with a dedicated scheduling provider.',
        ['journey-evidence-v244']
      );
    } else if (websiteBooking.type === 'aggregator-directory') {
      conflict(
        'control-booking-to-aggregator',
        'high',
        'Clinic booking journey hands patients to an aggregator/directory',
        'The clinic website’s booking path appears to hand patient intent to a directory/aggregator rather than a clinic-controlled or dedicated scheduling destination.',
        true,
        [websiteBooking.url]
      );
    }
  }

  const ownedCount = destinations.filter(d => d.type === 'clinic-owned').length;
  const externalBookingCount = destinations.filter(d => d.type === 'external-booking-provider').length;
  const aggregatorCount = destinations.filter(d => d.type === 'aggregator-directory').length;
  const socialCount = destinations.filter(d => d.type === 'social-platform').length;
  const unknownExternalCount = destinations.filter(d => d.type === 'external-third-party').length;

  const controlScore =
    destinations.length === 0
      ? null
      : Math.round(
          destinations.reduce((sum, d) => {
            if (d.type === 'clinic-owned') return sum + 100;
            if (d.type === 'external-booking-provider') return sum + 70;
            if (d.type === 'social-platform') return sum + 45;
            if (d.type === 'aggregator-directory') return sum + 25;
            return sum + 35;
          }, 0) / destinations.length
        );

  return {
    schemaVersion: VERSION,
    generatedAt: new Date().toISOString(),
    policy: {
      ownership: 'Clinic-owned destinations receive the strongest control classification.',
      externalBooking: 'Dedicated external booking providers are not treated as inherently bad; they represent delegated control.',
      aggregator: 'Aggregator/directory destinations are treated as lower-control patient paths.',
      unknown: 'Unrecognized external hosts are not guessed; they remain external-third-party until reviewed.'
    },
    auditedUrl,
    destinations,
    claims,
    contradictions,
    gaps,
    summary: {
      controlScore,
      destinationCount: destinations.length,
      clinicOwnedCount: ownedCount,
      externalBookingProviderCount: externalBookingCount,
      aggregatorDirectoryCount: aggregatorCount,
      socialPlatformCount: socialCount,
      unknownExternalCount,
      blockingContradictionCount: contradictions.filter(x => x.blocksPublication).length
    }
  };
}

module.exports = {
  VERSION,
  hostOf,
  classifyDestination,
  buildDestinationControlIntelligence
};
