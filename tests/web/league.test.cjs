// League table on the Banker CRM: ranking, side and advisor switches, firm grouping, CRM links, extra companies,
// errors. The league function is served by a stub. Firm names are real banks (public advisors); every company,
// deal and person is made up.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs"); const path=require("path");
const WEB=path.join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };

const A=(name,type,side,client)=>({name,type,side,client});
const deal=(id,announced,target,buyers,valueM,currency,advisors,via=["WRB"])=>({id,announced,closed:null,status:"Closed",target,buyers,sellers:[],valueM,currency,via,advisors});
const LEAGUE={asOf:"2026-11-09T12:00:00Z",since:"2023-11-09",years:3,source:"S&P Global Capital IQ via Kensho",dropped:0,
  companies:[{ticker:"WRB",name:"Alpha Example Corp",deals:3}],
  errors:{"NOPE":"Not found in Kensho"},
  deals:[
    deal("1","2025-02-03","Example Specialty Holdings",["Sample Insurance Group"],1250,"US Dollar",[A("Goldman Sachs & Co. LLC","Financial Advisor","sell","Example Specialty Holdings"),A("Goldman Sachs International","Financial Advisor","sell","Example Specialty Holdings"),A("Keefe, Bruyette & Woods, Inc.","Financial Advisor","buy","Sample Insurance Group"),A("Kirkland & Ellis LLP","Legal Advisor","sell","Example Specialty Holdings")]),
    deal("2","2024-06-10","Illustrative MGA LLC",["Alpha Example Corp"],null,null,[A("Goldman Sachs & Co. LLC","Financial Advisor","buy","Alpha Example Corp"),A("Sidley Austin LLP","Legal Advisor","buy","Alpha Example Corp"),A("Sidley Austin LLP, London","Legal Advisor","buy","Alpha Example Corp")]),
    deal("3","2026-01-15","Placeholder Re Ltd",["Beta Sample Ltd"],300,"British Pound",[A("Evercore Group L.L.C.","Financial Advisor","sell","Placeholder Re Ltd"),A("JPMorgan Chase Bank, N.A., Investment Arm","Financial Advisor","buy","Beta Sample Ltd")]),
    deal("4","2025-09-01","Tiny Agency Inc",["Alpha Example Corp"],null,null,[])
  ]};
const seed=[["bankers","b1",{name:"Avery Example",firm:"Goldman Sachs",title:"MD",relationship:"Strong",updatedAt:Date.now()}],
  ["bankers","b2",{name:"Jordan Sample",firm:"KBW",title:"MD",relationship:"Active",updatedAt:Date.now()}],
  ["bankers","b3",{name:"Riley Placeholder",firm:"Example Boutique",title:"VP",relationship:"Developing",updatedAt:Date.now()}]];

