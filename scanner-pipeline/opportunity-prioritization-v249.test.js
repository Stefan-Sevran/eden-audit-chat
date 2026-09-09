const assert = require('node:assert/strict');
const {
  priorityScore,
  buildOpportunityPrioritization
} = require('./opportunity-prioritization-v249');

{
  assert.equal(
    priorityScore({
      impact: 'high',
      effort: 'low',
      confidence: 'verified'
    }),
    100
  );
}

{
  const result = buildOpportunityPrioritization({
    evidenceIntelligence: {
      evidence: [
        {
          id: 'destination-control-google-website',
          pillar: 'destination-control',
          claim: 'Google website destination ownership',
          tier: 'verified',
          publishable: true,
          value: 'aggregator-directory',
          reason: 'Destination matches a known aggregator/directory.'
        },
        {
          id: 'continuity-facebook-phone',
          pillar: 'cross-channel-continuity',
          claim: 'Facebook phone matches a website phone',
          tier: 'verified',
          publishable: true,
          value: false,
          reason: 'Facebook phone differs from the website.'
        }
      ],
      contradictions: []
    },
    patientPathQuality: {
      confidence: 'verified',
      mainWeakness: {
        type: 'control',
        title: 'Destination ownership/control is the weakest measured layer',
        reason: 'Too much of the journey is externally controlled.'
      },
      blockingContradictions: []
    },
    ownerPatientPathNarrative: {
      publishable: true
    }
  });

  assert.equal(result.publishable, true);
  assert(result.clinicFacing);
  assert.equal(result.clinicFacing.priorities[0].title, 'Fix Google patient destination');
  assert.equal(result.clinicFacing.priorities[0].impact, 'high');
  assert.equal(result.clinicFacing.priorities[0].effort, 'low');
  assert.equal(result.clinicFacing.priorities[0].confidence, 'verified');
}

{
  const result = buildOpportunityPrioritization({
    evidenceIntelligence: {
      evidence: [],
      contradictions: [
        {
          id: 'continuity-google-booking-mismatch',
          pillar: 'cross-channel-continuity',
          title: 'Google booking destination mismatch',
          reason: 'Observed destinations conflict.',
          severity: 'high',
          blocksPublication: true
        }
      ]
    },
    patientPathQuality: {
      confidence: 'verified',
      mainWeakness: {
        type: 'continuity',
        title: 'Cross-channel continuity is the weakest measured layer',
        reason: 'One or more channels do not align.'
      },
      blockingContradictions: [
        {
          id: 'continuity-google-booking-mismatch',
          blocksPublication: true
        }
      ]
    }
  });

  assert(
    result.reviewerOnly.withheldOpportunities.some(
      x => x.sourceId === 'continuity-google-booking-mismatch'
    )
  );
  assert(
    !result.opportunities.some(
      x => x.sourceId === 'continuity-google-booking-mismatch'
    )
  );
}

{
  const result = buildOpportunityPrioritization({
    evidenceIntelligence: {
      evidence: [],
      contradictions: []
    },
    patientPathQuality: {
      confidence: 'unknown',
      mainWeakness: {
        type: 'unknown',
        title: 'Not measurable'
      },
      blockingContradictions: []
    }
  });

  assert.equal(result.publishable, false);
  assert.equal(result.clinicFacing, null);
}

console.log(
  'PASS: V2.4.9 opportunity prioritization, impact/effort/confidence ranking, deterministic scoring and blocking-conflict withholding.'
);
