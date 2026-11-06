// Batch A features: days in stage, stalled, deep links, outcomes, banker filters/sort/reconnect, note search, focus trap, optional columns.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const DAY=86400000, now=Date.now(), iso=ms=>new Date(ms).toISOString().slice(0,10);
const seed=[
  ["bankers","b1",{name:"Ann Lee",firm:"Marsh",relationship:"Strong",lastContact:iso(now-75*DAY),coverage:"Specialty"}],
  ["bankers","b2",{name:"Lou Medway",firm:"Aon",relationship:"Active",lastContact:iso(now-5*DAY),coverage:"Re"}],
  ["bankers","b3",{name:"Cy Dee",firm:"KBW",relationship:"Dormant",lastContact:iso(now-200*DAY),coverage:"Banks"}],
  ["bankers","b4",{name:"Di Eve",firm:"Evercore",relationship:"Developing",lastContact:"",coverage:"MGAs"}],
  ["deals","dA",{codename:"Alpha",target:"T-A",stage:"LOI",stageSince:now-10*DAY,createdAt:now-90*DAY,updatedAt:now-2*DAY,ev:100,lead:"Lead A",bankerIds:["b1"],nextStep:"Call",nextStepDate:iso(now+5*DAY)}],
  ["deals","dB",{codename:"Bravo",target:"T-B",stage:"Screening",createdAt:now-40*DAY,updatedAt:now-40*DAY,ev:20,lead:"Lead B",bankerIds:["b2"]}],
  ["deals","dC",{codename:"Charlie",target:"T-C",stage:"Diligence",createdAt:now-60*DAY,updatedAt:now-45*DAY,stageSince:now-45*DAY,ev:50,lead:"Lead C",bankerIds:[]}],
  ["deals","dD",{codename:"Delta",target:"T-D",stage:"Dead",deadReason:"Price / valuation",outcomeDate:iso(now-3*DAY),createdAt:now-100*DAY,updatedAt:now-3*DAY,ev:30}],
  ["deals","dE",{codename:"Echo",target:"T-E",stage:"Closed",outcomeDate:iso(now-20*DAY),createdAt:now-100*DAY,updatedAt:now-20*DAY,ev:70}],
  ["notes","n1",{dealId:"dC",kind:"Call",text:"QoE draft received; adjusted EBITDA within 3% of plan.",createdAt:now-2*DAY}],
  ["notes","n2",{bankerId:"b2",kind:"Meeting",text:"Breakfast about the Lloyd's syndicate pipeline.",createdAt:now-5*DAY}]
];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(vp, hash){ const ctx=await b.newContext({viewport:vp||{width:1440,height:900}}); await ctx.grantPermissions(["clipboard-read","clipboard-write"],{origin:"http://localhost:8123"});
    const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
    await p.route("**/*",r=>{const u=r.request().url(); if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    await p.addInitScript(s=>{window.__seed=s;},seed); await p.goto(BASE+(hash||"#deals")); await p.waitForTimeout(400); return p; }
  const txt=(p,sel)=>p.textContent(sel).then(t=>(t||"").replace(/\s+/g," ").trim()).catch(()=>null);
  const doc=(p,t,id)=>p.evaluate(([t,id])=>window.__mock.doc(t,id),[t,id]);

  // ---- 1. days in stage, 2. stalled
  let p=await pg();
  ok("exact days in stage", (await txt(p,'tr[data-id="dA"] .age'))==="10 days in stage", await txt(p,'tr[data-id="dA"] .age'));
  ok("estimated days in stage (no stage start)", (await txt(p,'tr[data-id="dB"] .age'))==="40+ days in stage", await txt(p,'tr[data-id="dB"] .age'));
  ok("Bravo stalled (40 days quiet)", (await p.$$('tr[data-id="dB"] .stall')).length===1);
  ok("Charlie not stalled: recent note", (await p.$$('tr[data-id="dC"] .stall')).length===0);
  ok("Alpha not stalled", (await p.$$('tr[data-id="dA"] .stall')).length===0);
  ok("stalled chip count", (await txt(p,'.fchip[data-v="stalled"] b'))==="1");
  await p.click('.fchip[data-v="stalled"]'); ok("stalled filter", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).join(",")))==="dB");
  await p.click('.fchip[data-v="active"]');
  // ---- stageSince written on stage change only
  await p.click('tr[data-id="dB"]'); await p.waitForSelector("#dealForm");
  ok("row click puts the deal in the address", (await p.evaluate(()=>location.hash))==="#deal/dB");
  await p.fill("#f_nextStep","Intro call"); await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(250);
  ok("no stageSince when stage unchanged", (await doc(p,"deals","dB")).stageSince===undefined);
  ok("save closes and returns to #deals", (await p.evaluate(()=>location.hash))==="#deals" && !(await p.isVisible("#dealForm")));
  ok("focus returns to the row", (await p.evaluate(()=>document.activeElement&&document.activeElement.dataset.id))==="dB");
  ok("no longer stalled after an update", (await p.$$('tr[data-id="dB"] .stall')).length===0);
  await p.click('tr[data-id="dB"]'); await p.waitForSelector("#dealForm"); await p.selectOption("#f_stage","NDA signed");
  await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(250);
  const sb=(await doc(p,"deals","dB")).stageSince; ok("stageSince set on stage change", sb && Math.abs(sb-Date.now())<60000, sb);
  ok("now 0 days in stage", (await txt(p,'tr[data-id="dB"] .age'))==="0 days in stage");

  // ---- 3. deep links, back, copy link, missing record
  await p.click('tr[data-id="dA"]'); await p.waitForSelector("#dealForm");
  await p.click('#drawerRoot button[data-act="copy-link"]'); await p.waitForTimeout(100);
  ok("copy link", (await p.evaluate(()=>navigator.clipboard.readText()))==="http://localhost:8123/#deal/dA" && (await txt(p,"#toastRoot"))==="Link copied");
  await p.goBack(); await p.waitForTimeout(200);
  ok("browser Back closes the drawer", !(await p.isVisible("#dealForm")) && (await p.evaluate(()=>location.hash))==="#deals");
  await p.goForward(); await p.waitForTimeout(300);
  ok("Forward reopens it", await p.isVisible("#dealForm") && (await p.inputValue("#f_codename"))==="Alpha");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("Esc closes", !(await p.isVisible("#dealForm")));
  await p.close();
  p=await pg(null,"#deal/dC");
  ok("fresh load of #deal/dC opens Charlie", await p.isVisible("#dealForm") && (await p.inputValue("#f_codename"))==="Charlie");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("closing a fresh link lands on #deals", (await p.evaluate(()=>location.hash))==="#deals" && !(await p.isVisible("#dealForm")));
  await p.close();
  p=await pg(null,"#deal/nope");
  ok("missing record: toast, no drawer", (await txt(p,"#toastRoot")).includes("isn't in the tracker") && !(await p.isVisible("#drawerRoot aside")));
  await p.close();
  p=await pg(null,"#banker/b2");
  ok("#banker/b2 opens the banker", await p.isVisible("#bankerForm") && (await p.inputValue("#b_name"))==="Lou Medway" && (await p.getAttribute('nav.tabs a[data-view="bankers"]',"aria-current"))==="page");
  await p.close();
  p=await pg(null,"#ceo");
  await p.click('tr[data-act="view-deal"][data-id="dA"]'); await p.waitForTimeout(200);
  ok("CEO view row opens the read view with link", await p.isVisible('#drawerRoot button[data-act="copy-link"]') && (await p.evaluate(()=>location.hash))==="#deal/dA" && !(await p.isVisible("#dealForm")));
  await p.click('#drawerRoot button[data-act="edit-deal"]'); await p.waitForTimeout(150);
  ok("Edit from read view switches to the form", await p.isVisible("#dealForm"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("stays on CEO view after closing", (await p.evaluate(()=>location.hash))==="#ceo");

  // ---- CEO: stalled line and outcomes
  ok("CEO view: no headline or subtitle", !(await p.$("main h2.action-title")) && !(await p.$("main p.sub")) && (await p.isVisible("button[data-act=\"board-pack\"]")));
  ok("CEO outcomes: 1 closed, 1 dropped, reason", (await txt(p,".outc")).includes("1Closed") && (await txt(p,".outc")).includes("1Dropped (dead)") && (await txt(p,".reasons")).includes("Price / valuation"), await txt(p,".outc"));
  await p.close();

  // ---- 4. outcome fields
  p=await pg();
  await p.click('tr[data-id="dA"]'); await p.waitForSelector("#dealForm");
  ok("outcome hidden while active", !(await p.isVisible("#outcomeBox")));
  await p.selectOption("#f_stage","Dead");
  ok("outcome shown for Dead, date prefilled, reason shown", await p.isVisible("#outcomeBox") && await p.isVisible("#f_deadReason") && (await p.inputValue("#f_outcomeDate"))===(await p.evaluate(()=>TODAY())));
  await p.selectOption("#f_deadReason","Lost to another buyer"); await p.fill("#f_outcomeNote","Sponsor paid 14x");
  await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(250);
  const dd=await doc(p,"deals","dA"); ok("outcome saved", dd.stage==="Dead" && dd.deadReason==="Lost to another buyer" && dd.outcomeNote==="Sponsor paid 14x" && !!dd.outcomeDate, dd);
  await p.click('.fchip[data-v="all"]'); await p.click('tr[data-id="dE"]'); await p.waitForSelector("#dealForm");
  ok("Closed shows outcome without reason", await p.isVisible("#outcomeBox") && !(await p.isVisible("#f_deadReason")));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);

  // ---- 11. note search
  await p.click('.fchip[data-v="active"]');
  await p.fill("#q","qoe"); await p.waitForTimeout(100);
  ok("note search finds Charlie with snippet", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).join(",")))==="dC" && (await txt(p,'tr[data-id="dC"] .hit')).startsWith("In a note: QoE draft"), await txt(p,'tr[data-id="dC"] .hit'));
  await p.fill("#q",""); await p.waitForTimeout(100);

  // ---- 10. focus trap
  await p.click('tr[data-id="dC"]'); await p.waitForSelector("#dealForm");
  let inside=true; for(let i=0;i<60;i++){ await p.keyboard.press("Tab"); if(!(await p.evaluate(()=>!!document.activeElement.closest("#drawerRoot .drawer")))){ inside=false; break; } }
  ok("Tab stays inside the drawer", inside);
  await p.focus('#drawerRoot .drawer-h button[data-act="copy-link"]'); await p.keyboard.press("Shift+Tab"); await p.keyboard.press("Shift+Tab");
  ok("Shift+Tab wraps to the last control", await p.evaluate(()=>!!document.activeElement.closest("#drawerRoot .drawer")));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);

  // ---- 9. optional columns when docked / narrow
  ok("Lead column shown normally", await p.isVisible('th:has(button[data-k="lead"])'));
  ok("Ask Copilot shown, no Claude panel button", await p.isVisible("#copilotBtn") && !(await p.$("#aiBtn")));
  await p.setViewportSize({width:1000,height:800}); await p.waitForTimeout(150);
  ok("hidden on a 1000px window", !(await p.isVisible('th:has(button[data-k="lead"])')) && (await p.evaluate(()=>document.documentElement.scrollWidth))<=1000);
  await p.close();

  // ---- 8. banker CRM
  p=await pg(null,"#bankers");
  ok("reconnect lists Ann (Strong, 75 days) only", (await p.$$eval(".mlist li",l=>l.map(x=>x.dataset.id).join(",")))==="b1", await p.$$eval(".mlist li",l=>l.map(x=>x.dataset.id).join(",")));
  const chips=await p.$$eval('.fchip[data-act="bfilter"]',c=>c.map(x=>x.dataset.v+":"+x.querySelector("b").textContent).join(" "));
  ok("banker chips", chips==="all:4 Strong:1 Active:1 Developing:1 Dormant:1 cold:2", chips);
  await p.click('.fchip[data-v="cold"]'); ok("cold filter", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).sort().join(",")))==="b3,b4");
  await p.click('.fchip[data-v="all"]');
  await p.click('button[data-act="bsort"][data-k="last"]'); ok("sort by last contact, oldest first, blank last", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).join(",")))==="b3,b1,b2,b4", await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).join(",")));
  await p.click('button[data-act="bsort"][data-k="rel"]'); ok("sort by relationship strength", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).join(",")))==="b1,b2,b4,b3");
  await p.fill("#bq","lloyd"); await p.waitForTimeout(100);
  ok("banker note search", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).join(",")))==="b2" && (await txt(p,'tr[data-id="b2"] .hit')).includes("Lloyd"));
  await p.fill("#bq",""); await p.waitForTimeout(100);
  await p.click('.mlist li[data-id="b1"]'); await p.waitForTimeout(200);
  ok("reconnect item opens the banker", await p.isVisible("#bankerForm") && (await p.evaluate(()=>location.hash))==="#banker/b1");
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  ok("focus returns to the reconnect item", (await p.evaluate(()=>document.activeElement&&document.activeElement.dataset.id))==="b1");
  // phone width: no overflow on the new sections
  await p.setViewportSize({width:360,height:800}); for(const v of ["bankers","deals","ceo"]){ await p.goto(BASE+"#"+v); await p.waitForTimeout(200); ok("no sideways scroll at 360 on "+v, (await p.evaluate(()=>document.documentElement.scrollWidth))<=360); }
  await p.screenshot({path:OUTDIR+"/feat-phone-ceo.png",fullPage:true});
  await p.close();

  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
