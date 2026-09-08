const assert=require('assert');
const {scoreFacebook}=require('./facebook');
const {runFacebookOnlyAudit}=require('./snapshot');
assert.equal(typeof runFacebookOnlyAudit,'function');
const evidence={schemaVersion:'2.1.8',status:'evidence-collected',destination:{httpReachable:true,landsOnClinicPage:true,genericFacebookDestination:false,wrongPage:false},actions:{messageButtonPresent:true},consistency:{brandNameMatches:true,phoneMatchesWebsite:true},demand:{comments:[]},response:{},provenance:{collectedAt:new Date().toISOString()}};
const scored=scoreFacebook(evidence);
assert.equal(scored.evidenceCoverage.knownComponents,3);
assert.equal(scored.overall,84);
console.log('facebook probe v2.1.8 facebook-only regression ok');
