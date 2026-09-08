const assert=require('assert');
const {parseRatingAndReviews,parseContact}=require('./google-business-probe');
const {filterCredentialPhones}=require('./snapshot');

// Split Maps header nodes: rating and count are separate siblings.
let rr=parseRatingAndReviews({
  rows:[{text:'Digital Dental Center Pattaya',aria:'',title:''},{text:'5.0 · 225 reviews',aria:'',title:''}],
  bodyText:'Nearby place 5.0 225 reviews',
  textBoxes:[
    {text:'4.8',x:120,y:210,width:28,height:20},
    {text:'★★★★★',x:154,y:210,width:75,height:20},
    {text:'(243)',x:236,y:210,width:42,height:20}
  ]
});
assert.deepEqual(rr,{rating:4.8,reviewCount:243});

// Explicit compact source remains supported.
rr=parseRatingAndReviews({rows:[{text:'4.7 (1,234)',aria:'',title:''}],bodyText:'',textBoxes:[]});
assert.deepEqual(rr,{rating:4.7,reviewCount:1234});

// Thai/English UI labels without digits must never become a phone number.
assert.equal(parseContact({rows:[{text:'ส่งไปที่โทรศัพท์',aria:'ส่งไปที่โทรศัพท์',title:'Phone',href:null}]}).phone,null);
assert.equal(parseContact({rows:[{text:'Call',aria:'Call 038-199-367',title:'',href:'tel:+6638199367'}]}).phone,'+6638199367');

// Credential IDs/substrings are filtered from displayed clinic phone candidates.
assert.deepEqual(filterCredentialPhones(['038 199 367','094-679-2939','0103002067'],[{identifier:'20103002067'}]),['038 199 367','094-679-2939']);
console.log('google-business-v2211.test.js passed');
