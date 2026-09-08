const assert=require('assert');
const {classifyFacebookContentOwnership,aliasMatch,identityTokenSets}=require('./facebook-content-quality');
const page={pageName:'Your Dentist Pattaya Dental clinic',handle:'YourDentistPattaya'};
const sets=identityTokenSets(page);
assert.equal(aliasMatch('คลินิกทันตกรรม ยัวร์เดนทิส ทำฟัน พัทยา Your Dentist dental clinic Pattaya',[],sets),true);
assert.equal(aliasMatch('53 2 26 คลินิกทันตกรรม ยัวร์เดนทิส ทำฟัน พัทยา Your Dentist dental clinic Pattaya',[],sets),true);
assert.equal(aliasMatch('รากฟันเทียม โดย หมอโชค',[],sets),false);
const evidence={
 page:{...page,followerCount:28000},
 probe:{probeDiagnostics:{commentPostDiscovery:{perPostDiagnostics:[
  {sourceUrl:'owned-1',states:[{score:20,bodyText:'คลินิกทันตกรรม ยัวร์เดนทิส ทำฟัน พัทยา Your Dentist dental clinic Pattaya · Follow 1 reactions 0 comments 0 shares'}]},
  {sourceUrl:'owned-2',states:[{score:20,bodyText:'53 2 26 คลินิกทันตกรรม ยัวร์เดนทิส ทำฟัน พัทยา Your Dentist dental clinic Pattaya · Follow 2 reactions 0 comments 0 shares'}]},
  {sourceUrl:'shared',states:[{score:20,bodyText:'รากฟันเทียม โดย หมอโชค · Follow 30 reactions 7 comments 4 shares'}]}
 ]}}}
};
const q=classifyFacebookContentOwnership(evidence);
assert.equal(q.clinicAuthoredPosts,2);
assert.equal(q.clinicSharedExternalPosts,1);
assert.equal(q.records[0].ownership,'clinic-authored');
assert.equal(q.records[1].ownership,'clinic-authored');
assert.equal(q.records[2].ownership,'clinic-shared-external');
assert.equal(q.engagementQuality.reliableEngagementSamples,2);
console.log('V2.2.24 robustness test passed');
