const VERSION = '2.4.4';

function pct(n, d) {
  if (!Number.isFinite(Number(n)) || !Number.isFinite(Number(d)) || Number(d) <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((Number(n) / Number(d)) * 100)));
}

function buildJourneyEvidence(manifest = {}) {
  const booking = manifest.bookingFlow || {};
  const website = manifest.summary || {};

  if (!booking.analyzed) {
    return {
      schemaVersion: VERSION,
      status: 'not-analyzed',
      confidence: 'unknown',
      publishable: false,
      reason: booking.reason || 'No safely navigable booking/consultation journey was analyzed.',
      resourceModel: 'derived-from-existing-scan',
      claims: [],
      contradictions: [],
      coverage: {
        observedStates: 0,
        advertisedStates: null,
        verifiedCoveragePercent: null
      }
    };
  }

  const measured = booking.measurementCompleteness || {};
  const observedStates = Number(
    booking.distinctStateCount ??
    booking.traversedStageCount ??
    booking.steps?.length ??
    0
  );
  const advertisedStates = Number(
    measured.advertisedVisibleStepCount ??
    booking.advertisedVisibleStepCount ??
    booking.detectedStepCount ??
    1
  );
  const verifiedFormStates = Number(
    measured.verifiedFormStepCount ??
    booking.verifiedFormStepCount ??
    booking.traversedStepCount ??
    0
  );

  const screenshots = (booking.steps || [])
    .map(step => step?.evidenceScreenshot)
    .filter(Boolean);

  const observedMechanics = Boolean(
    booking.calendarVisible ||
    booking.timePickerVisible ||
    Number(
      booking.totalLogicalFieldCount ||
      booking.totalFieldCount ||
      booking.fieldCount ||
      0
    ) > 0 ||
    (booking.transitions || []).length > 0 ||
    (booking.steps || []).some(step =>
      step?.finalActionVisible ||
      step?.fieldCount > 0 ||
      step?.calendarVisible ||
      step?.timePickerVisible
    )
  );

  const finalActionVisible = Boolean(
    (booking.steps || []).some(step => step?.finalActionVisible) ||
    booking.stoppedBeforeSubmission
  );

  const reachedPreSubmitBoundary = Boolean(
    booking.stoppedBeforeSubmission && finalActionVisible
  );

  const writeSafetyVerified =
    booking.writeRequestsBlocked === true;

  const fullyTraversed =
    measured.fullyTraversed === true;

  const unknownLaterBurden =
    measured.unknownLaterStepBurden === true ||
    booking.traversalBlocked === true ||
    (advertisedStates > 0 && verifiedFormStates < advertisedStates);

  const claims = [];

  function claim(id, title, value, confidence, publishable, reason, sources = []) {
    claims.push({
      id,
      title,
      value,
      confidence,
      publishable: Boolean(publishable),
      reason,
      sources
    });
  }

  claim(
    'journey-entry',
    'Booking journey entry reached',
    booking.targetUrl || null,
    'verified',
    true,
    'The scanner navigated to the detected booking/consultation destination.',
    ['booking-target', 'browser-navigation']
  );

  claim(
    'journey-observed-states',
    'Distinct booking states observed',
    observedStates,
    observedStates > 0 ? 'verified' : 'unknown',
    observedStates > 0,
    observedStates > 0
      ? 'Distinct interactive states were directly observed and fingerprinted.'
      : 'No distinct interactive booking state was verified.',
    ['booking-state-fingerprints']
  );

  claim(
    'journey-field-burden',
    'Logical patient questions observed',
    Number(booking.totalLogicalFieldCount ?? booking.totalFieldCount ?? 0),
    observedMechanics ? 'verified' : 'unknown',
    observedMechanics,
    observedMechanics
      ? 'Logical patient questions were deduplicated across safely traversed booking states.'
      : 'The scanner did not verify enough booking mechanics to publish field burden.',
    ['booking-fields']
  );

  claim(
    'journey-date-time-access',
    'Date/time selection detected',
    Boolean(booking.calendarVisible || booking.timePickerVisible),
    observedMechanics ? 'verified' : 'unknown',
    observedMechanics,
    'Based only on date/time controls directly observed in safely reached states.',
    ['booking-controls']
  );

  claim(
    'journey-pre-submit-boundary',
    'Final booking action reached without submission',
    reachedPreSubmitBoundary,
    reachedPreSubmitBoundary ? 'verified' : 'unknown',
    reachedPreSubmitBoundary,
    reachedPreSubmitBoundary
      ? 'The scanner reached a final booking action and intentionally stopped before submission.'
      : 'A final pre-submit boundary was not safely verified; this must not be described as completed booking.',
    ['booking-final-action', ...screenshots]
  );

  claim(
    'journey-write-safety',
    'Live write requests blocked during Audit traversal',
    writeSafetyVerified,
    writeSafetyVerified ? 'verified' : 'unknown',
    writeSafetyVerified,
    writeSafetyVerified
      ? 'POST/PUT/PATCH/DELETE requests were blocked so the Audit could inspect without creating a real booking.'
      : 'Write-request protection was not explicitly verified.',
    ['network-write-guard']
  );

  if (booking.externalProvider) {
    claim(
      'journey-provider-handoff',
      'Booking hands off to an external provider',
      booking.finalUrl || booking.targetUrl || true,
      'verified',
      true,
      'The observed booking destination is on a different host from the clinic website.',
      ['booking-navigation']
    );
  }

  if (booking.manualConfirmationDetected) {
    claim(
      'journey-manual-confirmation',
      'Staff/manual confirmation required',
      true,
      'verified',
      true,
      'The booking surface explicitly indicates staff review or manual confirmation.',
      ['booking-copy']
    );
  }

  if (booking.loginRequired) {
    claim(
      'journey-login-required',
      'Account/login required',
      true,
      'verified',
      true,
      'A login/account requirement was directly detected in the booking journey.',
      ['booking-copy', 'booking-controls']
    );
  }

  if (booking.paymentDetected) {
    claim(
      'journey-payment-required',
      'Payment/deposit step detected before submission',
      true,
      'verified',
      true,
      'Required payment/deposit indicators were directly detected in safely reached booking states.',
      ['booking-controls']
    );
  }

  if (booking.captchaDetected) {
    claim(
      'journey-captcha',
      'CAPTCHA/human verification detected',
      true,
      'verified',
      true,
      'A CAPTCHA or human-verification element was directly observed.',
      ['booking-controls']
    );
  }

  if (booking.thirdPartyAdsDetected) {
    claim(
      'journey-third-party-ads',
      'Third-party advertising detected on booking surface',
      true,
      'verified',
      true,
      'Visible third-party advertising was directly observed on the booking surface.',
      ['booking-page']
    );
  }

  if (unknownLaterBurden) {
    claim(
      'journey-later-burden',
      'Later booking-step burden',
      null,
      'unknown',
      false,
      'The scanner could not safely verify every advertised or implied later state. Later-step burden remains unknown rather than being estimated.',
      ['booking-measurement-boundary']
    );
  }

  const contradictions = [];

  function conflict(id, severity, title, reason, blocksPublication = false) {
    contradictions.push({
      id,
      severity,
      title,
      reason,
      blocksPublication
    });
  }

  if (booking.bookingJourneyScore != null && !observedMechanics) {
    conflict(
      'journey-score-without-mechanics',
      'high',
      'Journey score exists without verified booking mechanics',
      'A publishable end-to-end score must not exist when no fields, controls, final action, or state transition were observed.',
      true
    );
  }

  if (reachedPreSubmitBoundary && booking.stoppedBeforeSubmission !== true) {
    conflict(
      'journey-submit-boundary-inconsistent',
      'high',
      'Final-action evidence conflicts with the pre-submit safety boundary',
      'The Audit may only claim final-action reach when it also records that it intentionally stopped before submission.',
      true
    );
  }

  if (
    booking.manualConfirmationDetected === true &&
    Number(booking.subScores?.confirmationImmediacy) >= 80
  ) {
    conflict(
      'journey-manual-confirmation-score-conflict',
      'medium',
      'Manual confirmation conflicts with a high confirmation-immediacy diagnostic score',
      'The diagnostic subscore should reflect the verified manual-confirmation requirement.',
      false
    );
  }

  const coveragePercent =
    advertisedStates > 0
      ? pct(Math.min(verifiedFormStates, advertisedStates), advertisedStates)
      : null;

  const confidence =
    reachedPreSubmitBoundary && writeSafetyVerified
      ? 'verified'
      : fullyTraversed && observedMechanics
        ? 'supported'
        : observedMechanics
          ? 'supported'
          : 'unknown';

  return {
    schemaVersion: VERSION,
    status: observedMechanics ? 'measured' : 'entry-only',
    confidence,
    publishable: observedMechanics,
    resourceModel: 'derived-from-existing-scan',
    safetyBoundary: {
      writeRequestsBlocked: writeSafetyVerified,
      stoppedBeforeSubmission: Boolean(booking.stoppedBeforeSubmission),
      realBookingCreated: false,
      claimPolicy: reachedPreSubmitBoundary
        ? 'May state that the final booking action was reached; must not state that a booking was submitted or confirmed.'
        : 'Must not claim end-to-end booking completion.'
    },
    coverage: {
      observedStates,
      advertisedStates: advertisedStates || null,
      verifiedFormStates,
      verifiedCoveragePercent: coveragePercent,
      fullyTraversed,
      unknownLaterBurden
    },
    continuity: {
      clinicBookingCtaVisible: Boolean(website.bookingCtaVisible),
      targetUrl: booking.targetUrl || null,
      finalUrl: booking.finalUrl || null,
      externalProvider: Boolean(booking.externalProvider),
      preSubmitBoundaryReached: reachedPreSubmitBoundary
    },
    friction: {
      journeyScore: booking.bookingJourneyScore ?? null,
      entryScore: booking.bookingEntryScore ?? null,
      frictionScore: booking.frictionScore ?? null,
      logicalFieldCount: booking.totalLogicalFieldCount ?? booking.totalFieldCount ?? null,
      logicalRequiredFieldCount: booking.totalLogicalRequiredFieldCount ?? booking.totalRequiredFieldCount ?? null,
      manualConfirmation: Boolean(booking.manualConfirmationDetected),
      loginRequired: Boolean(booking.loginRequired),
      paymentDetected: Boolean(booking.paymentDetected),
      captchaDetected: Boolean(booking.captchaDetected),
      thirdPartyAdsDetected: Boolean(booking.thirdPartyAdsDetected)
    },
    screenshots,
    claims,
    contradictions,
    summary: {
      verifiedClaims: claims.filter(x => x.confidence === 'verified').length,
      supportedClaims: claims.filter(x => x.confidence === 'supported').length,
      unknownClaims: claims.filter(x => x.confidence === 'unknown').length,
      blockingContradictions: contradictions.filter(x => x.blocksPublication).length
    }
  };
}

module.exports = {
  VERSION,
  buildJourneyEvidence
};
