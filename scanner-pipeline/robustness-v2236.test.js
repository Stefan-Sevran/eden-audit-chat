const assert=require('assert');
const {
  numericFacebookPageId,pageBaseUrl,facebookPageRoute,contentRouteCandidates,
  sameFacebookPage,expectedHandle
}=require('./facebook-probe');

const clinic='https://www.facebook.com/profile.php?id=61591642749531';
const other='https://www.facebook.com/profile.php?id=61584122357228';
assert.equal(numericFacebookPageId(clinic),'61591642749531');
assert.equal(pageBaseUrl(clinic),clinic);
assert.equal(expectedHandle(clinic),'profile.php?id=61591642749531');
assert.equal(facebookPageRoute(clinic,'header'),clinic);
assert.equal(facebookPageRoute(clinic,'about'),'https://www.facebook.com/profile.php?id=61591642749531&sk=about');
assert.equal(facebookPageRoute(clinic,'reviews'),'https://www.facebook.com/profile.php?id=61591642749531&sk=reviews');
assert.equal(facebookPageRoute(clinic,'posts'),'https://www.facebook.com/profile.php?id=61591642749531&sk=posts');
assert.equal(facebookPageRoute(clinic,'reels'),'https://www.facebook.com/profile.php?id=61591642749531&sk=reels');
assert.equal(facebookPageRoute(clinic,'photos'),'https://www.facebook.com/profile.php?id=61591642749531&sk=photos');
assert.deepEqual(contentRouteCandidates(clinic).map(x=>x.url),[
  'https://www.facebook.com/profile.php?id=61591642749531&sk=posts',
  'https://www.facebook.com/profile.php?id=61591642749531&sk=reels',
  'https://www.facebook.com/profile.php?id=61591642749531&sk=photos'
]);
assert.equal(sameFacebookPage(clinic,clinic),true);
assert.equal(sameFacebookPage(clinic,other),false);
assert.equal(sameFacebookPage(clinic,'https://www.facebook.com/profile.php'),false);
assert.equal(sameFacebookPage('https://www.facebook.com/YourDentistPattaya/','https://www.facebook.com/YourDentistPattaya'),true);
console.log('V2.2.36 Facebook numeric page identity tests passed');
