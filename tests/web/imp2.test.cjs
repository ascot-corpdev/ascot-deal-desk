// A made-up stand-in for a sell-side advisors export (fixtures/advisors.csv): update the 91 people from the first list, add the 14 new ones; and import into an empty CRM.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
const CSV=require("path").join(__dirname,"../fixtures/advisors.csv");
const TSV=fs.readFileSync(require("path").join(__dirname,"../fixtures/banker-list.tsv"),"utf8");
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(seed){ const p=await b.newPage({viewport:{width:1440,height:900}}); p.on("pageerror",e=>errs.push(String(e)));
    await p.route("**/*",r=>{const u=r.request().url(); if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    await p.addInitScript(s=>{window.__seed=s;},seed); await p.goto(BASE+"#bankers"); await p.waitForTimeout(400); return p; }
  const B=(p,name)=>p.evaluate(n=>Object.values(window.__mock.store.bankers).map(r=>r.doc).find(x=>x.name===n),name);
  const people=p=>p.evaluate(()=>Object.fromEntries(S.drawer.im.people.map(x=>[x.name,{mode:x.mode,status:x.status,firm:x.firm,existingFirm:x.existingFirm,email:x.email,rel:x.relationship,take:x.take,ctx:x.context}])));

  // ---- A. first list already imported, then the CSV ----
  let p=await pg([["deals","dO",{codename:"Project Alder",stage:"LOI",bankerIds:[]}]]);
  await p.click('button[data-act="import-open"]'); await p.fill("#im_text",TSV); await p.click('button[data-act="im-preview"]'); await p.waitForTimeout(100);
  await p.click("#imSave"); await p.waitForTimeout(500);
  ok("first list in: 91 people", (await p.evaluate(()=>Object.keys(window.__mock.store.bankers).length))===91);
  // someone already has a newer contact date and a typed email
  await p.evaluate(()=>{ const r=Object.values(window.__mock.store.bankers).find(x=>x.doc.name==="Avery Ashdown"); r.doc.lastContact="2026-11-04"; const t=Object.values(window.__mock.store.bankers).find(x=>x.doc.name==="Seth Rowntree"); t.doc.email="seth@personal.example"; });
  await p.evaluate(()=>refetch("bankers")); await p.waitForTimeout(200);
  await p.click('button[data-act="import-open"]'); await p.setInputFiles("#im_file", CSV); await p.waitForTimeout(400);
  const sum=(await p.textContent(".imsum")).replace(/\s+/g," ");
  ok("preview: 14 new at 5 firms, 91 updates", sum.includes("14 new people at 5 firms") && sum.includes("91 to update"), sum);
  const P=await people(p);
  ok("Howden CMA matched to Howden Capital Markets & Advisory", P["Reese Redfern"].mode==="update" && P["Reese Redfern"].existingFirm==="Howden Capital Markets & Advisory", P["Reese Redfern"]);
  ok("Marsh / Guy Carpenter matched to the Guy Carpenter record", P["Shay Ramsey"].mode==="update" && P["Shay Ramsey"].existingFirm==="Guy Carpenter Capital & Advisory" && P["Shay Ramsey"].email==="shay.ramsey@marsh.com" && P["Shay Ramsey"].ctx.includes("Other email: shay.ramsey@guycarp.com"), P["Shay Ramsey"]);
  ok("Hawthorne matched", P["Hawthorne"].mode==="update" && P["Hawthorne"].email==="hawthorne@ardeapartners.com", P["Hawthorne"]);
  ok("two addresses: first is the email, second a note", P["Nell Marlowe"].email==="nell@reaganconsulting.com" && P["Nell Marlowe"].ctx.includes("Other email: marlowe@reaganconsulting.com"), P["Nell Marlowe"]);
  ok("newer CRM date kept: Avery gets only email and notes", P["Avery Ashdown"].status==="Update: email, notes", P["Avery Ashdown"].status);
  ok("typed email kept: Seth gets no email change", !P["Seth Rowntree"].status.includes("email"), P["Seth Rowntree"].status);
  ok("pitch contacts come in as Dormant", ["Xan Wickham","Kip Leyburn","Jax Kenward"].every(n=>P[n].mode==="new" && P[n].rel==="Dormant"), [P["Xan Wickham"],P["Jax Kenward"]]);
  ok("quoted firm with a comma", P["Jax Kenward"].firm==="M&A Services, Inc.", P["Jax Kenward"].firm);
  ok("button label", (await p.textContent("#imSave"))==="Add 14 and update 91");
  await p.screenshot({path:OUTDIR+"/imp2-preview.png"});
  await p.click("#imSave"); await p.waitForTimeout(1500);
  ok("toast", ((await p.textContent("#toastRoot"))||"").includes("Added 14 bankers and updated 91"));
  const arun=await B(p,"Avery Ashdown"), rachel=await B(p,"Finley Fairley"), tina=await B(p,"Seth Rowntree"), cem=await B(p,"Rook Purcell"), sadie=await B(p,"Nell Marlowe");
  ok("Avery: email added, newer date kept, firm unchanged", arun.email==="avery.ashdown@gs.com" && arun.lastContact==="2026-11-04" && arun.firm==="Goldman Sachs" && arun.context.startsWith("What the emails were about: Project Alder") && arun.context.includes("Category: Sell-side advisor"), arun);
  ok("Finley: date from file", rachel.email==="finley.x.fairley@gs.com" && rachel.lastContact==="2026-01-29", rachel);
  ok("Seth: typed email kept, file date applied", tina.email==="seth@personal.example" && tina.lastContact==="2025-06-30", tina);
  ok("Rook: Guy Carpenter, date", cem.email==="rook.purcell@guycarp.com" && cem.lastContact==="2025-11-06" && cem.firm==="Guy Carpenter Capital & Advisory", cem);
  ok("Sadie note", sadie.context.includes("Other email: marlowe@reaganconsulting.com"));
  ok("total 105 people, still 23 firm groups", (await p.evaluate(()=>Object.keys(window.__mock.store.bankers).length))===105 && (await p.$$("tr.firmrow")).length===23, (await p.$$("tr.firmrow")).length);
  const lastCol=async f=>(await p.$$eval(`tr.firmrow:has(.t1:text-is("${f}")) td`,t=>t[4].textContent.replace(/\s+/g," ").trim()));
  ok("firm last contact = most recent person: Goldman (Avery, kept newer date)", (await lastCol("Goldman Sachs"))==="4 NovAvery Ashdown" || (await lastCol("Goldman Sachs"))==="4 Nov Avery Ashdown", await lastCol("Goldman Sachs"));
  ok("Citi latest is Jules Kestrel, 2 Nov", (await lastCol("Citi")).replace(" ","")==="2 NovJules Kestrel".replace(" ",""), await lastCol("Citi"));
  ok("Chardan shows the year and is red", (await lastCol("Chardan")).startsWith("14 Nov 2024") && (await p.$eval('tr.firmrow:has(.t1:text-is("Chardan")) td:nth-child(5)',e=>e.classList.contains("over"))), await lastCol("Chardan"));
  ok("Email all now on Goldman Sachs", (await p.$$('button[data-act="mail-firm"][data-firm="Goldman Sachs"]')).length===1);
  // run the same CSV again: nothing to do
  await p.click('button[data-act="import-open"]'); await p.setInputFiles("#im_file", CSV); await p.waitForTimeout(400);
  const again=(await p.textContent(".imsum")).replace(/\s+/g," ");
  ok("second run: nothing new, nothing to update", again.includes("0 new people") && again.includes("0 to update") && again.includes("105 already up to date") && await p.isDisabled("#imSave"), again);
  await p.keyboard.press("Escape"); await p.close();

  // ---- B. CSV into an empty CRM ----
  p=await pg([]);
  await p.click('button[data-act="import-open"]'); await p.setInputFiles("#im_file", CSV); await p.waitForTimeout(400);
  const s2=(await p.textContent(".imsum")).replace(/\s+/g," ");
  ok("empty CRM: 105 new at 24 firms", s2.includes("105 new people at 24 firms") && s2.includes("0 to update"), s2);
  await p.click("#imSave"); await p.waitForTimeout(800);
  const benson=await B(p,"Hawthorne");
  ok("Hawthorne stored cleanly", benson && benson.email==="hawthorne@ardeapartners.com" && benson.context.includes("Note: last name not shown") && benson.relationship==="Active", benson);
  const logos=await p.evaluate(()=>["Howden CMA","Marsh / Guy Carpenter","Oppenheimer","Luzern Risk"].map(f=>domainOf({firm:f})));
  ok("logos: Howden CMA and Marsh / Guy Carpenter", logos[0]==="howdengroup.com" && logos[1]==="marsh.com", logos);
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
