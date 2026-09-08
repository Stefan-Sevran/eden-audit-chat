const assert=require('assert');
const {classifyFacebookContentOwnership}=require('./facebook-content-quality');
const page={pageName:'Your Dentist Pattaya Dental clinic',handle:'YourDentistPattaya',followerCount:28000};
const evidence={page,probe:{probeDiagnostics:{commentPostDiscovery:{feedCards:[
 {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/1',contentUrls:['https://www.facebook.com/YourDentistPattaya/posts/1'],text:"Your Dentist dental clinic Pattaya 7 August · https://www.facebook.com/share/p/abc/ สถาบันทันตกรรม กรมการแพทย์ All reactions: 1"},
 {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/2',contentUrls:['https://www.facebook.com/YourDentistPattaya/posts/2'],text:'Your Dentist Pattaya Dental clinic · Teeth whitening promotion All reactions: 2 1 comments'},
 {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/3',contentUrls:['https://www.facebook.com/YourDentistPattaya/posts/3'],text:'Your Dentist Pattaya Dental clinic · Implant consultation All reactions: 1'},
 {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/4',contentUrls:['https://www.facebook.com/YourDentistPattaya/posts/4'],text:'Your Dentist Pattaya Dental clinic · Braces FAQ All reactions: 1'},
 {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/5',contentUrls:['https://www.facebook.com/YourDentistPattaya/posts/5'],text:'Your Dentist Pattaya Dental clinic · Dental cleaning All reactions: 0'},
]}}}};
const q=classifyFacebookContentOwnership(evidence);
assert.equal(q.clinicPublishedShares,1);
assert.equal(q.clinicOriginalPosts,4);
assert.equal(q.engagementQuality.reliableEngagementSamples,5);
assert.equal(q.engagementQuality.signal,'very-low-visible-engagement');
assert.equal(q.records[0].provenance,'clinic-feed-card');
assert.equal(q.sampling.stopCondition,'target-met');
console.log('V2.2.26 feed-card provenance + adaptive engagement sample regression passed');
