const assert=require('assert');
const {classifyIntentText}=require('./facebook-probe');

const cases=[
  ['Flexible denture hm', true, ['pricing','treatment'], 'high'],
  ['hm', true, ['pricing'], 'high'],
  ['Pila po up and down', true, ['pricing','treatment'], 'high'],
  ["Pila pa braces ma'am", true, ['pricing','treatment'], 'high'],
  ['How much per teeth po?', true, ['pricing','treatment'], 'high'],
  ['Hm braces lower part lang?', true, ['pricing','treatment'], 'high'],
  ['Location?', true, ['location'], 'high'],
  ['Upper fixed bridge how much', true, ['pricing','treatment'], 'high'],
  ['Hm pabunot - wisdom tooth?ty', true, ['pricing','treatment'], 'high'],
  ["I'm interested po", true, ['generalInterest'], 'medium'],
  ['Interested', true, ['generalInterest'], 'medium'],
  ['Step, stop, pot, pots, pest, pests, poster, posters, paste, fast, faster, passed, known, loan, lawn, pawn, towns, lecture, failure, gather', false, [], 'none']
];
for (const [text,patient,cats,confidence] of cases) {
  const r=classifyIntentText(text);
  assert.equal(r.patientIntent,patient,text);
  assert.equal(r.classification.confidence,confidence,text);
  for (const cat of cats) assert(r.classification.intentCategories.includes(cat),`${text}: missing ${cat}`);
  assert.equal(r.classification.method,'deterministic-lexicon-v2.1.22');
}
const hm=classifyIntentText('hm');
assert(hm.classification.languageContext.some(x=>x.includes('hm = how much')));
assert(hm.classification.matchedSignals.some(x=>x.signal==='hm'));
const interested=classifyIntentText("I'm interested po");
assert.equal(interested.generalInterestIntent,true);
console.log('facebook-probe-v2118 ok');
