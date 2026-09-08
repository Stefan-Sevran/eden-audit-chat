const fs=require('fs');
const path=require('path');

function loadPlaywright(){
  try{return require('playwright');}
  catch{throw new Error('Playwright is not installed. Run npm install first.');}
}

(async()=>{
  const args=process.argv.slice(2);
  const htmlArg=args.find(a=>!a.startsWith('--'));
  const outFlag=args.indexOf('--out');
  if(!htmlArg){
    console.error('Usage: node scanners/render-report-pdf.js audit-output/<clinic>/report/index.html [--out clinic-audit.pdf]');
    process.exit(1);
  }
  const htmlPath=path.resolve(htmlArg);
  if(!fs.existsSync(htmlPath))throw new Error(`Report HTML not found: ${htmlPath}`);
  const pdfPath=outFlag>=0&&args[outFlag+1]?path.resolve(args[outFlag+1]):path.join(path.dirname(htmlPath),'eden-clinic-audit.pdf');
  const {chromium}=loadPlaywright();
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(`file://${htmlPath}`,{waitUntil:'load'});
    await page.emulateMedia({media:'print'});
    await page.pdf({path:pdfPath,format:'A4',printBackground:true,margin:{top:'10mm',right:'10mm',bottom:'10mm',left:'10mm'}});
    console.log(`Eden Audit PDF complete: ${pdfPath}`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