(async()=>{
  const b=await chromium.launch(); const errs=[];
  const ctx=await b.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
  const calls=[]; let mode="ok";
  await p.route("**/*",async r=>{const u=r.request().url();
    if(u==="https://a.supabase.co/functions/v1/league"){ calls.push({body:JSON.parse(r.request().postData()||"{}"), auth:r.request().headers()["authorization"]});
      if(mode==="404") return r.fulfill({status:404,contentType:"application/json",body:'{"code":"NOT_FOUND"}'});
      if(mode==="slow"){ await new Promise(res=>setTimeout(res,1500)); return r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(LEAGUE)}).catch(()=>{}); }
      if(mode==="503") return r.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"not_configured",message:"Kensho isn't connected yet."})});
      return r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(LEAGUE)}); }
    if(u==="https://a.supabase.co/functions/v1/comps") return r.fulfill({status:503,contentType:"application/json",body:'{"error":"not_configured"}'});
    if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
    if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'});
    if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await p.addInitScript(s=>{ window.__seed=s; try{ localStorage.removeItem("dealdesk.bankerMode"); }catch{} },seed);
  const txt=async sel=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();
  const firms=async()=>p.$$eval("table.lgtbl tr.lgrow",rs=>rs.map(r=>r.querySelector(".t1").textContent+"|"+[...r.querySelectorAll("td.num")].map(t=>t.textContent.trim()).join("|")));

  // ---- the Bankers list loads the table quietly and shows each firm's place
  await p.goto(BASE+"#bankers"); await p.waitForTimeout(600);
  ok("switch shown; Bankers list by default", (await p.$$('button[data-act="bmode"]')).length===2 && (await p.getAttribute('button[data-act="bmode"][data-v="list"]',"aria-pressed"))==="true");
  ok("asks for the Comps peers, 3 years, with the user's token", calls.length===1 && calls[0].body.years===3 && calls[0].body.companies.length===14 && calls[0].body.companies.includes("WRB") && calls[0].auth==="Bearer t", calls[0]);
  ok("firm row shows its league table place", (await txt("body")).includes("#1 in league table") && (await txt("body")).includes("#2 in league table"));

  // ---- league table
  await p.click('button[data-act="bmode"][data-v="league"]'); await p.waitForTimeout(200);
  ok("banks only, both sides: Goldman first with 2 deals; ties by US$ value, then shared rank; entities grouped; lawyers left out",
    JSON.stringify(await firms())===JSON.stringify(["Goldman Sachs|1|2|1|1|$1.3B","KBW|2|1|1|0|$1.3B","Evercore|3|1|0|1|n/d","J.P. Morgan|3|1|1|0|n/d"]), await firms());
  ok("headline counts deals with banks recorded", (await txt(".action-title"))==="Goldman Sachs leads, on 2 of 3 deals with banks recorded since Nov 2023");
  ok("explains it's not a market-wide table", (await txt(".sub")).includes("not the whole market"));
  const cells=await p.$$eval("table.lgtbl tr.lgrow",rs=>rs.map(r=>[r.querySelector(".lgrecent").textContent.replace(/\s+/g," ").trim(), r.querySelectorAll("td")[7].textContent.trim()]));
  ok("latest deals listed, newest first", cells[0][0].startsWith("Example Specialty Holdings (Sample Insurance Group) Feb 2025Illustrative MGA LLC"), cells);
  ok("CRM people at the firm, matched across names", cells[0][1]==="Avery Example" && cells[1][1]==="Jordan Sample" && cells[2][1]==="No one", cells);
  ok("companies line and errors", (await txt(".lgcos")).includes("Deals involving the 14 Comps peers") && (await txt("body")).includes("Not included: NOPE (Not found in Kensho)"));
  ok("remembered per browser", await p.evaluate(()=>localStorage.getItem("dealdesk.bankerMode"))==="league");

  await p.click('button[data-act="lg-side"][data-v="buy"]'); await p.waitForTimeout(100);
  ok("buy-side only", JSON.stringify((await firms()).map(f=>f.split("|")[0]))==='["KBW","Goldman Sachs","J.P. Morgan"]', await firms());
  await p.click('button[data-act="lg-side"][data-v="sell"]'); await p.click('button[data-act="lg-kind"][data-v="all"]'); await p.waitForTimeout(100);
  ok("sell-side, all advisors: lawyers appear", JSON.stringify((await firms()).map(f=>f.split("|")[0]))==='["Goldman Sachs","Kirkland & Ellis","Evercore"]', await firms());
  await p.click('button[data-act="lg-kind"][data-v="all"]'); await p.click('button[data-act="lg-side"][data-v="buy"]'); await p.waitForTimeout(100);
  ok("a firm's two entities on one deal count once", (await firms()).find(f=>f.startsWith("Sidley Austin"))==="Sidley Austin|2|1|1|0|n/d", await firms());
  await p.click('button[data-act="lg-side"][data-v="all"]'); await p.click('button[data-act="lg-kind"][data-v="banks"]'); await p.waitForTimeout(100);

  // expand a firm
  await p.click("table.lgtbl tr.lgrow >> nth=0"); await p.waitForTimeout(100);
  ok("click a firm: its deals with side, client, value", (await p.$$("tr.lgdeals table.lgsub tbody tr")).length===2 && (await txt("tr.lgdeals")).includes("Sell-side") && (await txt("tr.lgdeals")).includes("1,250M USD") && (await txt("tr.lgdeals")).includes("Alpha Example Corp"));
  await p.click("table.lgtbl tr.lgrow >> nth=0"); await p.waitForTimeout(100);
  ok("click again closes it", !(await p.$("tr.lgdeals")));
  await p.screenshot({path:OUTDIR+"/league.png",fullPage:true});

  // period switch asks again
  await p.click('button[data-act="lg-years"][data-v="5"]'); await p.waitForTimeout(300);
  ok("5 years: a new request", calls.length===2 && calls[1].body.years===5);
  await p.click('button[data-act="lg-years"][data-v="3"]'); await p.waitForTimeout(300);

  // ---- extra companies (Corp Dev)
  await p.click('button[data-act="lg-edit"]'); await p.waitForSelector("#lg_extra");
  await p.fill("#lg_extra","hci, lse:bez\nwrb\nbad$tick");
  await p.click('button[data-act="lg-save"]'); await p.waitForTimeout(200);
  ok("bad ticker refused", (await txt("#toastRoot")).includes("doesn't look like a ticker") && !(await p.evaluate(()=>window.__mock.store.settings.league)));
  await p.fill("#lg_extra","hci, lse:bez\nwrb"); await p.click('button[data-act="lg-save"]'); await p.waitForTimeout(500);
  const st=await p.evaluate(()=>window.__mock.store.settings.league&&window.__mock.store.settings.league.doc);
  ok("saved: uppercased, peers not repeated", st && JSON.stringify(st.companies)==='["HCI","LSE:BEZ"]', st);
  const last=calls[calls.length-1];
  ok("new request includes them", last.body.companies.length===16 && last.body.companies.includes("LSE:BEZ"), last.body);
  ok("companies line names them", (await txt(".lgcos")).includes("and 2 more (HCI, LSE:BEZ)"));

  // ---- banker drawer shows the firm's place
  await p.click('button[data-act="bmode"][data-v="list"]'); await p.waitForTimeout(100);
  await p.evaluate(()=>goRecord("banker","b1")); await p.waitForTimeout(300);
  ok("banker drawer: league table line", (await txt(".lgnote")).startsWith("League tableGoldman Sachs: #1 of 4 banks on 2 deals (1 buy-side, 1 sell-side)"), await txt(".lgnote"));
  await p.click('.lgnote a[data-act="lg-show"]'); await p.waitForTimeout(300);
  ok("See in the league table: opens it with the firm expanded", !(await p.$("#drawerRoot .drawer")) && (await p.getAttribute('button[data-act="bmode"][data-v="league"]',"aria-pressed"))==="true" && !!(await p.$("tr.lgdeals")));
  await p.evaluate(()=>goRecord("banker","b3")); await p.waitForTimeout(300);
  ok("firm not in the table: no line", !(await p.$(".lgnote")));
  await p.evaluate(()=>closeDrawer()); await p.waitForTimeout(100);

  // ---- CEO: reads the table, no editing, no links into the CRM
  await p.evaluate(()=>{ S.session.role="ceo"; render(); }); await p.waitForTimeout(100);
  ok("CEO: table shown, no Edit companies, names without links", (await p.$$("table.lgtbl tr.lgrow")).length>0 && !(await p.$('button[data-act="lg-edit"]')) && !(await p.$('a[data-act="lg-banker"]')));
  await p.evaluate(()=>{ S.session.role="corpdev"; render(); });

  // ---- errors
  mode="503"; await p.click('button[data-act="lg-refresh"]'); await p.waitForTimeout(300);
  ok("Kensho not connected: banner", (await txt(".banner")).includes("Kensho isn't connected to the league function yet"));
  mode="404"; await p.click('button[data-act="lg-refresh"]'); await p.waitForTimeout(300);
  ok("not deployed: banner with the deploy command", (await txt(".banner")).includes("supabase functions deploy league --no-verify-jwt"));
  mode="slow"; await p.evaluate(()=>{ S.league=null; }); await p.addInitScript(()=>{ window.__kenshoWait=400; }); await p.reload(); await p.waitForSelector('button[data-act="bmode"]'); await p.click('button[data-act="bmode"][data-v="league"]'); await p.waitForTimeout(100);
  ok("while loading: says the first load can take a minute", (await txt("body")).includes("The first load can take up to a minute"));
  await p.waitForTimeout(900);
  ok("too slow: says so, with Try again and where to look", (await txt(".banner")).includes("Kensho took more than 0.4 seconds to answer") && (await txt(".banner")).includes("Edge Functions → league → Logs") && !!(await p.$('.banner button[data-act="lg-refresh"]')));
  mode="ok"; await p.click('button[data-act="lg-refresh"]'); await p.waitForTimeout(300);
  ok("back after refresh", (await p.$$("table.lgtbl tr.lgrow")).length===4);

  // ---- phone
  await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(200);
  ok("phone: no horizontal scroll", await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await p.screenshot({path:OUTDIR+"/league-phone.png",fullPage:true});

  // ---- sign out forgets it
  await p.evaluate(()=>signOut()); await p.waitForTimeout(200);
  ok("signed out: league data cleared", await p.evaluate(()=>S.league===null));
  ok("no page errors", errs.length===0, errs);
  await b.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
