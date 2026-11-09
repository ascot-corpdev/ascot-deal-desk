// Saved Kensho results (kensho_store): pages open from the last fetch, Kensho is asked only on Refresh or when
// nothing is saved; stale and unsaved notes; refresh failures keep the old figures; no table = ask every visit.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs"); const path=require("path");
const WEB=path.join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
const SAMPLE=JSON.parse(fs.readFileSync(path.join(__dirname,"../fixtures/comps_sample.json"),"utf8"));
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const PEERS=["WRB","MKL","RLI","KNSL","SKWD","ACGL","AXS","EG","HG","BOW","PLMR","SIGI","LSE:HSX","LSE:LRE"];
const LEAGUE={asOf:"2026-11-01T09:00:00Z",since:"2023-11-01",years:3,tickers:PEERS,companies:[],errors:{},dropped:0,source:"S&P Global Capital IQ via Kensho",
  deals:[{id:"1",announced:"2025-02-03",closed:null,status:"Closed",target:"Example Specialty Holdings",buyers:["Sample Insurance Group"],sellers:[],valueM:null,currency:null,via:["WRB"],advisors:[{name:"Evercore Group L.L.C.",type:"Financial Advisor",side:"sell",client:"Example Specialty Holdings"}]}]};

(async()=>{
  const b=await chromium.launch(); const errs=[];
  const ctx=await b.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
  const calls=[]; let mode="ok", delay=0;
  await p.route("**/*",async r=>{const u=r.request().url();
    const m=u.match(/functions\/v1\/(comps|league)$/);
    if(m){ const body=JSON.parse(r.request().postData()||"{}"); calls.push({fn:m[1], body});
      if(delay) await new Promise(res=>setTimeout(res,delay));
      if(mode==="fail") return r.fulfill({status:502,contentType:"application/json",body:JSON.stringify({error:"kensho",message:"Kensho didn't answer. Try again in a minute."})}).catch(()=>{});
      const out = m[1]==="comps" ? {...SAMPLE, period:body.period, tickers:body.tickers, companies:SAMPLE.companies.map(c=>({...c, name:c.name+" (fresh)"})), saved:mode!=="unsaved"} : {...LEAGUE, tickers:body.companies, saved:mode!=="unsaved"};
      return r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(out)}).catch(()=>{}); }
    if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
    if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'});
    if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await p.addInitScript(()=>{ try{ localStorage.removeItem("dealdesk.compsPeriod"); localStorage.setItem("dealdesk.bankerMode","league"); }catch{} });
  const txt=async sel=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();
  const seedStore=async(rows)=>p.evaluate(rows=>{ for(const [id,doc,at] of rows) window.__mock.store.kensho_store[id]={id,doc,fetched_at:at}; },rows);
  const names=async()=>p.$$eval("table.comps tbody tr",rs=>rs.map(r=>r.querySelector(".t1")?r.querySelector(".t1").textContent:r.textContent.trim().slice(0,30)));

  // ---- saved copy: opens without asking Kensho
  await p.goto(BASE+"#deals"); await p.waitForTimeout(300);
  await seedStore([["comps:quarter",{...SAMPLE, period:"quarter", tickers:PEERS},"2026-11-01T09:00:00+00:00"],["comps:ltm",{...SAMPLE, period:"ltm", tickers:["WRB"]},"2026-10-20T09:00:00+00:00"],["league:3",LEAGUE,"2026-11-01T09:00:00+00:00"]]);
  await p.goto(BASE+"#comps"); await p.waitForTimeout(500);
  ok("comps open from the saved copy, Kensho not asked", calls.length===0 && (await p.$$("table.comps tbody tr")).length>=2 && !(await names()).some(n=>/fresh/.test(n)), [calls, await names()]);
  ok("says when it was fetched", (await txt(".ceohead .sub")).includes("Last fetched 1 Nov 2026") && (await txt(".ceohead .sub")).includes("Refresh asks Kensho again"));
  ok("no out-of-date or setup notes", !(await p.$(".savednote")));
  await p.goto(BASE+"#ceo"); await p.waitForTimeout(400);
  ok("CEO view peer strip from the saved copy too", calls.length===0 && (await txt("body")).includes("Peer benchmarks"));
  await p.goto(BASE+"#comps"); await p.waitForTimeout(300);
  ok("going back: still no request", calls.length===0);

  // ---- Refresh: asks Kensho, keeps the old figures on screen meanwhile
  delay=600; await p.click('button[data-act="comps-refresh"]'); await p.waitForTimeout(200);
  ok("refreshing: old table stays, note and disabled button", (await p.$$("table.comps tbody tr")).length>=2 && (await txt(".savednote")).includes("Refreshing from Kensho") && await p.isDisabled('button[data-act="comps-refresh"]'));
  await p.waitForTimeout(700); delay=0;
  ok("refresh: one request with refresh:true for the peers and period", calls.length===1 && calls[0].fn==="comps" && calls[0].body.refresh===true && calls[0].body.period==="quarter" && calls[0].body.tickers.length===14, calls);
  ok("refresh: new figures shown", (await names()).filter(n=>!/^Median/.test(n)).every(n=>/fresh/.test(n)), await names());

  // ---- nothing saved for a period: asks Kensho by itself, once
  await p.click('button[data-act="comps-period"][data-v="ytd"]'); await p.waitForTimeout(400);
  ok("YTD not saved: fetched automatically", calls.length===2 && calls[1].body.period==="ytd" && calls[1].body.refresh===true);
  await p.click('button[data-act="comps-period"][data-v="quarter"]'); await p.click('button[data-act="comps-period"][data-v="ytd"]'); await p.waitForTimeout(300);
  ok("switching back and forth: no more requests", calls.length===2);

  // ---- saved for a different peer list: shown, marked out of date
  await p.click('button[data-act="comps-period"][data-v="ltm"]'); await p.waitForTimeout(300);
  ok("LTM saved for another list: shown with an out-of-date note, not refetched", calls.length===2 && (await txt(".savednote")).includes("The peer list has changed since these figures were fetched"), await txt(".savednote"));
  await p.click('.savednote button[data-act="comps-refresh"]'); await p.waitForTimeout(400);
  ok("refresh from the note clears it", calls.length===3 && calls[2].body.period==="ltm" && !(await p.$(".savednote")));

  // ---- refresh fails: old figures stay, with the reason
  mode="fail"; await p.click('button[data-act="comps-refresh"]'); await p.waitForTimeout(400);
  ok("failed refresh: banner, figures kept", (await p.$$eval(".banner",bs=>bs.map(x=>x.textContent).join(" "))).includes("Kensho didn't answer") && (await p.$$("table.comps tbody tr")).length>=2);
  mode="ok";

  // ---- the function couldn't save
  mode="unsaved"; await p.click('button[data-act="comps-refresh"]'); await p.waitForTimeout(400); mode="ok";
  ok("unsaved fetch: Corp Dev told to redeploy", (await txt(".savednote")).includes("couldn't be saved") && (await txt(".savednote")).includes("Redeploy the comps function"));
  await p.evaluate(()=>{ S.session.role="ceo"; render(); });
  ok("CEO: no setup notes", !(await p.$(".savednote")));
  await p.evaluate(()=>{ S.session.role="corpdev"; render(); });

  // ---- league table: saved copy, refresh on click
  const n0=calls.length;
  await p.goto(BASE+"#bankers"); await p.waitForTimeout(400);
  ok("league table opens from the saved copy", calls.length===n0 && (await p.$$("table.lgtbl tr.lgrow")).length===1 && (await txt(".toolbar")).includes("Last fetched 1 Nov 2026"), calls.slice(n0));
  await p.click('button[data-act="lg-refresh"]'); await p.waitForTimeout(400);
  ok("league Refresh asks Kensho with refresh:true", calls.length===n0+1 && calls[n0].fn==="league" && calls[n0].body.refresh===true && calls[n0].body.years===3);
  await p.click('button[data-act="lg-years"][data-v="5"]'); await p.waitForTimeout(400);
  ok("5 years not saved: fetched automatically", calls.length===n0+2 && calls[n0+1].body.years===5);

  // ---- saving a new company list fetches for it
  await p.click('button[data-act="lg-years"][data-v="3"]'); await p.waitForTimeout(200);
  await p.click('button[data-act="lg-edit"]'); await p.fill("#lg_extra","HCI"); await p.click('button[data-act="lg-save"]'); await p.waitForTimeout(500);
  const last=calls[calls.length-1];
  ok("new company list: fetched at once", last.fn==="league" && last.body.companies.includes("HCI") && last.body.refresh===true, last);

  // ---- no kensho_store table: ask every visit, Corp Dev sees the 0007 note
  const ctx2=await b.newContext({viewport:{width:1440,height:900}}); const q=await ctx2.newPage(); q.on("pageerror",e=>errs.push(String(e)));
  const calls2=[];
  await q.route("**/*",async r=>{const u=r.request().url();
    if(u.endsWith("/functions/v1/comps")){ calls2.push(1); return r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...SAMPLE, tickers:PEERS, saved:false})}); }
    if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
    if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'});
    if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await q.addInitScript(()=>{ window.__noStore=true; });
  await q.goto(BASE+"#comps"); await q.waitForTimeout(500);
  const t2=((await q.textContent(".savednote").catch(()=>""))||"").replace(/\s+/g," ");
  ok("no table: fetched, and Corp Dev told to run 0007", calls2.length===1 && t2.includes("0007_kensho_store.sql") && !t2.includes("couldn't be saved"), t2);
  await q.screenshot({path:OUTDIR+"/saved-nostore.png",fullPage:false});

  await p.goto(BASE+"#comps"); await p.waitForTimeout(300);
  await p.screenshot({path:OUTDIR+"/saved-comps.png",fullPage:false});
  ok("no page errors", errs.length===0, errs);
  await b.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
