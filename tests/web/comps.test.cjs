// Comps page, settings (peers + AGL link), CEO strip, board pack slide. The comps function is served
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
// with the real function's output (deno/comps_sample.json) or its error answers.
const { chromium } = require("playwright"); const fs=require("fs"); const path=require("path");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
const SAMPLE=fs.readFileSync(path.join(__dirname,"../fixtures/comps_sample.json"),"utf8");
const PPTX=fs.readFileSync(require("path").join(__dirname,"../../node_modules/pptxgenjs/dist/pptxgen.bundle.js"),"utf8");
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const seed=[["deals","d1",{codename:"Harbor",stage:"LOI",ev:100,updatedAt:Date.now()}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(mode, opts={}){ const ctx=await b.newContext({viewport:opts.vp||{width:1440,height:900},acceptDownloads:true}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e))); p.compsCalls=[];
    await p.route("**/*",r=>{const u=r.request().url();
      if(u==="https://a.supabase.co/functions/v1/comps"){ const req=r.request(); p.compsCalls.push({body:JSON.parse(req.postData()||"{}"), auth:req.headers()["authorization"], apikey:req.headers()["apikey"]});
        if(p.mode==="abort") return r.abort("failed");
        if(p.mode==="ok"){ const per=JSON.parse(req.postData()||"{}").period||"quarter"; if(per==="quarter") return r.fulfill({status:200,contentType:"application/json",body:SAMPLE});
          const d=JSON.parse(SAMPLE); d.period=per; d.companies.forEach(c=>{ c.quarter=(per==="ytd"?"9M ":"LTM Q3 ")+"2026"; c.premiums=(c.premiums||0)*3; }); return r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(d)}); }
        if(p.mode==="nc") return r.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"not_configured",message:"Kensho isn't connected yet."})});
        if(p.mode==="auth") return r.fulfill({status:502,contentType:"application/json",body:JSON.stringify({error:"kensho_auth",message:"Kensho sign-in failed (401). Check the Kensho credentials on the comps function."})});
        return r.fulfill({status:404,contentType:"application/json",body:'{"code":"NOT_FOUND","message":"Requested function was not found"}'}); }
      if(u==="https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js") return r.fulfill({contentType:"application/javascript",body:PPTX});
      if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    p.mode=mode; await p.addInitScript(([s,ns])=>{ window.__seed=s; if(ns) window.__noSettings=true; },[seed,!!opts.noSettings]); await p.goto(BASE+(opts.hash||"#comps")); await p.waitForTimeout(500); return p; }
  const txt=async (p,sel)=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();

  // not deployed / not configured / bad credentials
  let p=await pg("404");
  ok("Comps tab current", (await p.getAttribute('nav.tabs a[data-view="comps"]',"aria-current"))==="page");
  ok("not deployed: explains", (await txt(p,".banner")).includes("comps function isn't deployed yet"));
  ok("default peers requested with the user's token", JSON.stringify(p.compsCalls[0].body.tickers)===JSON.stringify(["WRB","MKL","RLI","KNSL","SKWD","ACGL","AXS","EG","HG","BOW","PLMR","SIGI","LSE:HSX","LSE:LRE"]) && p.compsCalls[0].auth==="Bearer t" && p.compsCalls[0].apikey==="sb_publishable_k", p.compsCalls[0]);
  p.mode="abort"; await p.click('button[data-act="comps-refresh"] >> nth=0'); await p.waitForTimeout(300);
  const nb=await txt(p,".banner");
  ok("unreachable (Failed to fetch): lists the three checks with this site's address", nb.includes("Couldn't reach the comps function") && nb.includes("supabase functions deploy comps --no-verify-jwt") && nb.includes("ALLOWED_ORIGIN") && nb.includes("http://localhost:8123") && (await p.$$('.banner button[data-act="comps-refresh"]')).length===1, nb);
  p.mode="nc"; await p.click('button[data-act="comps-refresh"] >> nth=0'); await p.waitForTimeout(300);
  ok("not configured: explains", (await txt(p,".banner")).includes("Kensho isn't connected yet"));
  p.mode="auth"; await p.click('button[data-act="comps-refresh"] >> nth=0'); await p.waitForTimeout(300);
  ok("bad credentials: shows Kensho's reason and Try again", (await txt(p,".banner")).includes("Kensho sign-in failed (401)") && (await p.$$('.banner button[data-act="comps-refresh"]')).length===1);
  await p.goto(BASE+"#ceo"); await p.waitForTimeout(300);
  ok("CEO view: no benchmark strip when Kensho isn't answering", !(await p.$('h3.sec:text-is("Peer benchmarks")')));
  await p.close();

  // data
  p=await pg("ok");
  const rows=await p.$$eval("table.comps tbody tr:not(.med)",r=>r.map(x=>[...x.querySelectorAll("td")].map(t=>t.textContent.replace(/\s+/g," ").trim())));
  ok("two companies, largest market cap first", rows.length===2 && rows[0][0].startsWith("W. R. Berkley Corporation"), rows.map(r=>r[0]));
  const w=rows[0];
  ok("WRB row formatted", w[1]==="Q3 2026" && w[2]==="3,739" && w[3]==="3,214" && w[4]==="+10.0%" && w[5]==="446" && w[6]==="62.2%" && w[7]==="93.8%" && w[8]==="18.6%" && w[9]==="+0.2%BVPS 24.73" && w[10]==="29,832" && w[11]==="3.10x" && w[12]==="17.5x" && w[13].startsWith("19 Oct") && w[13].includes("Next: 25 Jan 2027"), w);
  const h=rows[1];
  ok("Hiscox: GBP market cap flagged, no P/B or P/E", h[0].includes("Market cap in GBP") && h[10].includes("GBP") && h[11]==="n/d" && h[12]==="n/d" && h[7]==="n/d" && h[9]==="n/d" && h[0].includes("No share count for book value per share"), h);
  const med=await p.$$eval("table.comps tr.med td",t=>t.map(x=>x.textContent.trim()));
  ok("median row", med[0]==="Median (derived)" && med[8]==="19.3%" && med[6]==="62.2%" && med[7]==="93.8%" && med[9]==="+0.2%", med);
  ok("unresolved ticker listed", (await txt(p,"main")).includes("Not shown: NOPE"));
  ok("title shows the quarter when all peers match", (await txt(p,"h2.action-title")).startsWith("Public comps: latest quarter"));
  ok("source line names S&P via Kensho and derived measures", (await txt(p,"p.source")).includes("S&P Global Capital IQ via Kensho") && (await txt(p,"p.source")).includes("(derived)"));
  ok("combined ratio cell shows the expense ratio on hover", (await p.getAttribute("table.comps tbody tr:first-child td:nth-child(8)","title"))==="Expense ratio 31.6%");
  ok("source line explains combined ratio and BVPS growth", (await txt(p,"p.source")).includes("combined ratio = operating expenses excluding non-insurance") && (await txt(p,"p.source")).includes("BVPS growth = equity / shares outstanding"));
  await p.click('button[data-act="csort"][data-k="combinedRatio"]'); await p.waitForTimeout(100);
  ok("sort by combined ratio (lowest first, blanks last)", (await p.$$eval("table.comps tbody tr:not(.med) td:first-child .t1",x=>x.map(e=>e.textContent))).join("|")==="W. R. Berkley Corporation|Hiscox Ltd");
  await p.click('button[data-act="csort"][data-k="roe"]'); await p.waitForTimeout(100);
  ok("sort by ROE (highest first)", (await p.$$eval("table.comps tbody tr:not(.med) td:first-child .t1",x=>x.map(e=>e.textContent)))[0]==="Hiscox Ltd");
  ok("no AGL button yet; Corp Dev sees Add AGL financials link", !(await p.$("a.linkbtn")) && (await p.$$('button[data-act="comps-settings"]')).length===2);
  // settings
  await p.click('button[data-act="comps-settings"] >> nth=1'); await p.waitForSelector("#compsForm");
  await p.fill("#cs_peers","wrb, lse:hsx\nbad ticker!"); await p.click('button[data-act="comps-save"]'); await p.waitForTimeout(100);
  ok("bad ticker refused", ((await txt(p,"#toastRoot"))).includes("doesn't look like a ticker"));
  await p.fill("#cs_peers","wrb, lse:hsx\nWRB"); await p.fill("#cs_agl","http://insecure.example/agl"); await p.click('button[data-act="comps-save"]'); await p.waitForTimeout(100);
  ok("non-https link refused", (await txt(p,"#toastRoot")).includes("https://"));
  const n0=p.compsCalls.length;
  await p.fill("#cs_agl","https://ascot.sharepoint.com/sites/Finance/AGL%20Q3%202026.pdf"); await p.click('button[data-act="comps-save"]'); await p.waitForTimeout(400);
  const stored=await p.evaluate(()=>window.__mock.store.settings.benchmark&&window.__mock.store.settings.benchmark.doc);
  ok("settings saved: peers deduped and uppercased, link kept, no financials stored", JSON.stringify(stored.peers)==='["WRB","LSE:HSX"]' && stored.aglUrl==="https://ascot.sharepoint.com/sites/Finance/AGL%20Q3%202026.pdf" && Object.keys(stored).sort().join(",")==="aglUrl,peers,updatedAt,updatedBy,updatedByName", stored);
  ok("comps refetched with the new peers", p.compsCalls.length===n0+1 && JSON.stringify(p.compsCalls[n0].body.tickers)==='["WRB","LSE:HSX"]', p.compsCalls.slice(n0));
  const a=await p.$("a.linkbtn");
  ok("AGL financials button opens the link in a new tab", a && (await a.getAttribute("href"))==="https://ascot.sharepoint.com/sites/Finance/AGL%20Q3%202026.pdf" && (await a.getAttribute("target"))==="_blank" && (await a.getAttribute("rel")).includes("noopener"));
  // CEO view strip
  await p.goto(BASE+"#ceo"); await p.waitForTimeout(300);
  const strip=await txt(p,'section:has(h3.sec:text-is("Peer benchmarks"))');
  ok("CEO strip: medians, link to comps and AGL", strip.includes("+10.0%") && strip.includes("19.3%") && strip.includes("Median combined ratio (derived)") && strip.includes("93.8%") && strip.includes("Median BVPS growth") && strip.includes("+0.2%") && strip.includes("All comps") && strip.includes("AGL financials"), strip);
  ok("comps cached in the page (no extra call for the CEO view)", p.compsCalls.length===n0+1);
  await p.screenshot({path:OUTDIR+"/comps-ceo.png",fullPage:true});
  // board pack slide
  const [dl]=await Promise.all([p.waitForEvent("download",{timeout:30000}), p.click('button[data-act="board-pack"]')]);
  const f=path.join(OUTDIR,"pack-comps.pptx"); await dl.saveAs(f); ok("board pack downloaded", fs.existsSync(f));
  await p.goto(BASE+"#comps"); await p.waitForTimeout(300); await p.screenshot({path:OUTDIR+"/comps-desk.png",fullPage:true});
  // period toggle
  const segs=await p.$$eval('.seg button[data-act="comps-period"]',x=>x.map(e=>[e.textContent,e.getAttribute("aria-pressed")]));
  ok("period toggle: Latest quarter pressed by default", JSON.stringify(segs)==='[["Latest quarter","true"],["YTD","false"],["LTM","false"]]', segs);
  ok("default request is the latest quarter", p.compsCalls.every(c=>c.body.period==="quarter"), p.compsCalls.map(c=>c.body.period));
  ok("column header says Period", (await p.$$eval("table.comps thead th",x=>x.map(e=>e.textContent.trim()))).includes("Period"));
  let n1=p.compsCalls.length;
  await p.click('button[data-act="comps-period"][data-v="ytd"]'); await p.waitForTimeout(300);
  ok("YTD: requests period ytd", p.compsCalls.length===n1+1 && p.compsCalls[n1].body.period==="ytd" && JSON.stringify(p.compsCalls[n1].body.tickers)==='["WRB","LSE:HSX"]', p.compsCalls.slice(n1));
  ok("YTD: title, pressed button and period cells", (await txt(p,"h2.action-title"))==="Public comps: year to date (9M 2026)" && (await p.getAttribute('button[data-v="ytd"]',"aria-pressed"))==="true" && (await p.$$eval("table.comps tbody tr:not(.med)",r=>r.map(x=>x.querySelectorAll("td")[1].textContent.trim()))).every(v=>v==="9M 2026"), await txt(p,"h2.action-title"));
  ok("YTD: source line explains annualised ROE", (await txt(p,"p.source")).includes("year-to-date net income annualised") && (await txt(p,"p.source")).includes("same months a year earlier"));
  ok("YTD remembered in this browser", (await p.evaluate(()=>localStorage.getItem("dealdesk.compsPeriod")))==="ytd");
  await p.click('button[data-act="comps-period"][data-v="ltm"]'); await p.waitForTimeout(300);
  ok("LTM: requests ltm, title and ROE note", p.compsCalls[p.compsCalls.length-1].body.period==="ltm" && (await txt(p,"h2.action-title"))==="Public comps: last twelve months (LTM Q3 2026)" && (await txt(p,"p.source")).includes("twelve-month net income / equity"), await txt(p,"h2.action-title"));
  await p.goto(BASE+"#ceo"); await p.waitForTimeout(300);
  ok("CEO strip follows the period", (await txt(p,'section:has(h3.sec:text-is("Peer benchmarks"))')).includes("last twelve months (LTM Q3 2026)"));
  await p.goto(BASE+"#comps"); await p.waitForTimeout(300);
  n1=p.compsCalls.length;
  await p.click('button[data-act="comps-period"][data-v="quarter"]'); await p.waitForTimeout(300);
  ok("switching back to a fetched period uses the page's copy", p.compsCalls.length===n1 && (await txt(p,"h2.action-title")).startsWith("Public comps: latest quarter"), p.compsCalls.length-n1);
  await p.click('button[data-act="comps-refresh"] >> nth=0'); await p.waitForTimeout(300);
  ok("Refresh refetches the chosen period", p.compsCalls.length===n1+1 && p.compsCalls[n1].body.period==="quarter");
  // CEO login: can read, can't edit
  await p.evaluate(()=>{ S.session.role="ceo"; render(); });
  ok("CEO: sees comps and AGL link, no edit", (await p.$$("table.comps tbody tr")).length===3 && !!(await p.$("a.linkbtn")) && (await p.$$('button[data-act="comps-settings"]')).length===0);
  await p.evaluate(()=>{ S.session.role="corpdev"; render(); });
  // phone
  await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(150);
  ok("phone: no sideways scroll; five tabs fit", (await p.evaluate(()=>document.documentElement.scrollWidth))<=390 && (await p.evaluate(()=>{ const n=document.querySelector("nav.tabs"); return n.scrollWidth<=n.clientWidth+1; })), await p.evaluate(()=>{ const n=document.querySelector("nav.tabs"); return [n.scrollWidth,n.clientWidth]; }));
  await p.screenshot({path:OUTDIR+"/comps-phone.png"});
  await p.setViewportSize({width:1440,height:900});
  await p.click('button[data-act="comps-period"][data-v="ytd"]'); await p.waitForTimeout(300);
  await p.reload(); await p.waitForTimeout(500);
  ok("after reload: YTD still chosen and requested", (await p.getAttribute('button[data-v="ytd"]',"aria-pressed"))==="true" && p.compsCalls[p.compsCalls.length-1].body.period==="ytd");
  await p.screenshot({path:OUTDIR+"/comps-ytd.png",fullPage:true});
  await p.close();

  // settings table missing
  p=await pg("ok",{noSettings:true});
  ok("no settings table: default peers and a note to run 0004", (await txt(p,".banner")).includes("0004_settings.sql") && p.compsCalls[0].body.tickers.length===14);
  await p.click('button[data-act="comps-settings"] >> nth=1'); await p.waitForSelector("#compsForm"); await p.click('button[data-act="comps-save"]'); await p.waitForTimeout(200);
  ok("saving without the table explains", (await txt(p,"#toastRoot")).includes("Run supabase/migrations/0004_settings.sql"));
  await p.close();

  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
