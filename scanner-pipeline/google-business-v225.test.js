const assert = require('assert');
const { parseRatingAndReviews, parseCategory, parseRelativeReviewDates, mergeProbeIntoEvidence } = require('./google-business-probe');
const { scoreGoogleBusiness } = require('./google-business');
const { deterministicClaims } = require('./openai-audit-intelligence');

let rr = parseRatingAndReviews({bodyText:'Digital Dental Center Pattaya 4.8 stars Dental clinic 124 reviews',rows:[]});
assert.equal(rr.rating,4.8); assert.equal(rr.reviewCount,124);
rr = parseRatingAndReviews({bodyText:'Digital Dental Center Pattaya 4.8 stars Open',rows:[]});
assert.equal(rr.rating,4.8); assert.equal(rr.reviewCount,null);
assert.equal(parseCategory({bodyText:'Digital Dental Center Pattaya Dental clinic Open',rows:[]}), 'Dental clinic');
assert.deepEqual(parseRelativeReviewDates('5 stars a week ago Great. 4 stars 2 months ago Nice.'), ['a week ago','2 months ago']);

const template={reviewedUrl:'https://digitaldentalpattaya.com',identity:{clinicName:'Digital Dental Pattaya',location:'Pattaya'},discovery:{googleMapsUrls:['https://maps.app.goo.gl/x']},branches:[{status:'awaiting-evidence',identity:{clinicName:'Digital Dental Pattaya'},discovery:{},profile:{},reputation:{},media:{},consistency:{},actions:{}}]};
const probe={status:'probed',targetUrl:'https://maps.app.goo.gl/x',finalUrl:'https://www.google.com/maps/place/x',profileSurfaceConfirmed:true,identity:{pageName:'Digital Dental Center Pattaya',expectedName:'Digital Dental Pattaya'},profile:{rating:4.8,reviewCount:124,primaryCategory:'Dental clinic',address:'x',phone:'094 679 2939',website:'https://www.digitaldentalpattaya.com/',hoursPresent:true},reputation:{sampledReviewDates:['a week ago']},media:{profileImageVisible:true},actions:{directions:{observed:true},website:{observed:true},call:{observed:true},booking:{observed:null},message:{observed:null}},provenance:{collectedAt:'2026-08-28T00:00:00Z'},reviewsSurface:{screenshot:'/tmp/reviews.png'}};
const evidence=mergeProbeIntoEvidence(template,probe,{phoneDisplayedNumbers:['094-679-2939']});
assert.equal(evidence.branches[0].consistency.websiteMatches,true);
assert.equal(evidence.branches[0].consistency.phoneMatches,true);
assert.equal(evidence.branches[0].consistency.brandNameMatches,true);
const score=scoreGoogleBusiness(evidence);
assert.equal(score.status,'scored');
assert.ok(score.overall>0 && score.overall<=94);
assert.ok(score.branches[0].evidenceCoverage.knownComponents>=4);

const claims=deterministicClaims({summary:{},scoring:{categories:{}},googleBusinessProbe:{status:'probed',identity:{pageName:'x'},profile:{},actions:{}},googleBusiness:{assessment:{status:'insufficient-evidence',overall:null}}});
assert.equal(claims.some(c=>c.id==='google-score-overall'),false);
console.log('google-business-v225 tests passed');
