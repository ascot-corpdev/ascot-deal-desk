// Team page, deal team field, Mine chip.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const DAY=86400000, now=Date.now(), iso=ms=>new Date(ms).toISOString().slice(0,10);
// me = u1 "Corp Dev 2" (username corpdev2); other = u2 "Corp Dev 1" (corpdev1)
const seed=[
  ["deals","dA",{codename:"Alpha",stage:"LOI",lead:"Corp Dev 2",nextStep:"Send LOI",nextStepDate:iso(now-2*DAY),ev:100,updatedAt:now}],
  ["deals","dB",{codename:"Bravo",stage:"Diligence",lead:"Corp Dev 1",teamIds:["u1","u2"],ev:50,updatedAt:now}],
  ["deals","dC",{codename:"Charlie",stage:"Screening",lead:"A. Chen",ev:20,updatedAt:now}],
  ["deals","dD",{codename:"Delta",stage:"NDA signed",ev:10,updatedAt:now}],
  ["deals","dE",{codename:"Echo",stage:"Closed",lead:"Corp Dev 2",ev:70,updatedAt:now}],
  ["deals","dF",{codename:"Foxtrot",stage:"Screening",lead:"corpdev1",ev:5,updatedAt:now}]
];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  const p=await b.newPage({viewport:{width:1440,height:900}}); p.on("pageerror",e=>errs.push(String(e)));
  await p.route("**/*",r=>{const u=r.request().url(); if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await p.addInitScript(s=>{window.__seed=s;},seed); await p.goto(BASE+"#team"); await p.waitForTimeout(500);
  const txt=async sel=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();
  const cardIds=async name=>p.$$eval(`.tcard:has(h3:text-is("${name}")) tbody tr`,r=>r.map(x=>x.dataset.id).join(","));
  const cardIdsYou=async ()=>p.$$eval(`.tcard:has(h3:has-text("(you)")) tbody tr`,r=>r.map(x=>x.dataset.id).join(","));
  ok("Team tab shown and current", (await p.getAttribute('nav.tabs a[data-view="team"]',"aria-current"))==="page");
  ok("headline", (await txt("h2.action-title"))==="2 people on 4 of 5 active deals; 1 with no one assigned", await txt("h2.action-title"));
  const names=await p.$$eval(".tcard h3",h=>h.map(x=>x.textContent.replace(/\s+/g," ").trim()));
  ok("cards: me first, then the other login, then non-login lead", names.join("|")==="Corp Dev 2 (you)|Corp Dev 1|A. Chen", names);
  ok("my deals: Alpha (lead, overdue first by stage) and Bravo (team); closed Echo hidden", (await cardIdsYou())==="dB,dA", await cardIdsYou());
  const roles=await p.$$eval('.tcard:has(h3:has-text("(you)")) tbody tr td:nth-child(2)',t=>t.map(x=>x.textContent.trim()));
  ok("roles shown", roles.join(",")==="Team,Lead", roles);
  ok("my summary line", (await txt('.tcard:has(h3:has-text("(you)")) .th > div > .t2'))==="2 active deals · leads 1 · $150M EV · 1 overdue", await txt('.tcard:has(h3:has-text("(you)")) .th > div > .t2'));
  ok("Corp Dev 1: Bravo (lead by name) and Foxtrot (lead by username)", (await cardIds("Corp Dev 1"))==="dB,dF", await cardIds("Corp Dev 1"));
  ok("A. Chen card for a lead without a login", (await cardIds("A. Chen"))==="dC" && (await txt('.tcard:has(h3:text-is("A. Chen")) .th .t2')).startsWith("Deal lead without a login"));
  ok("no one assigned: Delta", (await p.$$eval('section:has(h3.sec:text-is("No one assigned")) tbody tr',r=>r.map(x=>x.dataset.id).join(",")))==="dD");
  await p.click('button[data-act="team-closed"]'); await p.waitForTimeout(100);
  ok("show closed adds Echo", (await cardIdsYou())==="dB,dA,dE", await cardIdsYou());
  await p.click('button[data-act="team-closed"]');
  // open from the team page, close back to it
  await p.click('.tcard tbody tr[data-id="dA"]'); await p.waitForSelector("#dealForm");
  ok("opens the deal from the team page", (await p.evaluate(()=>location.hash))==="#deal/dA" && (await p.getAttribute('nav.tabs a[data-view="team"]',"aria-current"))==="page");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("closing returns to the team page", (await p.evaluate(()=>location.hash))==="#team" && await p.isVisible(".tgrid"));
  // assign Delta to Corp Dev 1
  await p.click('section:has(h3.sec:text-is("No one assigned")) tr[data-id="dD"]'); await p.waitForSelector("#dealForm");
  const boxes=await p.$$eval('#dealForm input[name=tm]',x=>x.map(e=>e.value+":"+e.checked).join(","));
  ok("deal team checkboxes, none ticked on Delta", boxes==="u1:false,u2:false", boxes);
  ok("lead suggestions list team names", (await p.$$eval("#leadList option",o=>o.map(x=>x.value).join(",")))==="Corp Dev 2,Corp Dev 1");
  await p.check('#dealForm input[name=tm][value="u2"]'); await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(300);
  ok("saved team", JSON.stringify(await p.evaluate(()=>window.__mock.doc("deals","dD").teamIds))==='["u2"]');
  ok("Delta now on Corp Dev 1 as Team; no one-assigned section gone", (await cardIds("Corp Dev 1")).split(",").includes("dD") && !(await p.$('section:has(h3.sec:text-is("No one assigned"))')), await cardIds("Corp Dev 1"));
  await p.click('.tcard tbody tr[data-id="dD"]'); await p.waitForSelector("#dealForm"); await p.waitForTimeout(200);
  ok("history shows the team change", (await txt("#histList")).includes("Deal team: none → Corp Dev 1"), await txt("#histList"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  // new deal defaults to me on the team
  await p.goto(BASE+"#deals"); await p.waitForTimeout(200);
  await p.click('button[data-act="new-deal"]'); await p.waitForSelector("#dealForm");
  ok("new deal: I'm ticked by default", (await p.$$eval('#dealForm input[name=tm]',x=>x.map(e=>e.value+":"+e.checked).join(",")))==="u1:true,u2:false");
  await p.fill("#f_codename","Golf"); await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(300);
  // Mine chip
  ok("Mine chip count (Alpha, Bravo, Golf)", (await txt('.fchip[data-v="mine"] b'))==="3", await txt('.fchip[data-v="mine"] b'));
  await p.click('.fchip[data-v="mine"]'); await p.waitForTimeout(100);
  ok("Mine filter", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).sort().join(",")))===["dA","dB",(await p.evaluate(()=>Object.values(window.__mock.store.deals).find(r=>r.doc.codename==="Golf").id))].sort().join(","));
  // CEO: read only
  await p.goto(BASE+"#team"); await p.waitForTimeout(200);
  await p.evaluate(()=>{ S.session.role="ceo"; render(); });
  ok("CEO sees the team page, rows open read-only", (await p.$$eval(".tcard tbody tr",r=>r.every(x=>x.dataset.act==="view-deal"))) && !(await txt(".tgrid")).includes("Tick them under Deal team"));
  await p.click('.tcard tbody tr[data-id="dA"]'); await p.waitForTimeout(200);
  ok("CEO opens the read view and stays on Team", !(await p.isVisible("#dealForm")) && await p.isVisible("#drawerRoot aside") && (await p.getAttribute('nav.tabs a[data-view="team"]',"aria-current"))==="page");
  await p.keyboard.press("Escape"); await p.evaluate(()=>{ S.session.role="corpdev"; render(); });
  await p.screenshot({path:OUTDIR+"/team-desk.png",fullPage:true});
  await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(150);
  ok("phone: tabs fit, no sideways scroll", (await p.evaluate(()=>document.documentElement.scrollWidth))<=390 && (await p.evaluate(()=>{ const n=document.querySelector("nav.tabs"); return n.scrollWidth<=n.clientWidth+1; })));
  await p.screenshot({path:OUTDIR+"/team-phone.png"});
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
