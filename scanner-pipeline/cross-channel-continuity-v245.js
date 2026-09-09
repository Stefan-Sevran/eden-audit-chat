const VERSION = '2.4.5';

function hostOf(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function normalizePhone(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .replace(/^66(?=\d{9}$)/, '0')
    .replace(/^63(?=\d{10}$)/, '0');
}

function sameHost(a, b) {
  const x = hostOf(a), y = hostOf(b);
  return Boolean(x && y && x === y);
}

function continuityState(value, observed = true) {
  if (!observed) return 'unknown';
  return value === true ? 'aligned' : value === false ? 'misaligned' : 'unknown';
}

function buildCrossChannelContinuity(manifest = {}) {
  const auditedUrl =
    manifest.reviewedUrl ||
    manifest.finalUrl ||
    manifest.url ||
    null;
  const auditedHost = hostOf(auditedUrl);

  const google = manifest.googleBusiness?.evidence?.branches?.[0] || {};
  const facebook =
    manifest.facebook?.probe ||
    manifest.facebook?.evidence ||
    manifest.facebook ||
    {};
  const journey = manifest.journeyEvidence || {};
  const booking = manifest.bookingFlow || {};

  const gQualified = google.identityIsolation?.qualified === true;
  const gWebsite = google.profile?.website || google.conversionDestination?.targetUrl || null;
  const gWebsiteFinal = google.conversionDestination?.finalUrl || gWebsite || null;
  const gBooking = google.bookingDestination?.targetUrl || null;
  const gBookingFinal = google.bookingDestination?.finalUrl || gBooking || null;
  const gPhone = google.profile?.phone || null;

  const fbPage = facebook.page || {};
  const fbActions = facebook.actions || {};
  const fbConsistency = facebook.consistency || {};
  const fbWebsite = fbPage.websiteUrl || null;
  const fbBookTarget = fbActions.bookButtonTarget || null;
  const fbBookFinal = fbActions.bookButtonFinalUrl || fbBookTarget || null;
  const fbPhone = fbPage.phone || null;

  const journeyTarget = journey.continuity?.targetUrl || booking.targetUrl || null;
  const journeyFinal = journey.continuity?.finalUrl || booking.finalUrl || null;

  const claims = [];
  const contradictions = [];
  const gaps = [];

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

  function gap(id, title, reason) {
    gaps.push({ id, title, reason });
  }

  // Google -> website continuity
  if (gQualified && gWebsite) {
    const aligned = sameHost(gWebsiteFinal, auditedUrl);
    claim(
      'continuity-google-website',
      'Google website link reaches the audited clinic domain',
      aligned,
      'verified',
      true,
      aligned
        ? 'The identity-qualified Google website destination resolves to the audited clinic domain.'
        : 'The identity-qualified Google website destination resolves to a different domain.',
      ['google-business-profile', 'google-destination-probe', 'audited-website']
    );

    if (!aligned) {
      conflict(
        'continuity-google-website-mismatch',
        'high',
        'Google website link does not resolve to the audited clinic domain',
        'Patients entering from Google may be handed to a stale, unrelated, or unintended destination. Human reconciliation is required before publishing this as a clinic fact.',
        true,
        [gWebsiteFinal, auditedUrl].filter(Boolean)
      );
    }
  } else {
    gap(
      'continuity-google-website-unverified',
      'Google → website continuity',
      gQualified
        ? 'No Google website destination was observed.'
        : 'No identity-qualified Google profile was available.'
    );
  }

  // Facebook -> website continuity
  if (fbWebsite && auditedUrl) {
    const aligned = sameHost(fbWebsite, auditedUrl);
    claim(
      'continuity-facebook-website',
      'Facebook website link matches the audited clinic domain',
      aligned,
      'verified',
      true,
      aligned
        ? 'The Facebook page website link points to the audited clinic domain.'
        : 'The Facebook page website link points to a different domain.',
      ['facebook-page', 'audited-website']
    );

    if (!aligned) {
      conflict(
        'continuity-facebook-website-mismatch',
        'high',
        'Facebook website link differs from the audited clinic domain',
        'A patient moving from Facebook to the clinic website may be sent to a stale or unintended destination.',
        true,
        [fbWebsite, auditedUrl].filter(Boolean)
      );
    }
  } else {
    gap(
      'continuity-facebook-website-unverified',
      'Facebook → website continuity',
      'No Facebook website link was observed or no audited website was available.'
    );
  }

  // Google booking -> observed journey continuity
  if (gQualified && gBooking) {
    if (journeyTarget || journeyFinal) {
      const googleEffectiveBooking =
        gBookingFinal || gBooking;

      const journeyEffectiveDestination =
        journeyFinal || journeyTarget;

      const aligned =
        sameHost(
          googleEffectiveBooking,
          journeyEffectiveDestination
        );

      claim(
        'continuity-google-booking',
        'Google booking action lands in the observed clinic booking journey',
        aligned,
        'verified',
        true,
        aligned
          ? 'The Google booking destination and the safely observed booking journey share the same destination host.'
          : 'The Google booking destination does not match the safely observed clinic booking journey.',
        ['google-booking-destination', 'journey-evidence-v244']
      );

      if (!aligned) {
        conflict(
          'continuity-google-booking-mismatch',
          'high',
          'Google booking destination differs from the observed clinic booking journey',
          'Google appointment intent may be routed into a different booking system or stale destination than the clinic website journey.',
          true,
          [gBookingFinal, journeyFinal || journeyTarget].filter(Boolean)
        );
      }
    } else {
      gap(
        'continuity-google-booking-journey-unverified',
        'Google → booking journey continuity',
        'A Google booking destination was observed, but no safely measured website booking journey is available for comparison.'
      );
    }
  }

  // Facebook booking -> observed journey continuity
  if (fbBookTarget) {
    if (journeyTarget || journeyFinal) {
      const facebookEffectiveBooking =
        fbBookFinal || fbBookTarget;

      const journeyEffectiveDestination =
        journeyFinal || journeyTarget;

      const aligned =
        sameHost(
          facebookEffectiveBooking,
          journeyEffectiveDestination
        );

      claim(
        'continuity-facebook-booking',
        'Facebook booking action lands in the observed clinic booking journey',
        aligned,
        fbActions.bookButtonWorks === true ? 'verified' : 'supported',
        true,
        aligned
          ? 'The Facebook booking destination matches the safely observed clinic booking journey.'
          : 'The Facebook booking destination points to a different host from the safely observed clinic booking journey.',
        ['facebook-book-action', 'journey-evidence-v244']
      );

      if (!aligned) {
        conflict(
          'continuity-facebook-booking-mismatch',
          'high',
          'Facebook booking destination differs from the observed clinic booking journey',
          'Patient intent from Facebook may be routed into a different or stale appointment path.',
          true,
          [fbBookFinal, journeyFinal || journeyTarget].filter(Boolean)
        );
      }
    } else {
      gap(
        'continuity-facebook-booking-journey-unverified',
        'Facebook → booking journey continuity',
        'A Facebook booking action was observed, but no safely measured website booking journey is available for comparison.'
      );
    }
  }

  // Contact-number continuity across visible patient surfaces.
  const websitePhones = (manifest.phoneDisplayedNumbers || manifest.summary?.phoneDisplayedNumbers || [])
    .map(normalizePhone)
    .filter(Boolean);
  const normalizedGoogle = normalizePhone(gPhone);
  const normalizedFacebook = normalizePhone(fbPhone);

  if (websitePhones.length && normalizedGoogle) {
    const aligned = websitePhones.some(p =>
      p === normalizedGoogle ||
      p.endsWith(normalizedGoogle) ||
      normalizedGoogle.endsWith(p)
    );
    claim(
      'continuity-google-phone',
      'Google phone matches a website phone',
      aligned,
      'verified',
      true,
      aligned
        ? 'The Google contact number matches a number observed on the clinic website.'
        : 'The Google contact number differs from the numbers observed on the clinic website.',
      ['google-business-profile', 'audited-website']
    );
  }

  if (websitePhones.length && normalizedFacebook) {
    const aligned = websitePhones.some(p =>
      p === normalizedFacebook ||
      p.endsWith(normalizedFacebook) ||
      normalizedFacebook.endsWith(p)
    );
    claim(
      'continuity-facebook-phone',
      'Facebook phone matches a website phone',
      aligned,
      'verified',
      true,
      aligned
        ? 'The Facebook contact number matches a number observed on the clinic website.'
        : 'The Facebook contact number differs from the numbers observed on the clinic website.',
      ['facebook-page', 'audited-website']
    );

    if (!aligned) {
      conflict(
        'continuity-facebook-phone-mismatch',
        'high',
        'Facebook and website expose different clinic phone numbers',
        'Different patient-facing phone numbers may be legitimate, but the discrepancy should be reconciled before it is treated as a clinic fact.',
        true,
        [fbPhone, ...(manifest.phoneDisplayedNumbers || [])].filter(Boolean)
      );
    }
  }

  // Facebook action connectivity: useful positives, but absence stays unknown.
  const fbActionMap = [
    ['message', fbActions.messageButtonPresent, fbActions.messageButtonStatus],
    ['whatsapp', fbActions.whatsappButtonPresent, fbActions.whatsappButtonStatus],
    ['call', fbActions.callButtonPresent, fbActions.callButtonStatus],
    ['book', fbActions.bookButtonPresent, fbActions.bookButtonStatus]
  ];

  for (const [kind, present, status] of fbActionMap) {
    if (present === true) {
      claim(
        `continuity-facebook-${kind}-action`,
        `Facebook ${kind} action available`,
        true,
        'verified',
        true,
        `A visible ${kind} action was directly observed on the clinic Facebook surface.`,
        ['facebook-action-probe']
      );
    } else if (status && status !== 'observed') {
      gap(
        `continuity-facebook-${kind}-unknown`,
        `Facebook ${kind} action`,
        `The action was not verified as available. Status: ${status}. Absence is not converted into a negative fact.`
      );
    }
  }

  const channelMatrix = {
    website: {
      host: auditedHost,
      observed: Boolean(auditedHost)
    },
    google: {
      identityQualified: gQualified,
      websiteDestination: gWebsiteFinal,
      bookingDestination: gBookingFinal,
      phone: gPhone
    },
    facebook: {
      websiteDestination: fbWebsite,
      bookingDestination: fbBookFinal,
      phone: fbPhone,
      actions: {
        message: fbActions.messageButtonPresent === true,
        whatsapp: fbActions.whatsappButtonPresent === true,
        call: fbActions.callButtonPresent === true,
        booking: fbActions.bookButtonPresent === true
      }
    },
    bookingJourney: {
      targetUrl: journeyTarget,
      finalUrl: journeyFinal,
      confidence: journey.confidence || 'unknown'
    }
  };

  const verifiedClaims = claims.filter(x => x.confidence === 'verified');
  const alignedClaims = claims.filter(x => x.value === true);
  const comparedClaims = claims.filter(x => typeof x.value === 'boolean');

  const score = comparedClaims.length
    ? Math.round((alignedClaims.length / comparedClaims.length) * 100)
    : null;

  return {
    schemaVersion: VERSION,
    generatedAt: new Date().toISOString(),
    resourceModel: 'derived-from-existing-channel-probes',
    policy: {
      positiveObservation: 'Observed continuity can be published with provenance.',
      absence: 'Not observed remains unknown rather than being treated as broken.',
      mismatch: 'High-impact channel mismatches require human reconciliation before publication.'
    },
    channelMatrix,
    claims,
    contradictions,
    gaps,
    summary: {
      continuityScore: score,
      comparedConnections: comparedClaims.length,
      alignedConnections: alignedClaims.length,
      verifiedClaims: verifiedClaims.length,
      contradictionCount: contradictions.length,
      blockingContradictionCount: contradictions.filter(x => x.blocksPublication).length,
      evidenceGapCount: gaps.length
    }
  };
}

module.exports = {
  VERSION,
  hostOf,
  normalizePhone,
  buildCrossChannelContinuity
};
