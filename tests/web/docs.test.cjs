// CEO view deal table: Profile and Other docs columns (no EV or Lead); link types in the deal editor.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const U="https://ascot.sharepoint.com/";
const seed=[
  ["deals","d1",{codename:"Harbor",target:"Harbor MGA",stage:"LOI",ev:100,lead:"A. Chen",ceoSummary:"Good fit.",updatedAt:Date.now(),
    links:[{label:"Harbor profile",url:U+"p1.pptx",type:"profile"},{label:"IC memo",url:U+"m.docx",type:"other"},{label:"Model",url:U+"x.xlsx"}]}],
  ["deals","d2",{codename:"Summit",stage:"Diligence",ev:50,lead:"B. Ng",updatedAt:Date.now(),links:[{label:"Company profile",url:U+"p2.pptx"}]}],
  ["deals","d3",{codename:"Cedar",stage:"Screening",updatedAt:Date.now(),links:[]}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  const ctx=await b.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
  await p.route("**/*",r=>{const u=r.request().url();
    if(u.includes("/functions/v1/")) return r.fulfill({status:404,body:"{}"});
    if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await p.addInitScript(s=>{ window.__seed=s; },seed); await p.goto(BASE+"#ceo"); await p.waitForTimeout(600);
  const sec='section:has(h3.sec:text-is("Deal summaries and documents"))';
  const heads=await p.$$eval(sec+" thead th",x=>x.map(e=>e.textContent.trim()));
  ok("columns: Deal, Stage, Summary, Profile, Other docs", JSON.stringify(heads)==='["Deal","Stage","Summary","Profile","Other docs"]', heads);
  const rows=await p.$$eval(sec+" tbody tr",r=>Object.fromEntries(r.map(x=>{ const t=[...x.querySelectorAll("td")]; return [t[0].querySelector(".t1").textContent.trim(), t.map(c=>c.textContent.replace(/\s+/g," ").trim())]; })));
  ok("Harbor: profile and two other docs", rows.Harbor[3]==="PPTHarbor profile" && rows.Harbor[4].includes("IC memo") && rows.Harbor[4].includes("Model") && !rows.Harbor[4].includes("profile"), rows.Harbor);
  ok("older link labelled profile counts as the profile", rows.Summit[3].includes("Company profile") && rows.Summit[4]==="None", rows.Summit);
  ok("no links: placeholders", rows.Cedar[3]==="No profile yet" && rows.Cedar[4]==="None", rows.Cedar);
  const body=await p.textContent(sec);
  ok("no EV or lead in the table", !body.includes("EV") && !body.includes("A. Chen") && !body.includes("$M"), body.slice(0,300));
  // deal drawer and editor
  await p.evaluate(()=>{ S.session.role="ceo"; render(); });
  await p.goto(BASE+"#deal/d1"); await p.waitForTimeout(300);
  const dr=(await p.textContent("#drawerRoot")).replace(/\s+/g," ");
  ok("deal drawer: Profile and Other docs sections", /Profile\s*PPT\s*Harbor profile\s*Other docs\s*DOC\s*IC memo\s*XLS\s*Model/.test(dr), dr.slice(0,400));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  await p.evaluate(()=>{ S.session.role="corpdev"; render(); });
  await p.goto(BASE+"#deal/d1"); await p.waitForSelector("#dealForm");
  const types=await p.$$eval('#linkRows select[data-lf="type"]',x=>x.map(e=>e.value));
  ok("editor: each link has a type", JSON.stringify(types)==='["profile","other","other"]', types);
  await p.selectOption('#linkRows select[data-li="2"]',"profile");
  await p.click('button[data-act="add-link"]');
  ok("added link defaults to other doc", (await p.$eval('#linkRows select[data-li="3"]',e=>e.value))==="other");
  await p.fill('#linkRows input[data-li="3"][data-lf="label"]',"Board paper"); await p.fill('#linkRows input[data-li="3"][data-lf="url"]',U+"bp.pdf");
  await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(300);
  const st=await p.evaluate(()=>window.__mock.store.deals.d1.doc.links);
  ok("saved with types", JSON.stringify(st.map(l=>[l.label,l.type]))==='[["Harbor profile","profile"],["IC memo","other"],["Model","profile"],["Board paper","other"]]', st);
  await p.goto(BASE+"#deals"); await p.waitForTimeout(150); await p.goto(BASE+"#ceo"); await p.waitForTimeout(300);
  const h2=await p.$$eval(sec+' tbody tr:has-text("Harbor") td',t=>t.map(c=>c.textContent.replace(/\s+/g," ").trim()));
  ok("CEO view updates", h2[3].includes("Harbor profile") && h2[3].includes("Model") && h2[4].includes("Board paper") && !h2[4].includes("Model"), h2);
  // new deal starts with a profile row
  await p.goto(BASE+"#deals"); await p.waitForTimeout(150); await p.click('button[data-act="new-deal"]'); await p.waitForSelector("#dealForm");
  ok("new deal: first link row is the profile", (await p.$eval('#linkRows select[data-li="0"]',e=>e.value))==="profile");
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  await p.goto(BASE+"#ceo"); await p.waitForTimeout(200);
  await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(150);
  ok("phone: no sideways scroll", (await p.evaluate(()=>document.documentElement.scrollWidth))<=390);
  await p.screenshot({path:OUTDIR+"/docs-phone.png"});
  await p.setViewportSize({width:1440,height:900}); await p.waitForTimeout(150);
  await p.screenshot({path:OUTDIR+"/docs-desk.png",fullPage:true});
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
