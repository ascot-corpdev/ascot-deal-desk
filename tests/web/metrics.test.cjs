// Deal key metrics: Valuation, GWP, Equity, Net income, P/BV and P/E (calculated).
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const seed=[
  ["deals","d1",{codename:"Harbor",target:"Harbor MGA",stage:"LOI",ev:150,gwp:260,equity:100,netIncome:15,stake:25,updatedAt:Date.now()}],
  ["deals","d2",{codename:"Oak",stage:"Screening",ev:40,equity:0,netIncome:-3,updatedAt:Date.now()}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(vp){ const ctx=await b.newContext({viewport:vp||{width:1440,height:900},acceptDownloads:true}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
    await p.route("**/*",r=>{const u=r.request().url();
      if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
      if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'});
      if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    await p.addInitScript(s=>{ window.__seed=s; },seed); await p.goto(BASE+"#ceo"); await p.waitForTimeout(500); return p; }
  const tiles=p=>p.$$eval("#drawerRoot .dealtiles .tile",t=>t.map(x=>[x.querySelector("b").textContent.trim(), x.querySelector("span").textContent.replace(/\s+/g," ").trim()]));
  let p=await pg();
  await p.evaluate(()=>{ S.session.role="ceo"; render(); });
  await p.goto(BASE+"#deal/d1"); await p.waitForTimeout(300);
  const t=await tiles(p);
  ok("six key metrics in order", JSON.stringify(t.map(x=>x[1]))==='["Valuation (100%; 25% stake)","GWP","Equity","Net income (LTM)","P/BV (calculated)","P/E (calculated)"]', t);
  ok("values: $150M, $260M, $100M, $15M, 1.50x, 10.0x", JSON.stringify(t.map(x=>x[0]))==='["$150M","$260M","$100M","$15M","1.50x","10.0x"]', t);
  ok("stage still shown above, stake in the details", await p.isVisible("#drawerRoot .stagerow .pill") && (await p.textContent("#drawerRoot dl.kv")).includes("Stake25%"));
  await p.screenshot({path:OUTDIR+"/metrics-drawer.png"});
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  await p.goto(BASE+"#deal/d2"); await p.waitForTimeout(300);
  const t2=await tiles(p);
  ok("zero equity / loss: multiples n/d, no stake note at 100%", t2[4][0]==="n/d" && t2[5][0]==="n/d" && t2[3][0]==="-$3.0M" && t2[0][1]==="Valuation", t2);
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  // editor (Corp Dev)
  await p.evaluate(()=>{ S.session.role="corpdev"; render(); });
  await p.goto(BASE+"#deal/d1"); await p.waitForSelector("#dealForm");
  const labels=await p.$$eval("#dealForm label.f",l=>l.map(x=>x.childNodes[0].textContent.trim()));
  ok("editor has Valuation, Equity and Net income", ["Valuation","Target GWP","Equity","Net income","Stake"].every(x=>labels.includes(x)), labels);
  ok("editor shows calculated multiples", (await p.textContent("#f_multiples")).includes("P/BV 1.50x · P/E 10.0x"));
  await p.fill("#f_equity","120"); await p.fill("#f_netIncome","20");
  ok("multiples update as you type", (await p.textContent("#f_multiples")).includes("P/BV 1.25x · P/E 7.5x"), await p.textContent("#f_multiples"));
  await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(300);
  const doc=await p.evaluate(()=>window.__mock.store.deals.d1.doc);
  ok("saved as numbers", doc.equity===120 && doc.netIncome===20 && doc.ev===150, doc);
  // Copilot brief and CSV carry them
  const brief=await p.evaluate(()=>copilotBrief());
  ok("Copilot brief includes them", brief.includes("valuation $150M, GWP $260M, equity $120M, net income $20M, P/BV 1.25x, P/E 7.5x"), brief.split("\n").find(l=>l.includes("Harbor")));
  await p.goto(BASE+"#deals"); await p.waitForTimeout(200);
  const csvBtn=await p.$('button[data-act="export"]');
  if(csvBtn){ const [dl]=await Promise.all([p.waitForEvent("download"), csvBtn.click()]); const csv=fs.readFileSync(await dl.path(),"utf8");
    ok("CSV has the new columns", csv.includes('"Valuation ($M)","GWP ($M)","Equity ($M)","Net income ($M)","P/BV (calculated)","P/E (calculated)"') && csv.includes('"150","260","120","20","1.25","7.5"'), csv.split("\n").slice(0,2)); }
  else ok("CSV button found", false);
  // phone
  await p.setViewportSize({width:390,height:844}); await p.evaluate(()=>{ S.session.role="ceo"; render(); }); await p.goto(BASE+"#deal/d1"); await p.waitForTimeout(300);
  ok("phone: tiles in two columns, no sideways scroll", (await p.evaluate(()=>getComputedStyle(document.querySelector(".dealtiles")).gridTemplateColumns.split(" ").length))===2 && (await p.evaluate(()=>document.documentElement.scrollWidth))<=390);
  await p.screenshot({path:OUTDIR+"/metrics-phone.png"});
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
