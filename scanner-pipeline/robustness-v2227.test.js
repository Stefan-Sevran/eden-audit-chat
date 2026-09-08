const assert=require('assert');
const {classifyFacebookContentOwnership}=require('./facebook-content-quality');
const page={pageName:'Your Dentist Pattaya Dental clinic',handle:'YourDentistPattaya',followerCount:28000};
const evidence={page,probe:{probeDiagnostics:{commentPostDiscovery:{feedCards:[
  {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/a',text:'Your Dentist Pattaya Dental clinic · Follow Shared a post สถาบันทันตกรรม กรมการแพทย์',ariaLabels:['1 reaction','0 comments','0 shares']},
  {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/b',text:'Your Dentist Pattaya Dental clinic · Follow Whitening promotion',ariaLabels:['2 reactions','0 comments','0 shares']},
  {sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/c',text:'Your Dentist Pattaya Dental clinic · Follow Implant consultation',ariaLabels:['1 reaction','1 comment','0 shares']},
  {sourceUrl:'https://www.facebook.com/reel/x',text:'Other Dental Page · Follow Viral reel',ariaLabels:['10K reactions','500 comments']}
],perPostDiagnostics:[]}}}};
const out=classifyFacebookContentOwnership(evidence);
assert.equal(out.schemaVersion,'2.2.28');
assert.equal(out.clinicPublishedShares,1);
assert.equal(out.clinicOriginalPosts,2);
assert.equal(out.externalOnlyPosts,1);
assert.equal(out.engagementQuality.reliableEngagementSamples,3);
assert.equal(out.engagementQuality.status,'assessed');
assert.equal(out.records[0].provenance,'clinic-feed-card');
assert.equal(out.records[0].engagement.reactionCount,1);
assert.equal(out.records[3].engagementEligible,false);
console.log('V2.2.28 real feed-card capture + aria-labelled engagement regression passed');
