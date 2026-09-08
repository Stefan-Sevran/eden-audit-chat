const assert=require('assert');
const {classifyFacebookContentOwnership,labelledEngagement}=require('./facebook-content-quality');
const page={pageName:'Your Dentist Pattaya Dental clinic',handle:'YourDentistPattaya',followerCount:28000};
const evidence={page,probe:{probeDiagnostics:{commentPostDiscovery:{
  feedCards:[
    {route:'posts',sourceUrl:'https://www.facebook.com/permalink.php?story_fbid=share1&id=1',contentUrls:['https://www.facebook.com/permalink.php?story_fbid=share1&id=1'],text:'https://www.facebook.com/share/p/abc External Dental Source · Root canal information',ariaLabels:['External Dental Source']},
    {route:'posts',sourceUrl:'https://www.facebook.com/YourDentistPattaya/posts/original',contentUrls:['https://www.facebook.com/YourDentistPattaya/posts/original'],text:'Your Dentist Pattaya Dental clinic · Follow Whitening promotion',ariaLabels:['2 reactions','No comments yet','0 shares']},
    {route:'reels',sourceUrl:'https://www.facebook.com/reel/fused/',contentUrls:['https://www.facebook.com/reel/fused/'],text:'Reel tile preview',ariaLabels:['Reel tile preview']}
  ],
  perPostDiagnostics:[
    {sourceUrl:'https://www.facebook.com/reel/fused/',states:[{score:20,bodyText:'Your Dentist Pattaya Dental clinic · Follow Comments No comments yet Be the first to comment.'}]}
  ]
}}}};
const out=classifyFacebookContentOwnership(evidence);
assert.equal(out.schemaVersion,'2.2.28');
assert.equal(out.records[0].contentType,'clinic-published-share');
assert.equal(out.records[0].provenance,'clinic-feed-card');
assert.equal(out.records[0].provenanceConfidence,'medium');
assert.equal(out.records[1].contentType,'clinic-original');
assert.equal(out.records[1].engagement.commentCount,0);
assert.equal(out.records[2].contentType,'clinic-original');
assert.equal(out.records[2].provenance,'evidence-fused');
assert.equal(out.records[2].feedCardProvenance,'unresolved');
assert.equal(labelledEngagement('No comments yet Be the first to comment.').commentCount,0);
console.log('V2.2.28 tight card-boundary + unresolved-card evidence fusion regression passed');
