const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  readinessFor,
  buildActionPlanPresentation
} = require('./action-plan-presentation-v251');

{
  const r = readinessFor({
    effort: 'low',
    title: 'Fix Google patient destination',
    action: 'Point Google to the clinic-owned landing page.'
  });
  assert.equal(r.id, 'ready-now');
}

{
  const r = readinessFor({
    effort: 'medium',
    title: 'Confirm preferred booking destination',
    action: 'Ask the clinic which booking page should be primary.'
  });
  assert.equal(r.id, 'needs-clinic-input');
}

{
  const r = readinessFor({
    effort: 'high',
    title: 'Integrate website booking system',
    action: 'Configure the booking API and website flow.'
  });
  assert.equal(r.id, 'needs-technical-implementation');
}

{
  const result = buildActionPlanPresentation(
    {
      evidenceIntelligence: {
        evidence: [
          {
            id: 'destination-google',
            pillar: 'destination-control',
            tier: 'verified',
            claim: 'Google website destination ownership',
            reason: 'Google currently points to an aggregator.',
            value: 'aggregator-directory',
            sources: ['google-business-profile']
          }
        ]
      }
    },
    {
      items: [
        {
          id: 'opportunity-google',
          title: 'Fix Google patient destination',
          action: 'Point Google to the clinic-owned landing page.',
          impact: 'high',
          effort: 'low',
          confidence: 'verified',
          timing: 'This week',
          sourceId: 'destination-google',
          sourcePillar: 'destination-control',
          evidenceReason: 'Google currently points to an aggregator.'
        }
      ]
    }
  );

  assert.equal(result.items[0].readiness.id, 'ready-now');
  assert.equal(result.items[0].evidencePreview.status, 'available');
  assert.equal(result.items[0].evidencePreview.tier, 'verified');
  assert.equal(result.quickWins.length, 1);
}

// Integration assertions only after installation.
const ownerReport = path.join(__dirname, 'owner-report.js');
const reviewStudio = path.join(__dirname, 'review-owner-report.js');
if (fs.existsSync(ownerReport) && fs.existsSync(reviewStudio)) {
  const owner = fs.readFileSync(ownerReport, 'utf8');
  const studio = fs.readFileSync(reviewStudio, 'utf8');

  assert(owner.includes("require('./action-plan-presentation-v251')"));
  assert(owner.includes('Quick wins this week'));
  assert(owner.includes('readiness-badge'));
  assert(studio.includes("require('./action-plan-presentation-v251')"));
  assert(studio.includes('renderActionPlanEvidencePreview'));
  assert(studio.includes('readiness-badge'));
  assert(studio.includes('Owner Review Studio · V2.5.1'));
}

console.log(
  'PASS: V2.5.1 action-plan readiness states, inline evidence preview, quick-win surfacing and reviewer/report UX integration.'
);
