const assert=require('assert');
const {classifyFacebookContentOwnership}=require('./facebook-content-quality');
const {scoreGoogleBusiness}=require('./google-business');

const fb=classifyFacebookContentOwnership({
  page:{pageName:'Clinic Test Dental',handle:'ClinicTestDental',followerCount:28000},
  probe:{probeDiagnostics:{commentPostDiscovery:{feedCards:[
    {route:'posts',sourceUrl:'https://www.facebook.com/ClinicTestDental/posts/1',text:'Clinic Test Dental · Follow',ariaLabels:['47 reactions','12 comments','3 shares'],interactionSignals:[{label:'47 reactions',text:''},{label:'12 comments',text:''},{label:'3 shares',text:''}]},
    {route:'posts',sourceUrl:'https://www.facebook.com/ClinicTestDental/posts/2',text:'Clinic Test Dental · Follow',ariaLabels:['2 reactions','No comments yet','1 share']},
    {route:'posts',sourceUrl:'https://www.facebook.com/ClinicTestDental/posts/3',text:'Clinic Test Dental · Follow',ariaLabels:['1 reaction','No comments yet','No shares yet']}
  ],perPostDiagnostics:[]}}}
});
assert.equal(fb.engagementQuality.reliableEngagementSamples,3);
assert.equal(fb.records[0].engagement.reactionCount,47);
assert.equal(fb.records[0].engagement.commentCount,12);
assert.equal(fb.records[0].engagement.shareCount,3);
assert.equal(fb.records[1].engagement.commentCount,0);
assert.equal(fb.engagementQuality.status,'assessed');

const gb=scoreGoogleBusiness({status:'probed',branches:[{
  status:'probed',discovery:{matched:true,matchConfidence:'high'},
  profile:{address:'x',phone:'1',website:'https://facebook.com/clinic',hoursPresent:true,descriptionPresent:null,servicesPresent:null,rating:4.1,reviewCount:46},
  reputation:{},media:{},consistency:{websiteMatches:true,phoneMatches:true,brandNameMatches:true},
  actions:{callAvailable:true,directionsAvailable:true,websiteAvailable:true},
  conversionDestination:{status:'probed',classification:'social-profile',ownerControl:'platform-mediated',qualityScore:68,bookingProximity:'conversation-or-feed',responseCapability:'platform-dependent'}
}]});
assert.equal(gb.status,'scored');
assert.equal(gb.scoreScopeLabel,'Google Business Profile Strength');
assert(gb.overall>=70);
assert(gb.patientConversionReadiness.score < gb.overall);
assert.equal(gb.patientConversionReadiness.actualConversionPerformance,'not-measured');
console.log('robustness-v2229 ok');
