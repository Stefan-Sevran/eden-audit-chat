const assert=require('assert');
const {scoreFacebook,applyFacebookVisualSurfaceEvidence}=require('./facebook');
const {facebookDateCandidate}=require('./facebook-probe');

// Bare years are not defensible activity timestamps.
assert.equal(facebookDateCandidate('2004'),null);
assert.equal(facebookDateCandidate('Yesterday at 10:36'),'Yesterday at 10:36');
assert.equal(facebookDateCandidate('Aug 28, 2026'),'Aug 28, 2026');

// A usable Message path is a legitimate patient conversion route; absence of
// optional Call/Book controls must not be averaged in as failures.
const evidence={
  status:'evidence-collected',
  destination:{httpReachable:true,landsOnClinicPage:true,genericFacebookDestination:false,wrongPage:false},
  actions:{messageButtonPresent:true,bookButtonPresent:false,callButtonPresent:false,whatsappButtonPresent:null},
  consistency:{brandNameMatches:true},
  demand:{comments:[]},response:{},provenance:{collectedAt:new Date().toISOString()}
};
const scored=scoreFacebook(evidence);
assert.equal(scored.components.bookingButtonIntegrity,null);
assert.equal(scored.componentCalibration.actionAccess.raw,100);
assert.equal(scored.components.actionAccess,82); // one positively evidenced action => breadth ceiling
assert.equal(scored.overall,84); // explicitly scoped/coverage-capped surface score

// Vision may repair an obviously bogus bare-year activity label while still
// respecting the normal null-gap-only merge rule for other fields.
const repaired=applyFacebookVisualSurfaceEvidence({
  status:'evidence-collected',page:{lastActivityDate:'2004',phone:null},actions:{},provenance:{}
},{status:'completed',facebookSurfaceEvidence:{
  confidence:'high',observationMode:'authenticated',latestVisibleActivityLabel:'Yesterday at 10:36',phone:'086 334 2004',evidenceScreenshots:['facebook-authenticated-posts']
}});
assert.equal(repaired.evidence.page.lastActivityDate,'Yesterday at 10:36');
assert.equal(repaired.evidence.page.phone,'086 334 2004');
assert(repaired.fieldsApplied.includes('page.lastActivityDate'));

console.log('V2.2.22 Facebook semantic cleanup regression: PASS');
