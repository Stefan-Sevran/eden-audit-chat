const assert=require('assert');
const {rankFacebookCandidates}=require('./facebook-probe');
const ranked=rankFacebookCandidates([
  {targetUrl:'https://www.facebook.com/PattayaSmiledentalclinic/',score:0,displayState:'unavailable-content'},
  {targetUrl:'https://www.facebook.com/Pattayasmiledentist/',score:90,displayState:'clinic-surface',identityConfidence:'high'}
]);
assert.equal(ranked[0].targetUrl,'https://www.facebook.com/Pattayasmiledentist/');
assert.equal(ranked[1].displayState,'unavailable-content');
console.log('V2.2.20 Facebook multi-candidate canonical resolution regression: PASS');
