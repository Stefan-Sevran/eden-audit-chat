const assert=require('assert');
const {parseSurfaceEvidence}=require('./facebook-probe');
const {identityTokenScore,genericMapsShellName}=require('./google-business-probe');
const {scoreFacebook}=require('./facebook');

const fb=parseSurfaceEvidence('Pattaya Smile Dental Clinic 4.3K followers 16 following 98% recommend (297 reviews) Message');
assert.equal(fb.followerCount,4300);
assert.equal(fb.recommendationPercent,98);
assert.equal(fb.recommendationReviewCount,297);
assert.equal(genericMapsShellName('ผลลัพธ์'),true);
assert(identityTokenScore('Pattaya Smile Dental Clinic','Pattaya Smile Dental Clinic - คลินิกทันตกรรมพัทยาสไมล์')>=0.99);
assert(identityTokenScore('Pattaya Smile Dental Clinic','Digital Dental Center Pattaya')<0.6);
const scored=scoreFacebook({destination:{httpReachable:true,landsOnClinicPage:true,genericFacebookDestination:false,wrongPage:false},actions:{messageButtonPresent:true,messageButtonStatus:'observed'},consistency:{brandNameMatches:true},demand:{},response:{}});
assert.equal(scored.scoreScope,'surface-access-and-consistency');
assert.equal(scored.scoreScopeLabel,'Facebook Surface Access');
console.log('robustness-v2215.test.js passed');
