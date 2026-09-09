const assert = require('node:assert/strict');
const { buildOwnerPatientPathNarrative } = require('./owner-patient-path-narrative-v248');

{
  const result = buildOwnerPatientPathNarrative({
    patientPathQuality: {
      score: 56,
      publishable: true,
      confidence: 'verified',
      coveragePercent: 100,
      routes: [{
        id: 'google-website-path',
        steps: ['Google', 'aggregator/directory', 'external booking provider']
      }],
      mainWeakness: {
        type: 'control',
        title: 'Destination ownership/control is the weakest measured layer',
        reason: 'Too much of the patient journey is controlled by aggregators or third parties.'
      },
      recommendations: [
        'Point the Google Business Profile website action to a clinic-owned landing page rather than an aggregator/directory.'
      ],
      blockingContradictions: []
    },
    evidenceIntelligence: {
      evidence: [
        { tier: 'verified', publishable: true },
        { tier: 'verified', publishable: true },
        { tier: 'supported', publishable: true }
      ]
    }
  });

  assert.equal(result.publishable, true);
  assert.equal(result.clinicFacing.headline, 'Patient path quality: 56/100');
  assert.equal(
    result.clinicFacing.observedPath,
    'Google → aggregator/directory → external booking provider'
  );
  assert(
    result.clinicFacing.executiveSummary.includes('clinic-owned landing page')
  );
  assert.equal(result.reviewerOnly.blockingContradictionCount, 0);
}

{
  const result = buildOwnerPatientPathNarrative({
    patientPathQuality: {
      score: 81,
      publishable: false,
      confidence: 'supported',
      coveragePercent: 67,
      blockingContradictions: [{
        id: 'continuity-google-booking-mismatch',
        blocksPublication: true
      }]
    }
  });

  assert.equal(result.publishable, false);
  assert.equal(result.clinicFacing, null);
  assert.equal(result.reviewerOnly.status, 'withheld');
  assert.equal(result.reviewerOnly.blockingContradictionCount, 1);
  assert(
    result.reviewerOnly.reason.includes('blocking evidence conflicts')
  );
}

{
  const result = buildOwnerPatientPathNarrative({
    patientPathQuality: {
      score: 79,
      publishable: true,
      confidence: 'supported',
      coveragePercent: 67,
      routes: [],
      mainWeakness: {
        type: 'continuity',
        title: 'Cross-channel continuity is the weakest measured layer',
        reason: 'One or more patient entry points do not align cleanly.'
      },
      recommendations: [
        'Standardize patient-facing destinations across Google, Facebook and the clinic website.'
      ],
      blockingContradictions: []
    }
  });

  assert.equal(result.publishable, true);
  assert.equal(result.clinicFacing.scoreBand, 'good');
  assert(
    result.clinicFacing.opening.includes('67% of the scoring model')
  );
}

console.log(
  'PASS: V2.4.8 owner-facing patient-path narrative, consultant-style diagnosis, evidence caveats and publication withholding.'
);
