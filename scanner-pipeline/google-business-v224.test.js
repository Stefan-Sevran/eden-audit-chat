const assert=require('assert');
const {firstCandidate,identityMatch}=require('./google-business-probe');
const {scoreBranch}=require('./google-business');

const direct='https://maps.app.goo.gl/QD8SkASiFsa55McSA';
assert.equal(firstCandidate({identity:{clinicName:'Digital Dental Pattaya',location:'Pattaya'},discovery:{googleMapsUrls:[direct]}}),direct,'direct maps.app.goo.gl link must beat generic search fallback');

const id=identityMatch({expectedName:'Digital Dental Pattaya',observedName:'Digital Dental Center Pattaya',auditedWebsite:'https://digitaldentalpattaya.com/',profileWebsite:'https://www.digitaldentalpattaya.com/',directMapsCandidate:true});
assert.equal(id.matched,true);assert.equal(id.confidence,'high');

const thin={status:'probed',discovery:{matched:true,matchConfidence:'high',matchBasis:['website-domain']},profile:{address:'x',phone:'y',website:'https://x.test',hoursPresent:true},reputation:{},media:{},consistency:{},actions:{callAvailable:true,directionsAvailable:true,websiteAvailable:true,bookingAvailable:null,messageAvailable:null}};
const thinScore=scoreBranch(thin);
assert.equal(thinScore.status,'insufficient-evidence');
assert.equal(thinScore.overall,null);
assert.ok(thinScore.provisionalOverall!==null);
assert.ok(thinScore.evidenceCoverage.knownComponents<4);

const enough=JSON.parse(JSON.stringify(thin));
enough.profile.rating=4.8; enough.profile.reviewCount=250;
enough.consistency.websiteMatches=true;
const enoughScore=scoreBranch(enough);
assert.equal(enoughScore.status,'scored');
assert.ok(enoughScore.overall<=88,'4-component score must be coverage-capped');

const mismatch=JSON.parse(JSON.stringify(enough)); mismatch.discovery={matched:false,matchConfidence:'low'};
assert.equal(scoreBranch(mismatch).overall,null,'unconfirmed identity must never publish score');
console.log('google-business-v224 tests passed');
