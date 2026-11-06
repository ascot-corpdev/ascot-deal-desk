const { chromium } = require("playwright"); const fs=require("fs");
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://deal.test/";
let pass=0,fail=0; const ok=(n,c,x)=>{ if(c){pass++;} else {fail++; console.log("FAIL "+n+" "+JSON.stringify(x));} };
const seed=[["bankers","b1",{name:"Ann",firm:"Marsh",relationship:"Strong",lastContact:"2026-10-01"}]];
[["A","Screening",50,"2026-12-01",3],["B","LOI",800,"2026-10-01",1],["C","Diligence","", "",2],["D","Dead",5,"2026-09-01",4],["E","IOI",6.5,"2026-10-15",5]]
 .forEach(([c,st,ev,nd,u])=>seed.push(["deals","d"+c,{codename:c,stage:st,ev,nextStepDate:nd,priority:["High","Low","Medium","High","Low"][u-1],lead:"L"+u,updatedAt:u*1000,bankerIds:["b1"]}]));
(async()=>{ const b=await chromium.launch(); const errs=[];
 async function pg(vp){ const p=await b.newPage({viewport:vp}); p.on("pageerror",e=>errs.push(String(e)));
  await p.route("**/*",r=>{const u=r.request().url(); if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await p.addInitScript(s=>{window.__seed=s;},seed); await p.goto(BASE+"#deals"); await p.waitForSelector("tr[data-id]"); return p; }
 const order=p=>p.$$eval("tbody tr[data-id]",rs=>rs.map(r=>r.dataset.id.slice(1)).join(""));
 const p=await pg({width:1280,height:900});
 ok("default order: active by stage", await order(p)==="ABEC", await order(p));
 ok("overdue rows marked", (await p.$$eval("tr.late",rs=>rs.map(r=>r.dataset.id).join(",")))==="dB,dE");
 await p.click('button[data-k="ev"]'); ok("EV desc, blank last", await order(p)==="BAEC", await order(p));
 ok("aria-sort descending", await p.getAttribute('th:has(button[data-k="ev"])',"aria-sort")==="descending");
 await p.click('button[data-k="ev"]'); ok("EV asc, blank still last", await order(p)==="EABC", await order(p));
 await p.click('button[data-k="ev"]'); ok("third click resets", await order(p)==="ABEC" && await p.getAttribute('th:has(button[data-k="ev"])',"aria-sort")==="none");
 await p.click('button[data-k="next"]'); ok("next step asc, blank last", await order(p)==="BEAC", await order(p));
 await p.click('button[data-k="priority"]'); ok("priority High>Med>Low", await order(p)==="BAEC", await order(p));
 await p.click('button[data-k="updated"]'); ok("updated newest first", await order(p)==="EACB", await order(p));
 await p.click('button[data-k="deal"]');
 ok("chip counts", (await p.$$eval(".fchip",c=>c.map(x=>x.dataset.v+":"+x.querySelector("b").textContent).join(" ")))==="active:4 overdue:2 stalled:4 Screening:1 LOI:2 Diligence:1 Dead:1 all:5");
 await p.click('.fchip[data-v="overdue"]'); ok("overdue filter", await order(p)==="BE" && await p.getAttribute('.fchip[data-v="overdue"]',"aria-pressed")==="true", await order(p));
 await p.click('.fchip[data-v="Dead"]'); ok("stage filter Dead", await order(p)==="D");
 await p.click('.fchip[data-v="all"]'); ok("all", await order(p)==="ABCDE", await order(p));
 await p.fill("#q","B"); await p.waitForTimeout(50); ok("chip counts follow search", (await p.textContent('.fchip[data-v="all"] b'))==="1");
 await p.fill("#q","");
 ok("pill steps", (await p.$$eval('tr[data-id="dB"] .pill .stp i.on',x=>x.length))===3 && (await p.$$eval('tr[data-id="dD"] .pill .stp',x=>x.length))===0);
 ok("IOI deal shows as LOI", (await p.textContent('tr[data-id="dE"] .pill')).trim()==="LOI");
 ok("no IOI/Signed chips", (await p.$$('.fchip[data-v="IOI"], .fchip[data-v="Signed"]')).length===0);
 await p.click('tr[data-id="dE"]'); await p.waitForSelector("#dealForm");
 const opts=await p.$$eval("#f_stage option",o=>o.map(x=>x.textContent).join(","));
 ok("stage list", opts==="Screening,NDA signed,LOI,Diligence,Closed,On hold,Dead", opts);
 ok("IOI deal opens with LOI selected", await p.inputValue("#f_stage")==="LOI");
 const heads=await p.$$eval("#dealForm h3.sec",h=>h.map(x=>x.textContent).join("|"));
 ok("form grouped", heads.startsWith("Basics|Economics|Next step|Outcome|Summary for the CEO"), heads);
 ok("last saved line", /Last saved .* by /.test(await p.textContent(".lastsaved")));
 await p.fill("#f_nextStep","x"); await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(150);
 ok("save on an IOI deal without touching stage: no conflict", !(await p.isVisible("#dealForm")));
 await p.click('tr[data-id="dE"]'); await p.waitForSelector("#dealForm"); await p.selectOption("#f_stage","Diligence"); await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(150);
 ok("stage change writes the new value", (await p.evaluate(()=>window.__mock.doc("deals","dE").stage))==="Diligence");
 await p.evaluate(()=>window.__mock.doc("deals","dE"));
 await p.goto(BASE+"#ceo"); await p.waitForTimeout(300);
 ok("CEO pipeline shows the 4 active stages", (await p.$$eval(".pipe .pr:not(.ph):not(.pt)",r=>r.length))===4);
 await p.goto(BASE+"#deals"); await p.waitForSelector("tr[data-id]");
 await p.click('.fchip[data-v="all"]'); await p.click('button[data-k="deal"]'); await p.click('button[data-k="deal"]'); await p.click('button[data-k="deal"]');
 await p.click('.fchip[data-v="active"]');
 // keyboard: sort button focusable, Enter sorts
 await p.focus('button[data-k="lead"]'); await p.keyboard.press("Enter"); ok("keyboard sort", await p.getAttribute('th:has(button[data-k="lead"])',"aria-sort")==="ascending");
 // phone
 for(const w of [320,390]){ const m=await pg({width:w,height:800});
  for(const v of ["ceo","deals","bankers"]){ await m.goto(BASE+"#"+v); await m.waitForTimeout(300);
   const sw=await m.evaluate(()=>document.documentElement.scrollWidth); ok(`no horizontal scroll ${w} ${v}`, sw<=w, sw); }
  await m.goto(BASE+"#deals"); await m.waitForTimeout(300);
  ok(`hidden cells hidden on even cards ${w}`, await m.$$eval("table.cards td.c-hide",tds=>tds.every(t=>getComputedStyle(t).display==="none")));
  await m.click("#whoDot"); ok("menu opens", await m.isVisible("#whoMenu") && await m.getAttribute("#whoDot","aria-expanded")==="true");
  await m.click("footer.foot"); ok("menu closes on outside click", !(await m.isVisible("#whoMenu")));
  await m.click("#whoDot"); await m.click('#whoMenu button[data-act="change-pw"]'); await m.waitForTimeout(100);
  ok("menu change password opens drawer, menu closed", await m.isVisible("#pwForm") && !(await m.isVisible("#whoMenu")));
  await m.keyboard.press("Escape"); await m.click('tr[data-id="dB"]'); await m.waitForTimeout(100); ok("card tap opens editor", await m.isVisible("#dealForm"));
  await m.keyboard.press("Escape"); await m.click("#whoDot"); await m.keyboard.press("Escape"); ok("Esc closes menu", !(await m.isVisible("#whoMenu")));
  await m.click("#whoDot"); await m.click('#whoMenu button[data-act="signout"]'); await m.waitForTimeout(200); ok("menu sign out", await m.isVisible("#loginForm"));
  await m.close(); }
 ok("no page errors", errs.length===0, errs);
 console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0); })();
