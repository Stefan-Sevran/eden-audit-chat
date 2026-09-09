const assert = require('node:assert/strict');
const { buildPatientPathQuality } = require('./patient-path-quality-v247');

{
  const result = buildPatientPathQuality({
    crossChannelContinuity: {
      summary: { continuityScore: 50 },
      contradictions: []
    },
    destinationControl: {
      summary: { controlScore: 40 },
      contradictions: [],
      destinations: [
        {
          id: 'google-website',
          type: 'aggregator-directory'
        },
        {
          id: 'website-booking',
          type: 'external-booking-provider'
        }
      ]
    },
    journeyEvidence: {
      friction: { journeyScore: 80 },
      contradictions: []
    }
  });

  assert.equal(result.score, 56);
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.confidence, 'verified');
  assert.equal(result.publishable, true);
  assert(
    result.recommendations.some(x =>
      x.includes('Google Business Profile')
    )
  );
  assert.equal(
    result.routes[0].steps.join(' → '),
    'Google → aggregator/directory → external booking provider'
  );
}

{
  const result = buildPatientPathQuality({
    crossChannelContinuity: {
      summary: { continuityScore: 70 },
      contradictions: []
    },
    destinationControl: {
      summary: { controlScore: null },
      contradictions: []
    },
    journeyEvidence: {
      friction: { journeyScore: 90 },
      contradictions: []
    }
  });

  assert.equal(result.score, 79);
  assert.equal(result.coveragePercent, 67);
  assert.equal(result.confidence, 'supported');
  assert.equal(result.publishable, true);
  assert(
    result.gaps.some(x => x.id === 'patient-path-control-missing')
  );
}

{
  const result = buildPatientPathQuality({
    crossChannelContinuity: {
      summary: { continuityScore: 80 },
      contradictions: [{
        id: 'blocking-path-conflict',
        title: 'Booking destination mismatch',
        reason: 'Mismatch.',
        blocksPublication: true
      }]
    },
    destinationControl: {
      summary: { controlScore: 70 },
      contradictions: []
    },
    journeyEvidence: {
      friction: { journeyScore: 90 },
      contradictions: []
    }
  });

  assert.equal(result.publishable, false);
  assert.equal(result.blockingContradictions.length, 1);
  assert.equal(
    result.claims.find(x => x.id === 'patient-path-quality-score').publishable,
    false
  );
}

{
  const result = buildPatientPathQuality({
    crossChannelContinuity: {
      summary: { continuityScore: 70 },
      contradictions: []
    }
  });

  assert.equal(result.coveragePercent, 33);
  assert.equal(result.confidence, 'unknown');
  assert.equal(result.publishable, false);
}

console.log(
  'PASS: V2.4.7 patient-path weighted quality score, evidence coverage, route diagnosis, recommendation generation and publication gating.'
);
