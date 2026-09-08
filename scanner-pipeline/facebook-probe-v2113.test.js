const assert=require('assert');
const {associateRepliesFromRenderedText}=require('./facebook-probe');

const rows=[
 {author:'Reneboy Leonor Mosquera 34 weeks ago',text:'Reneboy Leonor Mosquera Location 34w',clinicReplyObserved:false,replyAssociationMode:null},
 {author:'Tina Rivera 25 weeks ago',text:'Tina Rivera Up lng how much? 25w',clinicReplyObserved:false,replyAssociationMode:null},
 {author:'Gregorio Amor 24 weeks ago',text:'Gregorio Amor Pila taas ug ubos Poh? 24w',clinicReplyObserved:false,replyAssociationMode:null}
];
const body='Yu Dental Davao post All comments Reneboy Leonor Mosquera Location 34w Like Reply 2 Yu Dental Davao replied · 2 replies Tina Rivera Up lng how much? 25w Like Reply 5 Yu Dental Davao replied · 3 replies Gregorio Amor Pila taas ug ubos Poh? 24w Like Reply See translation 6 Yu Dental Davao replied · 2 replies Facebook';
const out=associateRepliesFromRenderedText(rows,body,'Yu Dental Center Davao','yudentalcenterdavao');
assert.equal(out.length,3);
assert(out.every(x=>x.clinicReplyObserved===true));
assert.deepEqual(out.map(x=>x.clinicReplyCount),[2,3,2]);
assert(out.every(x=>x.replyAssociationMode==='raw-rendered-text'));

const noReply=associateRepliesFromRenderedText([{author:'Norma Calatrava 2 weeks ago',text:'Norma Calatrava How much up n down dentures 2w',clinicReplyObserved:false}], 'Norma Calatrava How much up n down dentures 2w Like Reply Facebook', 'Yu Dental Center Davao','yudentalcenterdavao');
assert.equal(noReply[0].clinicReplyObserved,false);
console.log('facebook-probe v2.1.13 tests passed');
