const assert=require('assert');
const {classifyFacebookContentOwnership}=require('./facebook-content-quality');
const {scoreFacebook}=require('./facebook');
function state(bodyText,score=10){return {bodyText,score};}
const evidence={
 page:{pageName:'Your Dentist Pattaya Dental clinic',handle:'YourDentistPattaya',followerCount:28000},
 destination:{landsOnClinicPage:true,genericFacebookDestination:false,wrongPage:false},
 consistency:{brandNameMatches:true},
 actions:{messageButtonPresent:null,callButtonPresent:null,bookButtonPresent:null,whatsappButtonPresent:null},
 probe:{probeDiagnostics:{commentPostDiscovery:{postsFound:4,postsInspected:4,renderAttempts:4,statesRetained:4,variablePosts:0,perPostDiagnostics:[
  {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/1',states:[state("Your Dentist Pattaya Dental clinic's post Your Dentist Pattaya Dental clinic 7 August · Original clinic update All reactions: 2 1 comments")]},
  {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/2',states:[state("Your Dentist Pattaya Dental clinic's post Your Dentist Pattaya Dental clinic 7 August · https://www.facebook.com/share/p/XYZ/ External Dental Source 7 August · Shared item All reactions: 1")]},
  {sourceUrl:'https://www.facebook.com/permalink.php?id=999',states:[state("External Dental Source's post External Dental Source · Follow Viral thing 229K reactions 3.2K comments")]},
  {sourceUrl:'https://www.facebook.com/reel/123',states:[state('No reliable visible author here')]}
 ]}}}
};
const q=classifyFacebookContentOwnership(evidence);
assert.equal(q.records[0].contentType,'clinic-original');
assert.equal(q.records[1].contentType,'clinic-published-share');
assert.equal(q.records[2].contentType,'external-only');
assert.equal(q.records[3].contentType,'unresolved');
assert.equal(q.clinicOriginalPosts,1);
assert.equal(q.clinicPublishedShares,1);
assert.equal(q.externalOnlyPosts,1);
assert.equal(q.unresolvedPosts,1);
assert.equal(q.records[1].engagement.reactionCount,1);
assert.equal(q.records[2].engagement.reactionCount,null);
const scored=scoreFacebook(evidence);
assert.equal(scored.patientConversionPath.entryActions.message,null);
assert.equal(scored.patientConversionPath.entryActions.call,null);
assert.equal(scored.patientConversionPath.entryActions.book,null);
assert.equal(scored.patientConversionPath.status,'entry-point-evidence-unknown');
console.log('V2.2.25 robustness test passed');
