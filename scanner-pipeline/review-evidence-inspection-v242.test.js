const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, 'review-owner-report.js');
const source = fs.readFileSync(file, 'utf8');
const { reviewHtml } = require('./review-owner-report');

assert(
  source.includes("routes['GET /api/evidence-files']"),
  'Review Studio must expose a reviewer-only local evidence catalogue.'
);

assert(
  source.includes("pathname.startsWith('/review-evidence/')") ||
  source.includes("pathname.match(/^\\/review-evidence\\/"),
  'Review Studio must safely serve local evidence files.'
);

assert(
  source.includes('safePublicFile(outDir,relative)'),
  'Evidence file serving must stay rooted inside the Audit output directory.'
);

const html = reviewHtml();

assert(
  html.includes('Inspect evidence'),
  'Evidence cards must expose one-click inspection.'
);

assert(
  html.includes('id="evidenceDrawer"'),
  'Evidence inspection drawer is missing.'
);

assert(
  html.includes('openEvidenceInspection'),
  'Evidence inspection browser logic is missing.'
);

assert(
  source.includes("'cache-control':'private, no-store'"),
  'Review evidence must retain private no-store cache handling.'
);

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1])
  .join('\n');

new vm.Script(scripts);

console.log(
  'PASS: V2.4.2 Review Studio one-click evidence inspection, safe local serving and browser-script syntax.'
);
