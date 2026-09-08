const path = require('path');
const fs = require('fs');
const readline = require('readline');

function loadPlaywright() {
  try { return require('playwright'); }
  catch { throw new Error('Playwright is not installed. Run npm install and npx playwright install chromium first.'); }
}

async function main() {
  const { chromium } = loadPlaywright();
  const args = process.argv.slice(2);
  const idx = args.indexOf('--session');
  const sessionPath = path.resolve(idx >= 0 && args[idx+1] ? args[idx+1] : '.eden-facebook-session.json');
  const browser = await chromium.launch({ headless:false });
  const context = await browser.newContext({ viewport:{width:1280,height:900}, locale:'en-US', ignoreHTTPSErrors:true });
  const page = await context.newPage();
  console.log('[facebook-auth] Opening Facebook in a normal browser window…');
  console.log('[facebook-auth] Log in manually. Do NOT paste your password into this terminal.');
  await page.goto('https://www.facebook.com/', { waitUntil:'domcontentloaded', timeout:60000 }).catch(()=>{});
  const rl = readline.createInterface({ input:process.stdin, output:process.stdout });
  await new Promise(resolve => rl.question('[facebook-auth] When Facebook is fully logged in, press Enter here to save the local session… ', () => { rl.close(); resolve(); }));
  await context.storageState({ path:sessionPath });
  await browser.close();
  try { fs.chmodSync(sessionPath, 0o600); } catch {}
  console.log(`[facebook-auth] Saved session: ${sessionPath}`);
  console.log('[facebook-auth] Keep this file private. It can act like a logged-in browser session. Delete it any time to revoke local reuse.');
}

main().catch(err => { console.error(`[facebook-auth] Failed: ${err.stack || err.message}`); process.exit(1); });
