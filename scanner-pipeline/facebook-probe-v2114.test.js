const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const src=fs.readFileSync(__dirname+'/facebook-probe.js','utf8');
const start=src.indexOf('function associateRepliesFromRenderedText');
const end=src.indexOf('\nasync function collectPublicCommentEvidence',start);
const fnSrc=src.slice(start,end)+'\nmodule.exports={associateRepliesFromRenderedText};';
const sandbox={module:{exports:{}},exports:{},require,console};
vm.runInNewContext(fnSrc,sandbox);
const {associateRepliesFromRenderedText}=sandbox.module.exports;
const rows=[
 {author:'Reneboy Leonor Mosquera 34 weeks ago',text:'Reneboy Leonor Mosquera Location 34w Like Reply 2',clinicReplyObserved:false,replyAssociationMode:null},
 {author:'Tina Rivera 25 weeks ago',text:'Tina Rivera Up lng how much? 25w Like Reply 5',clinicReplyObserved:false,replyAssociationMode:null},
 {author:'Mylene Ale-Tedio Cañon 7 weeks ago',text:'Mylene Ale-Tedio Cañon Lower fixed bridge? 7w Like Reply 3',clinicReplyObserved:false,replyAssociationMode:null},
 {author:'Junjun Casipong Maquiling 29 weeks ago',text:'Junjun Casipong Maquiling Location po 29w Like Reply 1',clinicReplyObserved:false,replyAssociationMode:null}
];
const body='Most relevant Reneboy Leonor Mosquera Location 34w Like Reply 2 Yu Dental Davao replied · 1 reply Tina Rivera Up lng how much? 25w Like Reply 5 Yu Dental Davao replied · 2 replies Mylene Ale-Tedio Cañon Lower fixed bridge? 7w Like Reply 3 Yu Dental Davao replied · 1 reply Junjun Casipong Maquiling Location po 29w Like Reply 1 Facebook';
// Reproduce the real failure mode: Facebook page title polluted by notification count,
// while the handle still encodes the formal clinic name.
const out=associateRepliesFromRenderedText(rows,body,'(7) Facebook','yudentalcenterdavao');
assert.equal(out[0].clinicReplyObserved,true);
assert.equal(out[0].clinicReplyCount,1);
assert.equal(out[1].clinicReplyObserved,true);
assert.equal(out[1].clinicReplyCount,2);
assert.equal(out[2].clinicReplyObserved,true);
assert.equal(out[2].clinicReplyCount,1);
assert.equal(out[3].clinicReplyObserved,false);
assert(out.slice(0,3).every(x=>x.replyAssociationMode==='raw-rendered-text'));
console.log('facebook-probe-v2114 ok');
