const assert = require('node:assert/strict');
const { buildJourneyEvidence } = require('./journey-evidence-v244');

{
  const result = buildJourneyEvidence({
    summary: { bookingCtaVisible: true },
    bookingFlow: {
      analyzed: true,
      targetUrl: 'https://book.example/',
      finalUrl: 'https://book.example/',
      bookingCompletionVerified: true,
      bookingJourneyScore: 84,
      bookingEntryScore: 84,
      frictionScore: 16,
      stoppedBeforeSubmission: true,
      writeRequestsBlocked: true,
      totalLogicalFieldCount: 7,
      totalLogicalRequiredFieldCount: 5,
      steps: [
        { finalActionVisible: false, evidenceScreenshot: '/tmp/state-1.png' },
        { finalActionVisible: true, evidenceScreenshot: '/tmp/state-2.png' }
      ],
      transitions: [{ status: 'meaningful-change' }],
      measurementCompleteness: {
        fullyTraversed: true,
        advertisedVisibleStepCount: 2,
        verifiedFormStepCount: 2,
        unknownLaterStepBurden: false
      }
    }
  });

  assert.equal(result.status, 'measured');
  assert.equal(result.confidence, 'verified');
  assert.equal(result.safetyBoundary.realBookingCreated, false);
  assert.equal(result.continuity.preSubmitBoundaryReached, true);
  assert.equal(result.coverage.verifiedCoveragePercent, 100);
  assert(
    result.claims.some(
      x => x.id === 'journey-pre-submit-boundary' &&
           x.publishable === true
    )
  );
}

{
  const result = buildJourneyEvidence({
    bookingFlow: {
      analyzed: true,
      targetUrl: 'https://book.example/',
      bookingCompletionVerified: true,
      bookingJourneyScore: 90,
      writeRequestsBlocked: true,
      steps: [],
      transitions: [],
      measurementCompleteness: {
        fullyTraversed: false,
        advertisedVisibleStepCount: 3,
        verifiedFormStepCount: 0,
        unknownLaterStepBurden: true
      }
    }
  });

  assert(
    result.contradictions.some(
      x => x.id === 'journey-score-without-mechanics' &&
           x.blocksPublication === true
    )
  );
  assert(
    result.claims.some(
      x => x.id === 'journey-later-burden' &&
           x.confidence === 'unknown' &&
           x.publishable === false
    )
  );
}

{
  const result = buildJourneyEvidence({
    bookingFlow: {
      analyzed: false,
      reason: 'No navigable booking URL.'
    }
  });

  assert.equal(result.status, 'not-analyzed');
  assert.equal(result.confidence, 'unknown');
  assert.equal(result.publishable, false);
}

console.log(
  'PASS: V2.4.4 journey evidence coverage, pre-submit safety boundary, unknown-state handling and contradiction gating.'
);
