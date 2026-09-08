const assert=require('assert');
const {classifyDestination}=require('./google-business-probe');

// Regression: "smiledental" contains the characters "eden" across the word boundary.
// It must never be enough to claim Eden ownership.
let x=classifyDestination('https://www.pattayasmiledentalclinic.com/',{
  auditedWebsite:'http://www.pattayasmiledentalclinic.com/',
  raw:{title:'Pattaya Smile Dental Clinic',bodyText:'Contact Information Dental Fees Testimonials'}
});
assert.equal(x.classification,'clinic-website');
assert.notEqual(x.ownerControl,'eden-controlled');
assert(x.qualityScore < 90);

// Explicit Eden endpoint remains a positive signal.
x=classifyDestination('https://edenclinic.ai/reception/book',{
  auditedWebsite:'https://clinic.example',
  raw:{title:'Eden AI Receptionist',bodyText:'Eden AI receptionist book appointment'}
});
assert.equal(x.classification,'eden-ai-receptionist');
assert.equal(x.ownerControl,'eden-controlled');
assert(x.qualityScore>=95);

// Body marker may positively identify an embedded Eden-controlled path when explicit.
x=classifyDestination('https://clinic.example/reception',{
  auditedWebsite:'https://clinic.example',
  raw:{title:'Book with Eden AI',bodyText:'Eden receptionist available 24/7'}
});
assert.equal(x.classification,'eden-ai-receptionist');

console.log('robustness-v2216 tests passed');
