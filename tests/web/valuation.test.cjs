// Valuation tab: trading comparables, historical P/TBV, precedents, valuation approach, Ascot valuation summary,
// the settings drawer and the slides. The valuation function is served with made-up figures for real public peer
// tickers. Ascot's figures here are made up too; the suite checks they never leave the browser tab.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs"); const path=require("path");
const WEB=path.join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
const PPTX=fs.readFileSync(path.join(__dirname,"../../node_modules/pptxgenjs/dist/pptxgen.bundle.js"),"utf8");
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const DEFAULT=["LSE:BEZ","LSE:HSX","LSE:LRE","ACGL","EG","RNR","AXS","HG","WRB","MKL","AFG","THG"];
const FY=new Date().getFullYear();
// made-up figures: company i has P/TBV 1.1 + 0.1i and so on
function fake(tickers, asOf, fy){
  const companies=tickers.map((t,i)=>({ticker:t, name:t+" Holdings", currency:"USD", capCurrency:t.startsWith("LSE:")?"GBP":"USD", capDate:asOf, bookDate:`${fy-1}-12-31`,
    marketCap:1000*(i+1), bv:800*(i+1), tbv:700*(i+1), pbv:+(1+0.1*i).toFixed(2), ptbv:+(1.1+0.1*i).toFixed(2), niPrior:100*(i+1), niPriorKind:i===1?"consensus":"actual", niFwd:110*(i+1), niFwdKind:"consensus",
    pePrior:10+i, peFwd:8+i, robv:12+i/2, rotbv:13+i/2, debtToCap:10+i, cr:{[fy-2]:85+i,[fy-1]:86+i}, notes:i===2?["No "+fy+" consensus net income"]:[]}));
  const dates=[]; const end=Date.parse(asOf+"T00:00:00Z"); for(let k=520;k>=0;k--) dates.push(new Date(end-k*7*86400000).toISOString().slice(0,10));
  const series=Object.fromEntries(tickers.map((t,i)=>[t, dates.map((_,j)=>+(1.1+0.1*i+0.2*Math.sin(j/40)).toFixed(3))]));
  return {asOf, asOfAsked:"", fy, years:10, start:dates[0], tickers, companies, history:{dates, series}, fx:{GBP:1.28}, errors:{}, notes:[], source:"S&P Global Capital IQ via Kensho", saved:true};
}
const ASCOT={valDate:"3/31/27", bookDate:"December 31, 2026", tbv:"2,900", bv:"3,100", mult:"1.40x", niPrior:"510", niFwd:"456", d2c:"19.5", cr1:"94.9", cr2:"94.8", shares:"77.123", prevDate:"3/31/26", prevVal:"3,115", prevPbv:"1.27", prevPtbv:"1.40", prevPps:"44.10"};
// numbers typed in that must never leave the page
const SECRETS=["2,900","3,100","456","77.123","3,115","44.10","4060","4,060"];

