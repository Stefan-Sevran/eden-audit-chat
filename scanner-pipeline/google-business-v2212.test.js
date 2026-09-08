const assert=require('assert');
const {parseRatingAndReviews,parseContact}=require('./google-business-probe');
const {scoreBranch,validReviewCount}=require('./google-business');

// Real Maps shape: compact rating + nearby parenthesized integer review count wins.
let rr=parseRatingAndReviews({
  rows:[{text:'Digital Dental Center Pattaya',aria:'',title:''},{text:'5.0 · 225 reviews',aria:'',title:''}],
  bodyText:'Nearby place 5.0 225 reviews',
  textBoxes:[
    {text:'4.8',x:120,y:210,width:28,height:20},
    {text:'4.8',x:156,y:210,width:28,height:20}, // duplicated rating-like UI text must not become a count
    {text:'★★★★★',x:190,y:210,width:75,height:20},
    {text:'(243)',x:272,y:210,width:42,height:20}
  ]
});
assert.deepEqual(rr,{rating:4.8,reviewCount:243});

// Decimal values can never be review counts, even when the UI text is noisy.
rr=parseRatingAndReviews({rows:[],bodyText:'',textBoxes:[
  {text:'4.8',x:120,y:210,width:28,height:20},
  {text:'4.8',x:160,y:210,width:28,height:20}
]});
assert.equal(rr.reviewCount,null);
rr=parseRatingAndReviews({rows:[{text:'4.8 reviews',aria:'',title:''}],bodyText:'',textBoxes:[]});
assert.equal(rr.reviewCount,null);

// Explicit integer review counts remain valid, including genuinely small profiles.
assert.equal(validReviewCount(4),true);
assert.equal(validReviewCount(243),true);
assert.equal(validReviewCount(4.8),false);

// Defensive scoring backstop: malformed review count cannot create reputation evidence.
const branch={
  status:'probed',
  discovery:{matched:true,matchConfidence:'high',matchBasis:['name','website-domain']},
  profile:{address:'x',phone:'1',website:'https://x.test',hoursPresent:true,rating:4.8,reviewCount:4.8},
  reputation:{},media:{},consistency:{websiteMatches:true,phoneMatches:true,brandNameMatches:true},
  actions:{callAvailable:true,directionsAvailable:true,websiteAvailable:true}
};
const scored=scoreBranch(branch);
assert.equal(scored.components.reputationStrength,null);
assert.equal(scored.evidenceIntegrity.reviewCountValid,false);

// Phone cleanup remains intact.
assert.equal(parseContact({rows:[{text:'ส่งไปที่โทรศัพท์',aria:'ส่งไปที่โทรศัพท์',title:'Phone',href:null}]}).phone,null);
assert.equal(parseContact({rows:[{text:'Call',aria:'Call 094 679 2939',title:'',href:null}]}).phone,'094 679 2939');

console.log('google-business-v2212.test.js passed');
