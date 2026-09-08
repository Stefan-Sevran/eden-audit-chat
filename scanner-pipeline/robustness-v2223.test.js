const assert=require('assert');
const {classifyFacebookContentOwnership}=require('./facebook-content-quality');
const {scoreFacebook}=require('./facebook');
const evidence={status:'evidence-collected',page:{pageName:'Your Dentist Pattaya Dental clinic',handle:'YourDentistPattaya',followerCount:28000},destination:{httpReachable:true,landsOnClinicPage:true,genericFacebookDestination:false,wrongPage:false},actions:{messageButtonPresent:true,callButtonPresent:true},consistency:{brandNameMatches:true},demand:{comments:[]},probe:{probeDiagnostics:{commentPostDiscovery:{postsFound:4,postsInspected:4,perPostDiagnostics:[
 {sourceUrl:'https://facebook.com/YourDentistPattaya/posts/1',states:[{score:10,bodyText:'Your Dentist Pattaya Dental clinic · Follow New implant offer 1 reactions 0 comments 0 shares'}]},
 {sourceUrl:'https://facebook.com/permalink.php?id=other',states:[{score:9,bodyText:'Dental Institute Thailand · Follow Root canal education 229K reactions 3.2K comments 26K shares'}]},
 {sourceUrl:'https://facebook.com/YourDentistPattaya/posts/3',states:[{score:8,bodyText:'Your Dentist Pattaya Dental clinic · Follow Whitening promo 2 reactions 0 comments 0 shares'}]},
 {sourceUrl:'https://facebook.com/YourDentistPattaya/posts/4',states:[{score:8,bodyText:'Your Dentist Pattaya Dental clinic · Follow Braces promo 1 reactions 0 comments 0 shares'}]}
],evidenceAccumulation:{renderAttempts:4,statesRetained:4,variablePosts:0}}}},provenance:{collectedAt:new Date().toISOString()}};
const q=classifyFacebookContentOwnership(evidence);
assert.equal(q.sampledPosts,4);assert.equal(q.clinicAuthoredPosts,3);assert.equal(q.clinicSharedExternalPosts,1);assert.equal(q.engagementQuality.reliableEngagementSamples,3);assert.equal(q.engagementQuality.signal,'very-low-visible-engagement');
const scored=scoreFacebook(evidence);assert.equal(scored.contentOwnership.clinicSharedExternalPosts,1);assert.equal(scored.engagementQuality.signal,'very-low-visible-engagement');assert.equal(scored.patientConversionPath.entryActions.message,true);assert.equal(scored.patientConversionPath.entryActions.call,true);
console.log('V2.2.23 Facebook content ownership + engagement quality regression: PASS');
const {buildActionEngine}=require('./cross-channel-action-engine');
const actions=buildActionEngine({facebook:{assessment:scored},aiAuditIntelligence:{facebookVisualAssessments:{}}});
assert(actions.actions.some(a=>a.id==='facebook-owned-content-engagement'));
