const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {parseDedicatedReviewCount,classifyDestination}=require('./google-business-probe');
const {facebookActionKind,contentRouteCandidates}=require('./facebook-probe');

// Dedicated Reviews route can recover count even when profile header parser missed it.
const reviewRaw={rows:[
  {role:'button',aria:'4.1 stars 46 reviews',text:'',title:''},
  {role:'button',aria:'Directions',text:'Directions',title:''}
],bodyText:'Your Dentist Pattaya Reviews Sort by'};
const rr=parseDedicatedReviewCount(reviewRaw,4.1);
assert.equal(rr.value,46);
assert.equal(rr.status,'observed');
assert.equal(rr.conflict,false);

// Conflicting positive review counts are surfaced rather than silently overwritten.
const conflict=parseDedicatedReviewCount({rows:[
  {role:'button',aria:'4.1 stars 46 reviews'},
  {role:'button',aria:'47 reviews'}
]},4.1);
assert.equal(conflict.value,46);
assert.equal(conflict.conflict,true);

// Dedicated Facebook action semantics can use href even if visible label is weak/empty.
assert.equal(facebookActionKind({label:'',text:'',href:'https://m.me/YourDentistPattaya'}),'message');
assert.equal(facebookActionKind({label:'',text:'',href:'tel:+66940954290'}),'call');
assert.equal(facebookActionKind({label:'Book',href:''}),'book');
assert.equal(facebookActionKind({text:'Follow',href:'/followers'}),null);

// Commercial content route order explicitly favors posts before opaque reels.
const routes=contentRouteCandidates('https://www.facebook.com/YourDentistPattaya');
assert.deepEqual(routes.map(x=>x.kind),['posts','reels','photos']);

const structural=classifyDestination('https://www.facebook.com/YourDentistPattaya',{raw:{bodyText:'Log in Create account'}});
assert.equal(structural.qualityScore,68);
assert.equal(structural.transientFrictionObserved,true);

const fb=fs.readFileSync(path.join(__dirname,'facebook-probe.js'),'utf8');
assert.match(fb,/dedicatedActionHrefSemantics:true/);
assert.match(fb,/commercialContentPriority/);
assert.match(fb,/posts-then-photos-then-reels/);
const gb=fs.readFileSync(path.join(__dirname,'google-business-probe.js'),'utf8');
assert.match(gb,/dedicated-reviews-surface/);
assert.match(gb,/parseDedicatedReviewCount/);
console.log('V2.2.33 robustness tests passed');
