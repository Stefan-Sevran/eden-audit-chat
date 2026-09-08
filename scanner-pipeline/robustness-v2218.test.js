const assert=require('assert'); const fs=require('fs'); const os=require('os'); const path=require('path');
const {selectedAuditScreenshots}=require('./openai-audit-intelligence');
const d=fs.mkdtempSync(path.join(os.tmpdir(),'eden-v2218-')); const shot=n=>{const p=path.join(d,n);fs.writeFileSync(p,'x');return p;};
const m={facebookProbe:{authentication:{used:true,status:'authenticated-session'},screenshots:{desktop:shot('d.png'),mobile:shot('m.png'),targeted:{header:shot('h.png'),about:shot('a.png'),reviews:shot('r.png'),posts:shot('p.png')}}}};
const labels=selectedAuditScreenshots(m).map(x=>x.label);
for(const k of ['facebook-authenticated-header','facebook-authenticated-about','facebook-authenticated-reviews','facebook-authenticated-posts']) assert(labels.includes(k),k);
console.log('V2.2.18 targeted Facebook evidence regression: PASS');
