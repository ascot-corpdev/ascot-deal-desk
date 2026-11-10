// CEO dashboard: key metrics in the summaries, Needs attention tile, 90-day timeline, clickable tiles and
// stage rows, Vision 2030 type, and folding sections on phones.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const now=Date.now(), day=86400000;
const iso=ms=>{ const d=new Date(ms); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const seed=[
  ["deals","d1",{codename:"Harbor",target:"Harbor MGA",type:"Acquisition",stage:"Diligence",ev:150,gwp:260,equity:100,vision2030:"Quick hit",nextStep:"QoE readout",nextStepDate:iso(now+3*day),lead:"A. Chen",ceoSummary:"Exclusive.",updatedAt:now}],
  ["deals","d2",{codename:"Summit",type:"MGA / program",stage:"LOI",ev:40,gwp:70,vision2030:"Careful consideration",nextStep:"LOI comments",nextStepDate:iso(now-4*day),updatedAt:now}],
  ["deals","d3",{codename:"Cedar",type:"Acquisition",stage:"Screening",ev:20,vision2030:"NA",nextStep:"Management call",nextStepDate:iso(now+5*day),updatedAt:now}],
  ["deals","d4",{codename:"Oak",type:"Partnership",stage:"Screening",ev:60,gwp:"",nextStep:"Term sheet",nextStepDate:iso(now+60*day),updatedAt:now-45*day,createdAt:now-90*day}],   // stalled
  ["deals","d5",{codename:"Birch",type:"Acquisition",stage:"NDA signed",ev:10,nextStep:"Far off",nextStepDate:iso(now+120*day),updatedAt:now}],
  ["deals","d6",{codename:"Pine",type:"Acquisition",stage:"Dead",ev:5,updatedAt:now}],
  ["notes","n1",{kind:"Question",dealId:"d3",text:"Why this one?",authorId:"u-ceo",createdAt:now-day}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(vp){ const ctx=await b.newContext({viewport:vp||{width:1440,height:900}}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
    await p.route("**/*",r=>{const u=r.request().url();
      if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
      if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'});
      if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    await p.addInitScript(s=>{ window.__seed=s; },seed); await p.goto(BASE+"#ceo"); await p.waitForTimeout(500);
    await p.evaluate(()=>{ S.session.role="ceo"; render(); }); return p; }
  const txt=async (p,sel)=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();
  const rows=p=>p.$$eval("#ceoDeals tbody tr[data-id]",r=>r.map(x=>x.dataset.id).join(","));
  let p=await pg();

  // tiles
  const tiles=await p.$$eval(".tiles .tile",t=>t.map(x=>x.textContent.replace(/\s+/g," ").trim()));
  ok("four tiles, all buttons", tiles.length===4 && (await p.$$(".tiles button.tile")).length===4, tiles);
  ok("EV tile carries total GWP", tiles[2].includes("$280M") && tiles[2].includes("Total GWP $330M"), tiles[2]);
  ok("Bankers engaged tile replaced by Need attention", !tiles.join(" ").includes("Bankers engaged") && tiles[3].startsWith("3Need attention") && tiles[3].includes("1 overdue · 1 stalled · 1 open question"), tiles[3]);

  // summaries table: metrics and Vision 2030
  const heads=await p.$$eval("#ceoDeals thead th",h=>h.map(x=>x.textContent).join("|"));
  ok("columns", heads==="Deal|Stage|Vision 2030|Valuation ($M)|GWP ($M)|P/BV|Summary|Profile|Other docs", heads);
  const cells=id=>p.$$eval(`#ceoDeals tr[data-id="${id}"] td.num`,t=>t.map(x=>x.textContent.trim()).join("|"));
  ok("Harbor: 150, 260, 1.50x", (await cells("d1"))==="150|260|1.50x", await cells("d1"));
  ok("missing figures read n/d", (await cells("d4"))==="60|n/d|n/d", await cells("d4"));
  const vcell=id=>txt(p,`#ceoDeals tr[data-id="${id}"] td.vis`);
  ok("Vision 2030 in its own column, coloured", (await vcell("d1"))==="Quick hit" && !!(await p.$('#ceoDeals tr[data-id="d1"] td.vis .v-quick')) && !!(await p.$('#ceoDeals tr[data-id="d2"] td.vis .v-careful')));
  ok("NA shown as entered, unset reads Not set", (await vcell("d3"))==="NA" && (await vcell("d4"))==="Not set");
  ok("no Vision line under the name on a wide screen", !(await p.isVisible('#ceoDeals tr[data-id="d1"] div.vis')));
  ok("overdue tag on the overdue deal only", (await p.$$("#ceoDeals .odue")).length===1 && !!(await p.$('#ceoDeals tr[data-id="d2"] .odue')));

  // timeline
  ok("heading says 90 days", (await p.$$eval("h3.sec",h=>h.map(x=>x.textContent))).includes("Next 90 days"));
  ok("13 week columns plus a Late column", (await p.$$(".tl .tlc")).length===14 && (await txt(p,".tl .tlc:first-child .tll"))==="Late");
  ok("one square per dated step within 90 days (120 days out is left off)", (await p.$$(".tl .tld")).length===4 && (await p.$$(".tl .tld.tl-late")).length===1);
  ok("two steps this week stack in the first week", (await p.$$(".tl .tlc:nth-child(2) .tld")).length===2);
  ok("squares take the track colour", !!(await p.$('.tl .tld.trk-acq[data-id="d1"]')) && !!(await p.$('.tl .tld.trk-add[data-id="d4"]')));
  ok("list underneath has the 60-day step and calendar buttons", (await txt(p,"ul.mlist")).includes("Oak: Term sheet") && (await p.$$('ul.mlist button[data-act="ics-next"]')).length===4);
  await p.click('.tl .tld[data-id="d1"]'); await p.waitForTimeout(200);
  ok("clicking a square opens the deal", (await txt(p,"#drawerRoot")).includes("Harbor"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  await p.screenshot({path:OUTDIR+"/dash-desktop.png",fullPage:true});

  // drill-down
  ok("all active deals listed first", (await rows(p))==="d1,d2,d5,d4,d3", await rows(p));
  await p.click('.tiles .tile[data-v="late"]'); await p.waitForTimeout(100);
  ok("LOI or diligence tile filters the table", (await rows(p))==="d1,d2" && (await txt(p,".drillbar")).startsWith("Showing At LOI or diligence: 2 of 5 active deals") && (await p.getAttribute('.tiles .tile[data-v="late"]',"aria-pressed"))==="true", await rows(p));
  await p.click('.tiles .tile[data-v="attention"]'); await p.waitForTimeout(100);
  ok("Need attention lists overdue, stalled and asked-about deals", (await rows(p))==="d2,d4,d3", await rows(p));
  await p.click('.pipe .pr.click[data-v="stage:Screening"]'); await p.waitForTimeout(100);
  ok("stage row filters the table", (await rows(p))==="d4,d3" && !!(await p.$(".pipe .pr.on")), await rows(p));
  await p.focus('.pipe .pr.click[data-v="stage:LOI"]'); await p.keyboard.press("Enter"); await p.waitForTimeout(100);
  ok("stage row works from the keyboard", (await rows(p))==="d2", await rows(p));
  await p.click('button[data-act="ceo-drill-clear"]'); await p.waitForTimeout(100);
  ok("Show all deals clears it", (await rows(p))==="d1,d2,d5,d4,d3" && !(await p.$(".drillbar")));
  await p.click('.tiles .tile[data-v="late"]'); await p.click('.tiles .tile[data-v="late"]'); await p.waitForTimeout(100);
  ok("clicking the same tile again clears it", !(await p.$(".drillbar")));
  await p.click('.tiles .tile[data-v="late"]'); await p.click('button[data-act="ceo-track"][data-v="add"]'); await p.waitForTimeout(100);
  ok("drill-down respects the Add / Acquire filter", (await rows(p))==="d2", await rows(p));
  ok("no folding on a wide screen", !(await p.$(".cfold")));
  await p.close();

  // phone
  for(const w of [320,390]){
    p=await pg({width:w,height:800});
    const sw=await p.evaluate(()=>document.documentElement.scrollWidth); ok(`no sideways scroll at ${w}`, sw<=w, sw);
    const folds=await p.$$eval('button[data-act="ceo-fold"]',f=>f.map(x=>x.dataset.k+":"+x.getAttribute("aria-expanded")).join(" "));
    ok(`phone ${w}: tables folded, next 90 days open`, folds==="stage:false next:true deals:false changes:false outcomes:false", folds);
    ok(`phone ${w}: tiles and timeline visible, table hidden`, await p.isVisible(".tiles") && await p.isVisible(".tl") && !(await p.isVisible("#ceoDeals table")));
    await p.screenshot({path:OUTDIR+`/dash-phone-${w}.png`,fullPage:true});
    await p.click('button[data-act="ceo-fold"][data-k="deals"]'); await p.waitForTimeout(100);
    ok(`phone ${w}: heading opens the section, metrics on the card`, await p.isVisible("#ceoDeals table") && (await txt(p,'#ceoDeals tr[data-id="d1"] .summary .mob'))==="Valuation $150M · GWP $260M · P/BV 1.50x" && !(await p.isVisible('#ceoDeals tr[data-id="d1"] td.num')) && (await txt(p,'#ceoDeals tr[data-id="d1"] div.vis'))==="Vision 2030: Quick hit" && !(await p.isVisible('#ceoDeals tr[data-id="d1"] td.vis')));
    const sw2=await p.evaluate(()=>document.documentElement.scrollWidth); ok(`no sideways scroll with cards open at ${w}`, sw2<=w, sw2);
    await p.click('button[data-act="ceo-fold"][data-k="deals"]'); await p.waitForTimeout(100);
    ok(`phone ${w}: and closes it`, !(await p.isVisible("#ceoDeals table")));
    await p.click('.tiles .tile[data-v="attention"]'); await p.waitForTimeout(400);
    ok(`phone ${w}: tapping a tile opens the filtered list`, await p.isVisible("#ceoDeals table") && (await rows(p))==="d2,d4,d3", await rows(p));
    if(w===390) await p.screenshot({path:OUTDIR+"/dash-phone-drill.png",fullPage:true});
    await p.close();
  }
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})();
