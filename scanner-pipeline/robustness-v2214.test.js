const assert=require('assert');
const {filterCredentialPhones}=require('./snapshot');
const {mergeProbeIntoEvidence}=require('./google-business-probe');
const {buildActionEngine}=require('./cross-channel-action-engine');
const {parseSurfaceEvidence}=require('./facebook-probe');

// Thai clinic licence number must suppress a phone-shaped suffix.
assert.deepStrictEqual(
  filterCredentialPhones(['0103002050','086 334 2004'],[{label:'ใบอนุญาตเลขที่',identifier:'20103002050'}]),
  ['086 334 2004']
);

// Visible Facebook surface signals are extracted only when rendered.
assert.deepStrictEqual(
  parseSurfaceEvidence('Pattaya Smile Dental Clinic 4.3K followers · 16 following 98% recommend (297 reviews) Open now'),
  {followerCount:4300,recommendationPercent:98,recommendationReviewCount:297}
);

const template={
  reviewedUrl:'http://www.pattayasmiledentalclinic.com/',
  identity:{clinicName:'Pattaya Smile Dental Clinic',location:'Pattaya, Thailand'},
  discovery:{googleMapsUrls:[]},
  branches:[{status:'awaiting-evidence',discovery:{},profile:{},reputation:{},media:{},actions:{},consistency:{}}]
};
const wrongProbe={
  status:'probed',profileSurfaceConfirmed:true,targetUrl:'https://www.google.com/maps/search/?api=1&query=Pattaya+Smile',finalUrl:'https://www.google.com/maps/place/Digital+Dental+Center+Pattaya',
  identity:{expectedName:'Pattaya Smile Dental Clinic',pageName:'Digital Dental Center Pattaya'},
  profile:{primaryCategory:'Dental Clinic',rating:4.8,reviewCount:243,address:'Wrong address',phone:'094 679 2939',website:'https://digitaldentalpattaya.com/',hoursPresent:true},
  reputation:{sampledReviewDates:[]},media:{profileImageVisible:true},
  actions:{directions:{observed:true},website:{observed:true},call:{observed:true},booking:{observed:false},message:{observed:null}},
  conversionDestination:{status:'probed',targetUrl:'https://digitaldentalpattaya.com/',finalUrl:'https://digitaldentalpattaya.com/',classification:'clinic-website',qualityScore:76},
  bookingDestination:{status:'not-observed',classification:'missing',qualityScore:0},
  provenance:{collectedAt:new Date().toISOString(),notes:''}
};
const merged=mergeProbeIntoEvidence(template,wrongProbe,{phoneDisplayedNumbers:['086 334 2004']});
const branch=merged.branches[0];
assert.strictEqual(branch.discovery.matched,false);
assert.strictEqual(branch.identityIsolation.status,'quarantined');
assert.strictEqual(branch.profile.rating,null);
assert.strictEqual(branch.profile.website,null);
assert.strictEqual(branch.conversionDestination.classification,'wrong-entity-evidence');

const actions=buildActionEngine({googleBusiness:{evidence:merged},bookingFlow:{},aiAuditIntelligence:{}});
assert.strictEqual(actions.actions.some(x=>x.pillar==='google'),false,'Wrong-entity Google evidence must never generate a commercial Google action');

console.log('V2.2.14 robustness tests passed');
