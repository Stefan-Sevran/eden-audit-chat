const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {classifyDestination}=require('./google-business-probe');

const clean=classifyDestination('https://www.facebook.com/YourDentistPattaya',{raw:{bodyText:'Your Dentist Pattaya Message Call'}});
const login=classifyDestination('https://www.facebook.com/YourDentistPattaya',{raw:{bodyText:'See more on Facebook Log in Create new account'}});
assert.equal(clean.classification,'social-profile');
assert.equal(login.classification,'social-profile');
assert.equal(clean.qualityScore,68);
assert.equal(login.qualityScore,68,'transient login render must not lower structural Google handoff score');
assert.equal(login.transientFrictionObserved,true);

const fb=fs.readFileSync(path.join(__dirname,'facebook-probe.js'),'utf8');
assert.match(fb,/facebookEvidenceAcquisitionAttempts\|\|2/);
assert.match(fb,/stopOnPositiveAction:true/);
assert.match(fb,/acquisitionRetryUsed:true/);
assert.match(fb,/positiveEvidenceMonotonic:true/);

const snap=fs.readFileSync(path.join(__dirname,'snapshot.js'),'utf8');
assert.match(snap,/facebookEvidenceAcquisitionAttempts:facebookPrimary\?2:1/);
console.log('V2.2.32 robustness tests passed');
