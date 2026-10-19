import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1125,height:2000}});
await p.goto('file:///home/user/claude-praktikum/molodo-prices/prices.html');
await p.waitForTimeout(500);
const els=await p.$$('.s');
let i=1;for(const e of els){await e.screenshot({path:`molodo-${i++}.png`});}
await b.close();
