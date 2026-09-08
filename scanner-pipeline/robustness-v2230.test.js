const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { scoreFacebook, buildCrossChannelIntegrity } = require('./facebook');

// A technical probe failure must stay unknown, never become an observed zero.
const failed = {
  status: 'probe-failed',
  destination: { httpReachable: false, landsOnClinicPage: null, genericFacebookDestination: null, wrongPage: null },
  actions: {}, consistency: {}, page: {}, probe: {}
};
const assessment = scoreFacebook(failed);
assert.equal(assessment.status, 'insufficient-evidence');
assert.equal(assessment.components.destinationIntegrity, null);
assert.equal(assessment.patientConversionPath.entryActions.message, null);
const cross = buildCrossChannelIntegrity({ facebookAssessment: assessment, facebookEvidence: failed, googleBusinessAssessment: { branchCount: 1 } });
assert.equal(cross.facebookDestinationIntegrity, null);

// Regression for the V2.2.29 browser-context crash: interactionSignals must be
// created inside feedCardForAnchor before it is stored in best evidence.
const probeSource = fs.readFileSync(path.join(__dirname, 'facebook-probe.js'), 'utf8');
const fnStart = probeSource.indexOf('const feedCardForAnchor=(a,i)=>');
assert(fnStart >= 0, 'feedCardForAnchor not found');
const fnEnd = probeSource.indexOf('const cardMap=new Map()', fnStart);
const fn = probeSource.slice(fnStart, fnEnd);
const decl = fn.indexOf('const interactionSignals=');
const use = fn.indexOf('best={score,height:r.height,text,contentUrls,ariaLabels,interactionSignals}');
assert(decl >= 0, 'interactionSignals must be declared inside feedCardForAnchor browser callback');
assert(use > decl, 'interactionSignals must be declared before use');

console.log('V2.2.30 robustness regression passed');