(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(mode, opts={}){
    const ctx=await b.newContext({viewport:opts.vp||{width:1440,height:900},acceptDownloads:true}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
    p.calls=[]; p.outbound=[];
    await p.route("**/*",r=>{ const u=r.request().url(), req=r.request();
      if(req.method()!=="GET"||req.postData()) p.outbound.push(u+" "+(req.postData()||""));
      if(u==="https://a.supabase.co/functions/v1/valuation"){ const body=JSON.parse(req.postData()||"{}"); p.calls.push(body);
        if(p.mode==="404") return r.fulfill({status:404,contentType:"application/json",body:'{"code":"NOT_FOUND"}'});
        const y=+(body.asOf||new Date().toISOString().slice(0,10)).slice(0,4);
        return r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...fake(body.tickers, body.asOf||new Date().toISOString().slice(0,10), body.fy||y), asOfAsked:body.asOf||""})}); }
      if(u==="https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js") return r.fulfill({contentType:"application/javascript",body:PPTX});
      if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
      if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'});
      if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")});
      return r.fulfill({status:404,body:""}); });
    p.mode=mode; await p.addInitScript(s=>{ window.__seed=s; },[["deals","d1",{codename:"Harbor",stage:"LOI",ev:100,updatedAt:Date.now()}]]);
    await p.goto(BASE+(opts.hash||"#valuation")); await p.waitForTimeout(600); return p; }
  const txt=async (p,sel)=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();
  const rowsOf=async (p,sel)=>p.$$eval(sel+" tr",rs=>rs.map(r=>[r.className,[...r.children].map(c=>c.textContent.replace(/\s+/g," ").trim())]));

  // ---- not deployed: explains, and Ascot figures and precedents still work
  let p=await pg("404");
  ok("Valuation tab current", (await p.getAttribute('nav.tabs a[data-view="valuation"]',"aria-current"))==="page");
  ok("not deployed: explains with the deploy command", (await txt(p,".banner")).includes("valuation function isn't deployed yet") && (await txt(p,".banner")).includes("supabase functions deploy valuation --no-verify-jwt"));
  ok("default peers, latest date, this year, ten years requested", JSON.stringify(p.calls[0].tickers)===JSON.stringify(DEFAULT) && p.calls[0].asOf==="" && p.calls[0].fy===FY && p.calls[0].years===10 && p.calls[0].refresh===true, p.calls[0]);
  ok("precedents shown without Kensho", (await p.$$("table.prec tbody tr")).length===20);
  await p.close();

  // ---- data
  p=await pg("ok");
  const comps=await rowsOf(p,"#valOut section:first-of-type table.valtbl tbody");
  const names=comps.map(r=>r[1][0]);
  ok("groups in order: Lloyd's, Bermuda, combined, then U.S. specialty as reference", names[0]==="Lloyd's of London (re)insurers" && names.findIndex(n=>n.startsWith("Bermuda"))>0 && names.findIndex(n=>n.startsWith("Mean - Lloyd's and Bermuda / offshore peers - excl. Beazley"))>names.findIndex(n=>n.startsWith("Bermuda")) && names.findIndex(n=>n.startsWith("U.S. specialty"))>names.findIndex(n=>n.startsWith("Mean - Lloyd's and Bermuda")), names);
  const bez=comps.find(r=>r[1][0].startsWith("Beazley"));
  ok("Beazley shown, hatched and marked excluded with the reason", bez && bez[0].includes("excl") && bez[1][0].includes("excluded: agreed offer from Zurich") && bez[1][0].includes("market cap in GBP, shown in US$"), bez);
  const hsx=comps.find(r=>r[1][0].startsWith("Hiscox"));
  ok("Hiscox row formatted", JSON.stringify(hsx[1].slice(1))===JSON.stringify(["2,000","1.10x","1.20x","11.0x","9.0x","12.5%","13.5%","11.0%","86.0%","87.0%"]), hsx);
  const lm=comps.find(r=>r[1][0].startsWith("Mean - Lloyd's of London (re)insurers - excl. Beazley"));
  ok("Lloyd's mean leaves Beazley out", lm && lm[1][3]==="1.25x" && lm[1][2]==="1.15x" && lm[1][5]==="9.5x" && lm[0].includes("stat"), lm);
  const cm=comps.find(r=>r[1][0].startsWith("Mean - Lloyd's and Bermuda / offshore peers"));
  ok("combined mean of the seven primary peers", cm && cm[0].includes("all") && cm[1][3]==="1.50x", cm);
  const um=comps.find(r=>r[1][0].startsWith("Median - U.S. specialty"));
  ok("U.S. specialty median", um && um[1][3]==="2.05x", um);
  ok("column headings follow the forward year", (await p.$$eval("#valOut section:first-of-type thead th",x=>x.map(e=>e.textContent.trim()))).join("|").includes(`P/E ${FY-1}E/A|P/E ${FY}F|Return on BV ${FY}F|Return on TBV ${FY}F|LTM debt to capital|Combined ratio ${FY-2}A|Combined ratio ${FY-1}A`));
  ok("notes listed under the table (consensus prior year, missing estimate)", (await txt(p,".valnotes")).includes(`Hiscox: ${FY-1} net income is the consensus estimate`) && (await txt(p,".valnotes")).includes(`Lancashire: No ${FY} consensus net income`));
  ok("no Ascot row before figures are typed", !(await p.$("tr.ascot")));
  // chart
  ok("chart: one line per group, end labels, axis", (await p.$$("#valChart path.vl")).length===3 && (await p.$$("#valChart text.vend")).length===3 && (await p.$$("#valChart text.vt")).length>8);
  const avg=await rowsOf(p,".vavg tbody");
  ok("averages: 1, 3, 5, 10 years and as-at", avg.map(r=>r[1][0].split(" ")[0]).join()==="1-year,3-year,5-year,10-year,As" && avg[4][1].length===4, avg);
  ok("legend names groups and exclusions", (await txt(p,".vlegend")).includes("Lloyd's (re)insurers (excl. Beazley)") && (await txt(p,".vlegend")).includes("Bermuda / offshore (re)insurers") && (await txt(p,".vlegend")).includes("US Specialty"));
  await p.hover("#valChart svg"); await p.waitForTimeout(100);
  const tip=await txt(p,"#valTip");
  ok("hover: crosshair and one tooltip listing all three groups", !(await p.$eval("#valTip",e=>e.hidden)) && (await p.getAttribute("#valHair","visibility"))==="visible" && (await p.$$("#valTip div")).length===3 && /x Lloyd's/.test(tip), tip);
  await p.mouse.move(5,5); await p.waitForTimeout(50);
  ok("hover off: tooltip hidden", await p.$eval("#valTip",e=>e.hidden));
  await p.focus("#valChart svg"); await p.keyboard.press("End"); await p.waitForTimeout(50);
  ok("keyboard: End shows the last date", (await txt(p,"#valTip")).includes(new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})), await txt(p,"#valTip"));
  await p.keyboard.press("Escape");
  const [csv]=await Promise.all([p.waitForEvent("download"), p.click('button[data-act="val-csv"]')]);
  const csvText=fs.readFileSync(await csv.path(),"utf8");
  ok("chart data CSV: dates, group averages, each company", csvText.split("\r\n").length===522 && csvText.includes('"Lloyd\'s (re)insurers average P/TBV"') && csvText.includes('"LSE:BEZ P/TBV"'), csvText.slice(0,300));
  // precedents
  const prec=await rowsOf(p,"table.prec tbody");
  ok("precedents: newest first, n.a. and approximate multiples kept", prec[0][1].join("|")==="Feb-26|Beazley|Zurich|11.0|2.20x|2.30x" && prec.find(r=>r[1][1]==="Convex")[1][4]==="~1.90x" && prec.find(r=>r[1][1]==="IQUW")[1][5]==="n.a.", prec.slice(0,4));
  ok("precedents: mean and median", JSON.stringify(prec.slice(-2).map(r=>r[1].slice(-2)))==='[["1.32x","1.39x"],["1.37x","1.42x"]]', prec.slice(-2));
  // approach
  const app=await txt(p,".vapp");
  ok("approach worded from the figures", app.includes("P/TBV: As at") && app.includes("Lloyd's (re)insurers(1) trade at an average multiple of ~1.25x") && app.includes("Bermuda / offshore (re)insurers at ~1.60x") && app.includes("and US Specialty at ~2.05x") && app.includes(`P/E (${FY}P)`) && app.includes("since Aug-20 is ~1.4x P/TBV") && app.includes("viewed as the primary comp set"), app);
  ok("approach footnote names the exclusion", (await txt(p,'section[aria-labelledby="vx4"]')).includes("(1) Excluding Beazley (agreed offer from Zurich)"));
  ok("summary waits for Ascot's figures", (await txt(p,'section[aria-labelledby="vx5"]')).includes("Type Ascot's figures above"));

  // ---- Ascot figures
  for(const [k,v] of Object.entries(ASCOT)) await p.fill("#vi_"+k, v);
  await p.waitForTimeout(100);
  const asc=(await rowsOf(p,"#valOut section:first-of-type table.valtbl tbody")).filter(r=>/ascot|prev/.test(r[0]));
  ok("Ascot row: valuation = 1.40x TBV, multiples", asc[0][1].join("|")==="3/31/27 valuation|$4,060|1.31x|1.40x|8.0x|8.9x|14.7%|15.7%|19.5%|94.9%|94.8%", asc[0]);
  ok("previous valuation reference row", asc[1][1].slice(0,4).join("|")==="Ref: 3/31/26 valuation|$3,115|1.27x|1.40x", asc[1]);
  const sum=(await rowsOf(p,".vsum tbody")).map(r=>r[1]);
  const S=Object.fromEntries(sum.filter(r=>r[0]).map(r=>[r[0],r[1]]));
  ok("summary: valuation, price per share, P/TBV, implied P/E", S["Ascot Group valuation as at 3/31/27"]==="$4,060" && S["Ascot Group valuation price per share"]==="$52.64" && S["P/TBV"]==="1.40x" && S[`Implied P/E (${FY}P)`]==="8.9x", S);
  ok("summary: previous, shares, write-up", S["Previous Ascot Group valuation at 3/31/26"]==="$3,115" && S["Previous Ascot Group valuation price per share"]==="$44.10" && S["Diluted shares outstanding (including RSUs/PSUs and PSOPs) - #m"]==="77.123" && S["Per share write-up - $"]==="$8.54" && S["Per share write-up - %"]==="19.4%", S);
  ok("approach picks up Ascot's multiples and book date", (await txt(p,".vapp")).startsWith(`Valuation implies price / tangible book value ("P/TBV") multiple of 1.40x, applied to the tangible book value of the consolidated Ascot Group as at December 31, 2026, and price-to-earnings ("P/E") multiple of 8.9x on FY${FY} plan net income`));
  ok("derived returns explained", (await txt(p,'section[aria-labelledby="vx5"] .source')).includes("Return on BV and TBV = plan net income / year-end book value (derived)"));
  await p.fill("#vi_val","4,100"); await p.waitForTimeout(50);
  ok("valuation typed in overrides multiple x TBV", (await txt(p,"tr.ascot")).includes("$4,100") && (await txt(p,"tr.ascot")).includes("1.41x"));
  await p.fill("#vi_val","");
  ok("typing keeps focus in the box", (await p.evaluate(()=>document.activeElement.id))==="vi_val");
  // they stay in the tab
  await p.goto(BASE+"#comps"); await p.waitForTimeout(200); await p.goto(BASE+"#valuation"); await p.waitForTimeout(200);
  ok("figures survive switching tabs", (await p.inputValue("#vi_tbv"))==="2,900" && !!(await p.$("tr.ascot")));
  const leaks=await p.evaluate(secrets=>{ const all=JSON.stringify(window.__mock.store)+JSON.stringify(window.__mock.log)+JSON.stringify({...localStorage})+JSON.stringify({...sessionStorage}); return secrets.filter(s=>all.includes(s)); }, SECRETS);
  ok("Ascot figures not in the database, browser storage or the log", leaks.length===0, leaks);
  ok("Ascot figures not in any request", !p.outbound.some(o=>SECRETS.some(s=>o.includes(s))), p.outbound.filter(o=>SECRETS.some(s=>o.includes(s))));
  // save, clear, open
  const [dl]=await Promise.all([p.waitForEvent("download"), p.click('button[data-act="vi-save"]')]);
  const saved=JSON.parse(fs.readFileSync(await dl.path(),"utf8"));
  ok("save to file: the inputs, marked as such", saved.kind==="ascot-valuation-inputs" && saved.inputs.tbv==="2,900" && saved.inputs.prevPps==="44.10" && /^ascot-valuation-inputs-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), saved);
  await p.click('button[data-act="vi-clear"]'); await p.waitForTimeout(100);
  ok("clear: inputs and Ascot rows gone", (await p.inputValue("#vi_tbv"))==="" && !(await p.$("tr.ascot")));
  const fpath=path.join(OUTDIR,"ascot-inputs.json"); fs.writeFileSync(fpath, JSON.stringify(saved));
  await p.setInputFiles("#vi_file", fpath); await p.waitForTimeout(200);
  ok("open file: figures back", (await p.inputValue("#vi_tbv"))==="2,900" && (await txt(p,"tr.ascot")).includes("$4,060"));
  fs.writeFileSync(fpath, '{"hello":1}'); await p.setInputFiles("#vi_file", fpath); await p.waitForTimeout(150);
  ok("open file: other files refused", (await txt(p,"#toastRoot")).includes("isn't a saved Ascot figures file") && (await p.inputValue("#vi_tbv"))==="2,900");
  await p.screenshot({path:OUTDIR+"/valuation-desk.png",fullPage:true});
  // slides
  const [pk]=await Promise.all([p.waitForEvent("download",{timeout:30000}), p.click('button[data-act="val-pptx"]')]);
  const pf=path.join(OUTDIR,"valuation.pptx"); await pk.saveAs(pf);
  ok("slides downloaded", fs.statSync(pf).size>20000 && /^Ascot-valuation-exhibits-\d{4}-\d{2}-\d{2}\.pptx$/.test(pk.suggestedFilename()));
  const unz=require("child_process").spawnSync("unzip",["-o","-q",pf,"-d",path.join(OUTDIR,"valuation-pptx")]);
  if(unz.status===0){ const sx=i=>fs.readFileSync(path.join(OUTDIR,`valuation-pptx/ppt/slides/slide${i}.xml`),"utf8");
    ok("four slides: comps, P/TBV chart, precedents, valuation", [1,2,3,4].every(i=>fs.existsSync(path.join(OUTDIR,`valuation-pptx/ppt/slides/slide${i}.xml`))) && sx(1).includes("Trading comparables") && sx(1).includes("Beazley (excluded)") && sx(1).includes("3/31/27 valuation") && sx(2).includes("historical P/TBV") && fs.readdirSync(path.join(OUTDIR,"valuation-pptx/ppt/charts")).length>0 && sx(3).includes("Howard Hughes") && sx(4).includes("Per share write-up") && sx(4).includes("$52.64") && sx(4).includes("Draft, subject to finalization"));
  } else ok("unzip available to check slides", false, String(unz.stderr));

  // ---- settings
  await p.click('button[data-act="val-settings"]'); await p.waitForSelector("#valForm");
  ok("settings: groups and precedents as editable text", (await p.inputValue("#vs_groups")).startsWith("## Lloyd's of London (re)insurers | Lloyd's (re)insurers | primary\nLSE:BEZ | Beazley | exclude | agreed offer from Zurich") && (await p.inputValue("#vs_prec")).startsWith("Feb-26 | Beazley | Zurich | 11.0 | 2.20x | 2.30x"));
  await p.fill("#vs_groups","## Bermuda | Bermuda | primary\nACGL | Arch\nbad ticker!"); await p.click('button[data-act="val-save"]'); await p.waitForTimeout(100);
  ok("bad ticker refused", (await txt(p,"#toastRoot")).includes("doesn't look like a ticker"));
  await p.fill("#vs_groups","## Bermuda (re)insurers | Bermuda | primary\nACGL | Arch\nRNR | RenRe | exclude | under offer\n\n## London | London | primary\nLSE:HSX | Hiscox\n\n## U.S. specialty | US Specialty | reference\nWRB | Berkley");
  await p.fill("#vs_prec","Mar-24 | Target A | Buyer A | 1.0 | 1.10x | 1.20x\n2025-06 | Target B | Buyer B | n.a. | ~1.30 | na");
  await p.fill("#vs_asof","2026-03-13"); await p.waitForTimeout(50);
  await p.selectOption("#vs_fy","2026");
  const n0=p.calls.length;
  await p.click('button[data-act="val-save"]'); await p.waitForTimeout(500);
  const doc=await p.evaluate(()=>window.__mock.store.settings.valuation&&window.__mock.store.settings.valuation.doc);
  ok("settings saved: groups, precedents, date, year; nothing about Ascot", doc && doc.asOf==="2026-03-13" && doc.fy===2026 && doc.groups.length===3 && doc.groups[0].companies[1].exclude===true && doc.groups[0].companies[1].note==="under offer" && doc.groups[2].role==="reference"
    && doc.precedents.length===2 && doc.precedents[1].pbvApprox===true && doc.precedents[1].ptbv===null && doc.precedents[1].value===null && doc.precedents[0].date==="2024-03" && !SECRETS.some(s=>JSON.stringify(doc).includes(s)), doc);
  ok("refetched with the new peers, date and year", p.calls.length===n0+1 && JSON.stringify(p.calls[n0].tickers)==='["ACGL","RNR","LSE:HSX","WRB"]' && p.calls[n0].asOf==="2026-03-13" && p.calls[n0].fy===2026, p.calls.slice(n0));
  ok("table follows the new groups", (await txt(p,"#valOut section:first-of-type")).includes("Mean - Bermuda (re)insurers - excl. RenRe") && (await txt(p,"#valOut section:first-of-type")).includes("Mean - Bermuda and London peers - excl. RenRe") && (await txt(p,"#valOut section:first-of-type")).includes("As at 13 Mar 2026"));
  ok("precedents follow the list", (await p.$$("table.prec tbody tr")).length===4 && (await txt(p,"table.prec")).includes("~1.30x"));
  ok("Ascot figures kept after the settings change", (await p.inputValue("#vi_tbv"))==="2,900");
  // CEO: reads and types, can't edit settings
  await p.evaluate(()=>{ S.session.role="ceo"; render(); });
  ok("CEO: sees the tab, can type figures, no settings button", (await p.$$('button[data-act="val-settings"]')).length===0 && !!(await p.$("#vi_tbv")) && (await p.$$("#valOut table.valtbl")).length>=3);
  await p.evaluate(()=>{ S.session.role="corpdev"; render(); });
  // phone
  await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(150);
  ok("phone: no sideways scroll; six tabs fit", (await p.evaluate(()=>document.documentElement.scrollWidth))<=390 && (await p.evaluate(()=>{ const n=document.querySelector("nav.tabs"); return n.scrollWidth<=n.clientWidth+1; })), await p.evaluate(()=>{ const n=document.querySelector("nav.tabs"); return [document.documentElement.scrollWidth,n.scrollWidth,n.clientWidth]; }));
  await p.screenshot({path:OUTDIR+"/valuation-phone.png",fullPage:true});
  await p.setViewportSize({width:1440,height:900});
  // sign out clears the figures
  await p.evaluate(()=>signOut()); await p.waitForTimeout(200);
  ok("sign-out clears Ascot's figures", await p.evaluate(()=>Object.keys(S.valIn).length===0 && S.valuation===null));
  await p.close();

  ok("no page errors", errs.length===0, errs);
  await b.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
