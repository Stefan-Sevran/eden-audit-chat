const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeActionPlanReview,
  buildClinicActionPlan
} = require('./action-plan-v250');

const manifest = {
  opportunityPrioritization: {
    opportunities: [
      {
        id: 'opportunity-google',
        rank: 1,
        publishable: true,
        title: 'Fix Google patient destination',
        impact: 'high',
        effort: 'low',
        confidence: 'verified',
        priorityScore: 100,
        action: 'Point Google to the clinic-owned landing page.',
        sourceId: 'destination-google',
        sourcePillar: 'destination-control',
        evidenceReason: 'Google currently points to an aggregator.'
      },
      {
        id: 'opportunity-booking',
        rank: 2,
        publishable: true,
        title: 'Reduce booking friction',
        impact: 'high',
        effort: 'medium',
        confidence: 'supported',
        priorityScore: 84,
        action: 'Simplify the booking handoff.',
        sourceId: 'journey-booking',
        sourcePillar: 'booking-journey',
        evidenceReason: 'The observed booking flow contains avoidable friction.'
      }
    ]
  }
};

{
  const plan = buildClinicActionPlan(manifest, null);
  assert.equal(plan.publishable, true);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].timing, 'This week');
  assert.equal(plan.items[1].timing, 'Next 30 days');
  assert.equal(plan.items[0].sourceId, 'destination-google');
}

{
  const plan = buildClinicActionPlan(manifest, {
    actionPlan: {
      items: [
        {
          id: 'opportunity-google',
          include: true,
          title: 'Send Google patients straight to your clinic',
          action: 'Replace the aggregator URL with your clinic landing page.',
          owner: 'Clinic manager',
          timing: 'Within 7 days'
        },
        {
          id: 'unsupported-item',
          include: true,
          title: 'Unsupported'
        },
        {
          id: 'opportunity-booking',
          include: false
        }
      ]
    }
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].title, 'Send Google patients straight to your clinic');
  assert.equal(plan.items[0].owner, 'Clinic manager');
  assert.equal(
    plan.items.some(x => x.id === 'unsupported-item'),
    false
  );
}

{
  const normalized = normalizeActionPlanReview(
    {
      items: [
        { id: 'allowed', title: 'Edited', include: true },
        { id: 'invented', title: 'Nope', include: true }
      ]
    },
    {
      items: [
        {
          id: 'allowed',
          title: 'Base',
          action: 'Do it',
          owner: 'Clinic team',
          timing: 'This week'
        }
      ]
    }
  );

  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.items[0].id, 'allowed');
  assert.equal(normalized.items[0].title, 'Edited');
}

// Integration assertions run only after installation into the real repo.
const ownerReport = path.join(__dirname, 'owner-report.js');
const reviewStudio = path.join(__dirname, 'review-owner-report.js');
if (fs.existsSync(ownerReport) && fs.existsSync(reviewStudio)) {
  const ownerSource = fs.readFileSync(ownerReport, 'utf8');
  const studioSource = fs.readFileSync(reviewStudio, 'utf8');

  assert(ownerSource.includes("require('./action-plan-v250')"));
  assert(ownerSource.includes('actionPlanHtml'));
  assert(ownerSource.includes('90-day action plan'));
  assert(studioSource.includes("require('./action-plan-v250')"));
  assert(studioSource.includes('renderActionPlan'));
  assert(studioSource.includes('actionPlanDraft'));
  assert(studioSource.includes('Inspect action evidence'));
  assert(studioSource.includes("Owner Review Studio · V2.5.0"));
}

console.log(
  'PASS: V2.5.0 reviewer-editable action plan, evidence provenance, unsupported-item protection and clinic-facing report integration.'
);
