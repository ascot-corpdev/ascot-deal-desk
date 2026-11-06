// Email from the banker drawer: mailto draft, logging, Claude draft, email-all at a firm.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const seed=[["bankers","b1",{name:"Ann Lee",firm:"Marsh",title:"MD",email:"ann.tolley@marsh.com",relationship:"Strong",lastContact:"2026-09-01",context:"Project Maplewood lead"}],
  ["bankers","b2",{name:"Kai Kearsley",firm:"Marsh",email:"g.kearsley@marsh.com",relationship:"Active",lastContact:"2026-09-01"}],
  ["bankers","b3",{name:"Jem O. Jolley",firm:"Marsh (CMA team)",email:"",relationship:"Active",lastContact:"2026-09-01"}],
  ["bankers","b4",{name:"Seth Rowntree",firm:"PJT Partners",email:"",relationship:"Strong",lastContact:"2026-10-01"}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  const p=await b.newPage({viewport:{width:1440,height:900}}); p.on("pageerror",e=>errs.push(String(e)));
  await p.route("**/*",r=>{const u=r.request().url(); if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:"{}"});});
  await p.addInitScript(s=>{window.__seed=s;},seed); await p.goto(BASE+"#bankers"); await p.waitForTimeout(400);
  const T=()=>p.evaluate(()=>TODAY());
  // open Ann, write, send
  await p.click('tr[data-id="b1"]'); await p.waitForSelector("#bankerForm");
  ok("To line shows the address", ((await p.textContent("#mailTo"))||"").includes("ann.tolley@marsh.com"));
  await p.fill("#m_subject","Maplewood next steps"); await p.fill("#m_body","Hi Ann,\nCan we talk Thursday? Thanks & regards");
  await p.click('button[data-act="mail-send"]'); await p.waitForTimeout(300);
  const url=await p.evaluate(()=>S.lastMailto);
  ok("mailto draft", url==="mailto:ann.tolley@marsh.com?subject=Maplewood%20next%20steps&body=Hi%20Ann%2C%0ACan%20we%20talk%20Thursday%3F%20Thanks%20%26%20regards", url);
  const notes=await p.evaluate(()=>Object.values(window.__mock.store.notes).map(r=>r.doc));
  ok("logged as an Email note", notes.length===1 && notes[0].kind==="Email" && notes[0].bankerId==="b1" && notes[0].text.startsWith("Emailed: Maplewood next steps\nHi Ann,"), notes);
  ok("last contact moved to today", (await p.evaluate(()=>window.__mock.doc("bankers","b1").lastContact))===(await T()) && (await p.inputValue("#b_lastContact"))===(await T()));
  ok("boxes cleared after logging", (await p.inputValue("#m_subject"))==="" && (await p.inputValue("#m_body"))==="");
  ok("note shows in the drawer", ((await p.textContent("#noteList"))||"").includes("Emailed: Maplewood next steps"));
  // saving the form afterwards: no false conflict over last contact
  await p.fill("#b_title","Managing Director"); await p.click('.drawer-f button[data-act="save-banker"]'); await p.waitForTimeout(250);
  ok("save after emailing works", !(await p.isVisible("#bankerForm")) && (await p.evaluate(()=>window.__mock.doc("bankers","b1").title))==="Managing Director");
  // no logging when unticked
  await p.click('tr[data-id="b2"]'); await p.waitForSelector("#bankerForm"); await p.uncheck("#m_log"); await p.click('button[data-act="mail-send"]'); await p.waitForTimeout(200);
  ok("no subject: plain mailto; nothing logged", (await p.evaluate(()=>S.lastMailto))==="mailto:g.kearsley@marsh.com" && (await p.evaluate(()=>Object.keys(window.__mock.store.notes).length))===1);
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  // no address
  await p.click('tr[data-id="b4"]'); await p.waitForSelector("#bankerForm");
  ok("no address: explains", ((await p.textContent("#mailTo"))||"").includes("No email address yet"));
  await p.evaluate(()=>{ S.lastMailto=null; }); await p.click('button[data-act="mail-send"]'); await p.waitForTimeout(150);
  ok("no address: nothing opened, asks for it", (await p.evaluate(()=>S.lastMailto))===null && ((await p.textContent("#toastRoot"))||"").includes("Add their email address") && (await p.evaluate(()=>document.activeElement.id))==="b_email");
  await p.fill("#b_email","seth@pjtpartners.com"); await p.waitForTimeout(50);
  ok("typing an address updates the To line", ((await p.textContent("#mailTo"))||"").includes("seth@pjtpartners.com"));
  await p.click('button[data-act="mail-send"]'); await p.waitForTimeout(200);
  ok("can email right after typing it", (await p.evaluate(()=>S.lastMailto))==="mailto:seth@pjtpartners.com");
  // Copilot draft: copies a prompt and opens Copilot
  await p.evaluate(()=>{ window.__copied=null; window.__opened=null; navigator.clipboard.writeText=async t=>{ window.__copied=t; }; window.open=(u)=>{ window.__opened=u; return null; }; });
  await p.fill("#m_subject","Coffee"); await p.click('button[data-act="mail-copilot"]'); await p.waitForTimeout(300);
  const ask=await p.evaluate(()=>window.__copied);
  ok("Draft with Copilot copies a drafting prompt and opens Copilot", (ask||"").startsWith("Draft a short email from me to Seth Rowntree at PJT Partners.") && ask.includes("Subject idea: Coffee") && (await p.evaluate(()=>window.__opened))==="https://m365.cloud.microsoft/chat" && ((await p.textContent("#toastRoot"))||"").includes("Email prompt copied"), ask);
  ok("drawer stays open", await p.isVisible("#bankerForm") && !(await p.$('button[data-act="mail-ai"]')));
  await p.screenshot({path:OUTDIR+"/mail-drawer.png"});
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  // email all at a firm (grouped by firm key, so "Marsh (CMA team)" is in the Marsh group; only people with addresses)
  await p.click('button[data-act="mail-firm"][data-firm="Marsh"]'); await p.waitForTimeout(150);
  ok("email all at Marsh", (await p.evaluate(()=>S.lastMailto))==="mailto:ann.tolley@marsh.com,g.kearsley@marsh.com" && ((await p.textContent("#toastRoot"))||"").includes("Draft to 2 people at Marsh"), await p.evaluate(()=>S.lastMailto));
  ok("no Email all for PJT (address typed but not saved)", (await p.$$('button[data-act="mail-firm"][data-firm="PJT Partners"]')).length===0);
  ok("Email note kind available", (await p.evaluate(()=>NOTE_KINDS.includes("Email"))));
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
