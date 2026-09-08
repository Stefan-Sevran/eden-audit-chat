const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const {deterministicClaims,selectedAuditScreenshots,evidencePacket,responseSchema}=require('./openai-audit-intelligence');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eden-gbp-ai-'));const g=path.join(dir,'google.png');fs.writeFileSync(g,'x');
const manifest={version:'2.2.3',summary:{bookingCtaVisible:true},scoring:{categories:{}},googleBusinessProbe:{status:'probed',screenshot:g,identity:{pageName:'Clinic'},profile:{rating:4.8,reviewCount:120},actions:{directions:{observed:true},website:{observed:true},call:{observed:null},booking:{observed:null},message:{observed:null}}},googleBusiness:{assessment:{status:'scored',overall:84},evidence:{branches:[{profile:{rating:4.8}}]}}};
const shots=selectedAuditScreenshots(manifest);assert(shots.some(s=>s.label==='google-business-profile'&&s.channel==='googleBusiness'));
const claims=deterministicClaims(manifest);assert(claims.some(c=>c.id==='google-rating'&&c.scannerValue===4.8));assert(claims.some(c=>c.id==='google-directions-action'&&c.scannerValue===true));
const packet=evidencePacket(manifest,{});assert.equal(packet.googleBusinessProbe.profile.rating,4.8);assert(responseSchema().required.includes('googleBusinessVisualAssessments'));
console.log('openai-audit-v223 ok');
