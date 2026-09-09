const assert = require('node:assert/strict');
const { buildEvidenceIntelligence, TIERS } = require('./evidence-intelligence-v241');

function baseManifest() {
  return {
    digitalFrontDoor: { conventionalWebsite: true },
    summary: {
      bookingCtaVisible: true,
      phoneActionable: true,
      mobileHeroClarity: 82
    },
    scoring: { overall: 81, categories: {} },
    googleBusiness: {
      evidence: {
        branches: [{
          identityIsolation: { qualified: true },
          discovery: {
            matchConfidence: 'high',
            matchBasis: ['name', 'website-domain']
          },
          profile: {
            rating: 4.8,
            reviewCount: 243,
            phone: '038123456',
            website: 'https://clinic.example'
          },
          consistency: {
            brandNameMatches: true,
            websiteMatches: true,
            phoneMatches: true
          },
          provenance: {
            source: 'public-google-maps-browser-probe'
          }
        }]
      },
      assessment: { status: 'scored' }
    },
    facebook: {
      assessment: {
        status: 'scored',
        responseMetrics: {
          scoringObservedIntentComments: 8,
          scoringResponseCoveragePercent: 75,
          scoringAnsweredIntentCount: 6,
          medianResponseMinutes: null
        }
      }
    }
  };
}

{
  const result = buildEvidenceIntelligence(baseManifest());
  const rating = result.evidence.find(x => x.id === 'google-rating');
  const fbTiming = result.evidence.find(x => x.id === 'facebook-response-time');

  assert.equal(rating.tier, TIERS.VERIFIED);
  assert.equal(rating.publishable, true);
  assert.equal(fbTiming.tier, TIERS.UNKNOWN);
  assert.equal(fbTiming.publishable, false);
  assert.equal(result.summary.blockingContradictionCount, 0);
}

{
  const manifest = baseManifest();
  manifest.googleBusiness.evidence.branches[0].consistency.phoneMatches = false;
  manifest.googleBusiness.evidence.branches[0].consistency.websiteMatches = false;

  const result = buildEvidenceIntelligence(manifest);

  assert.equal(result.summary.blockingContradictionCount, 2);

  const phone = result.evidence.find(x => x.id === 'google-phone');
  const website = result.evidence.find(x => x.id === 'google-website');

  assert.equal(phone.publishable, false);
  assert.equal(website.publishable, false);

  assert(result.contradictions.some(x => x.id === 'google-phone-mismatch'));
  assert(result.contradictions.some(x => x.id === 'google-website-domain-mismatch'));
}

{
  const manifest = baseManifest();
  manifest.googleBusiness.evidence.branches[0].identityIsolation.qualified = false;

  const result = buildEvidenceIntelligence(manifest);

  assert.equal(
    result.evidence.some(x => x.id === 'google-rating'),
    false
  );

  assert(
    result.missingEvidence.some(x => x.id === 'google-identity-unqualified')
  );
}

{
  const manifest = baseManifest();
  manifest.aiAuditIntelligence = {
    conflicts: [{
      claimId: 'google-rating',
      severity: 'high',
      humanReviewRequired: true,
      scannerPosition: '4.8',
      visualPosition: '4.7'
    }]
  };

  const result = buildEvidenceIntelligence(manifest);

  assert(
    result.contradictions.some(x => x.id === 'ai-google-rating')
  );
  assert(
    result.summary.blockingContradictionCount >= 1
  );
}

console.log('PASS: V2.4.1 evidence confidence, contradiction detection and publication-confidence gating.');
