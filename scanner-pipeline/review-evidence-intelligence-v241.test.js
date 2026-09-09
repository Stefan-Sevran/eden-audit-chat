const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, 'review-owner-report.js');
const source = fs.readFileSync(file, 'utf8');
const { reviewHtml } = require('./review-owner-report');

assert(
  source.includes('evidenceIntelligence:manifest.evidenceIntelligence||null'),
  'Review Studio /api/state must expose reviewer-only evidenceIntelligence.'
);

const html = reviewHtml();

assert(
  html.includes('Evidence confidence'),
  'Review Studio must render the Evidence confidence panel.'
);

assert(
  html.includes('id="evidenceIntel"'),
  'Evidence intelligence container is missing.'
);

assert(
  html.includes('renderEvidenceIntelligence'),
  'Evidence intelligence renderer is missing.'
);

assert(
  html.includes('reconcile before publish'),
  'Blocking contradiction warning is missing.'
);

assert(
  html.includes('This panel is not included in the clinic-facing Audit.'),
  'Reviewer-only boundary copy is missing.'
);

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1])
  .join('\n');

new vm.Script(scripts);

console.log(
  'PASS: V2.4.1 Review Studio evidence confidence, contradiction visibility and reviewer-only boundary.'
);
