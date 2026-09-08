const assert=require('assert');
const {parseRatingAndReviews,accumulateObserved}=require('./google-business-probe');
const {classifyFacebookContentOwnership}=require('./facebook-content-quality');

// Google: alternate same-scan states can expose rating and reviews separately.
const a=parseRatingAndReviews({rows:[{text:'4.1',aria:'4.1 stars'}],bodyText:'Your Dentist 4.1 stars'});
const b=parseRatingAndReviews({rows:[{text:'46 reviews',aria:'46 reviews'}],bodyText:'46 reviews'});
assert.equal(a.rating,4.1);
assert.equal(b.reviewCount,46);
const accumulated=accumulateObserved([null,46,null,46]);
assert.equal(accumulated.value,46);
assert.equal(accumulated.conflict,false);
const conflicted=accumulateObserved([46,64]);
assert.equal(conflicted.conflict,true);

// Facebook: a clinic feed wrapper aliases the opened source permalink, so the source
// render cannot erase the clinic-published-share provenance.
const evidence={
  page:{pageName:'Your Dentist Pattaya Dental clinic',handle:'YourDentistPattaya',followerCount:28000},
  probe:{probeDiagnostics:{commentPostDiscovery:{
    feedCards:[{route:'posts',sourceUrl:'https://facebook.com/YourDentistPattaya/posts/abc',contentUrls:['https://facebook.com/YourDentistPattaya/posts/abc','https://facebook.com/permalink.php?id=source'],text:'Your Dentist Pattaya Dental clinic https://www.facebook.com/share/p/x External Source All reactions: 1',ariaLabels:['All reactions: 1']}],
    perPostDiagnostics:[{sourceUrl:'https://facebook.com/permalink.php?id=source',states:[{score:10,bodyText:"External Source's post 999 reactions"}]}]
  }}}
};
const out=classifyFacebookContentOwnership(evidence);
assert.equal(out.records.length,1);
assert.equal(out.records[0].contentType,'clinic-published-share');
assert.equal(out.records[0].engagement.reactionCount,1);
assert.equal(out.records[0].provenance,'clinic-feed-card');
console.log('V2.2.31 robustness regression passed');
