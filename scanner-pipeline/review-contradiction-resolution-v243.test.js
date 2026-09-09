const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  reviewHtml,
  normalizeEvidenceResolutions,
  validateEvidenceResolutions
} = require('./review-owner-report');

function manifestWithBlockingConflict() {
  return {
    evidenceIntelligence: {
      contradictions: [{
        id: 'google-phone-mismatch',
        title: 'Website and Google phone differ',
        blocksPublication: true
      }]
    }
  };
}

{
  const result = validateEvidenceResolutions(
    manifestWithBlockingConflict(),
    { evidenceResolutions: {} }
  );
  assert.equal(result.ok, false);
  assert.equal(result.unresolved.length, 1);
}

{
  const result = validateEvidenceResolutions(
    manifestWithBlockingConflict(),
    {
      evidenceResolutions: {
        'google-phone-mismatch': {
          decision: 'withheld',
          note: 'The conflicting phone fact is excluded from the clinic-facing Audit.'
        }
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.resolvedCount, 1);
}

{
  const result = validateEvidenceResolutions(
    manifestWithBlockingConflict(),
    {
      evidenceResolutions: {
        'google-phone-mismatch': {
          decision: 'accepted',
          note: 'short'
        }
      }
    }
  );
  assert.equal(result.ok, false);
  assert.match(result.unresolved[0].reason, /short reviewer note/i);
}

{
  const normalized = normalizeEvidenceResolutions({
    good: {
      decision: 'resolved',
      note: 'Verified against the clinic website and current Google profile.'
    },
    bad: {
      decision: 'invented-decision',
      note: 'Should disappear.'
    }
  });

  assert.equal(normalized.good.decision, 'resolved');
  assert.equal('bad' in normalized, false);
}

const source = fs.readFileSync(
  path.join(__dirname, 'review-owner-report.js'),
  'utf8'
);

assert(
  source.includes('validateEvidenceResolutions(manifest,review)'),
  'Server-side publication gate must validate contradiction resolutions.'
);

assert(
  source.includes('evidenceResolutionSummary:resolutionValidation'),
  'Durable publication metadata must retain the resolution summary.'
);

assert(
  source.includes('evidenceResolutions:review.evidenceResolutions||{}'),
  'Durable publication metadata must retain reviewer resolution decisions.'
);

const html = reviewHtml();

assert(
  html.includes('Resolved — sources reconciled'),
  'Reviewer must be able to mark a contradiction resolved.'
);

assert(
  html.includes('Accepted — reviewer accepts a supported position'),
  'Reviewer must be able to explicitly accept a position.'
);

assert(
  html.includes('Withheld — disputed fact excluded from publication'),
  'Reviewer must be able to explicitly withhold a disputed fact.'
);

assert(
  html.includes('Publication remains blocked until resolved.'),
  'Blocking contradiction UI must clearly explain publication state.'
);

assert(
  html.includes('unresolvedBlockingContradictions'),
  'Browser-side publication convenience gate is missing.'
);

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1])
  .join('\n');

new vm.Script(scripts);

console.log(
  'PASS: V2.4.3 contradiction resolution decisions, reviewer notes, durable provenance and authoritative publication gate.'
);
