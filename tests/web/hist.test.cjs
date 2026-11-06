// Batch B: change history in drawers and "What changed" on the CEO view.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const DAY=86400000, now=Date.now(), iso=ms=>new Date(ms).toISOString().slice(0,10);
const seed=[
  ["bankers","b1",{name:"Ann Lee",firm:"Marsh",relationship:"Strong",lastContact:iso(now-5*DAY),title:"MD"}],
  ["deals","dA",{codename:"Alpha",target:"T-A",stage:"LOI",stageSince:now-10*DAY,createdAt:now-90*DAY,updatedAt:now-2*DAY,ev:100,lead:"Lead A",bankerIds:["b1"],links:[]}],
  ["deals","dB",{codename:"Bravo",target:"T-B",stage:"Screening",createdAt:now-3*DAY,updatedAt:now-3*DAY,ev:20,lead:"Lead B",bankerIds:[]}]
];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(hash, opts={}){ const p=await b.newPage({viewport:{width:1440,height:900}}); p.on("pageerror",e=>errs.push(String(e)));
    await p.route("**/*",r=>{const u=r.request().url(); if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    await p.addInitScript(([s,nh])=>{ window.__seed=s; if(nh) window.__noHistory=true; },[seed, !!opts.noHistory]); await p.goto(BASE+(hash||"#deals")); await p.waitForTimeout(400); return p; }
  const txt=(p,sel)=>p.textContent(sel).then(t=>(t||"").replace(/\s+/g," ").trim()).catch(()=>null);

  let p=await pg();
  // past history row from 20 days ago (outside the 7-day window)
  await p.evaluate(()=>window.__mock.hist("deals","dA","update",{ev:80},{ev:100},"u2",new Date(Date.now()-20*86400000).toISOString()));
  await p.click('tr[data-id="dA"]'); await p.waitForSelector("#dealForm"); await p.waitForTimeout(150);
  ok("history shows the old entry", (await txt(p,"#histList")).includes("Valuation: 80 → 100") && (await txt(p,"#histList")).includes("Corp Dev 1"), await txt(p,"#histList"));
  await p.selectOption("#f_stage","Diligence"); await p.fill("#f_nextStep","QoE kickoff");
  await p.fill('#linkRows input[data-lf="label"]', "IC memo").catch(()=>{});
  if(!(await p.$('#linkRows input[data-lf="url"]'))){ await p.click('button[data-act="add-link"]'); }
  await p.fill('#linkRows input[data-lf="label"]', "IC memo"); await p.fill('#linkRows input[data-lf="url"]', "https://x.sharepoint.com/memo.docx");
  await p.fill("#f_ceoSummary","Strong fit; QoE next.");
  await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(300);
  await p.click('tr[data-id="dA"]'); await p.waitForSelector("#dealForm"); await p.waitForTimeout(200);
  const h=await txt(p,"#histList");
  ok("my change listed with each field", h.includes("Stage: LOI → Diligence") && h.includes("Next step: blank → QoE kickoff") && h.includes("Added link: IC memo") && h.includes("CEO summary edited") && h.includes("Corp Dev 2"), h);
  ok("bookkeeping fields not listed", !/updatedAt|stageSince|Updated/i.test(h), h);
  // someone else saves while I have it open: list refreshes
  await p.evaluate(()=>window.__mock.otherSave("deals","dA",{priority:"High"}));
  await p.waitForTimeout(600);
  ok("live refresh shows the other person's change", (await txt(p,"#histList")).startsWith(new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})) && (await txt(p,"#histList")).includes("Priority: blank → High"), await txt(p,"#histList"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  // new deal + delete
  await p.click('button[data-act="new-deal"]'); await p.waitForSelector("#dealForm"); await p.fill("#f_codename","Zulu"); await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(250);
  await p.click('tr[data-id="dB"]'); await p.waitForSelector("#dealForm"); await p.click('button[data-act="del-deal"]'); await p.click('button[data-act="del-deal-yes"]'); await p.waitForTimeout(250);
  // banker history
  await p.goto(BASE+"#bankers"); await p.waitForTimeout(200); await p.click('tr[data-id="b1"]'); await p.waitForSelector("#bankerForm");
  await p.fill("#b_title","Managing Director"); await p.click('.drawer-f button[data-act="save-banker"]'); await p.waitForTimeout(250);
  await p.click('tr[data-id="b1"]'); await p.waitForSelector("#bankerForm"); await p.waitForTimeout(150);
  ok("banker history", (await txt(p,"#histList")).includes("Title: MD → Managing Director"), await txt(p,"#histList"));
  await p.keyboard.press("Escape");

  // CEO: what changed
  await p.goto(BASE+"#ceo"); await p.waitForTimeout(400);
  const w=await txt(p,".mlist.chg");
  ok("what changed: stage move", w.includes("Alpha moved LOI → Diligence"), w);
  ok("what changed: new doc", w.includes("New doc on Alpha: IC memo"), w);
  ok("what changed: summary", w.includes("CEO summary updated for Alpha"), w);
  ok("what changed: new deal", w.includes("New deal: Zulu"), w);
  ok("what changed: deleted deal named", w.includes("Bravo deleted"), w);
  ok("what changed: old EV change outside 7 days hidden", !w.includes("EV $80M"), w);
  await p.selectOption("#chgDays","30"); await p.waitForTimeout(300);
  ok("30 days includes the older EV change", (await txt(p,".mlist.chg")).includes("Alpha EV $80M → $100M"), await txt(p,".mlist.chg"));
  await p.click('.mlist.chg li.click >> nth=0'); await p.waitForTimeout(250);
  ok("clicking an item opens the deal", await p.isVisible("#drawerRoot aside") && (await p.evaluate(()=>location.hash)).startsWith("#deal/"));
  ok("read view has history too", (await txt(p,"#histList")).length>10);
  await p.screenshot({path:OUTDIR+"/hist-ceo-drawer.png"});
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  await p.screenshot({path:OUTDIR+"/hist-ceo.png",fullPage:true});
  await p.close();

  // history table not installed yet: graceful fallback
  p=await pg("#deals",{noHistory:true});
  await p.click('tr[data-id="dA"]'); await p.waitForSelector("#dealForm"); await p.waitForTimeout(150);
  ok("drawer explains how to switch history on", (await txt(p,"#histList")).includes("History isn't switched on yet"));
  await p.keyboard.press("Escape");
  await p.goto(BASE+"#ceo"); await p.waitForTimeout(300);
  const f=await txt(p,"section.cols:has(.chgbar)");
  ok("CEO fallback lists recent records and explains", f.includes("New deal: Bravo") && f.includes("Alpha updated") && f.includes("Showing latest updates only"), f);
  await p.close();

  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
