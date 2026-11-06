// Add vs Acquire: default from deal type, override per deal, colour coding, filters, CEO split, CSV and board pack.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs"); const path=require("path");
const WEB=path.join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
const PPTX=fs.readFileSync(path.join(__dirname,"../../node_modules/pptxgenjs/dist/pptxgen.bundle.js"),"utf8");
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const now=Date.now();
const seed=[
  ["deals","d1",{codename:"Harbor",type:"Acquisition",stage:"LOI",ev:100,updatedAt:now}],
  ["deals","d2",{codename:"Summit",type:"MGA / program",stage:"LOI",ev:40,updatedAt:now}],
  ["deals","d3",{codename:"Cedar",type:"Reinsurance / capacity",stage:"Screening",ev:20,track:"Acquire",updatedAt:now}],   // overridden
  ["deals","d4",{codename:"Oak",type:"Minority investment",stage:"Diligence",ev:60,updatedAt:now}],
  ["deals","d5",{codename:"Pine",type:"Partnership",stage:"Dead",ev:5,updatedAt:now}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
  await p.route("**/*",r=>{const u=r.request().url();
    if(u==="https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js") return r.fulfill({contentType:"application/javascript",body:PPTX});
    if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
    if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'});
    if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await p.addInitScript(s=>{ window.__seed=s; },seed); await p.goto(BASE+"#deals"); await p.waitForTimeout(500);
  const txt=async sel=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();
  const trk=id=>p.$eval(`tr[data-id="${id}"] .trk`,e=>[e.textContent,e.className]);

  // defaults from type, override kept
  ok("Acquisition -> Acquire (blue)", JSON.stringify(await trk("d1"))==='["Acquire","trk trk-acq"]');
  ok("MGA / program -> Add (teal)", JSON.stringify(await trk("d2"))==='["Add","trk trk-add"]');
  ok("override on the deal wins (reinsurance set to Acquire)", (await trk("d3"))[0]==="Acquire");
  ok("Minority investment -> Acquire", (await trk("d4"))[0]==="Acquire");
  ok("rows carry a coloured edge", await p.$eval('tr[data-id="d2"]',e=>e.classList.contains("trk-add")) && await p.$eval('tr[data-id="d1"]',e=>e.classList.contains("trk-acq")));
  const edge=await p.$eval('tr[data-id="d2"] td:first-child',e=>getComputedStyle(e).boxShadow);
  ok("Add edge is teal", edge.includes("rgb(0, 133, 124)"), edge);
  await p.evaluate(()=>{ window.__mock.otherSave("deals","d4",{nextStep:"Board call",nextStepDate:"2026-01-01"}); });
  await p.waitForTimeout(300);
  const lateEdge=await p.$eval('tr[data-id="d4"] td:first-child',e=>getComputedStyle(e).boxShadow);
  ok("an overdue row keeps its magenta edge", lateEdge.includes("rgb(235, 0, 140)"), lateEdge);
  // filters
  ok("chips: Acquire 3, Add 1 (active only)", (await txt('.fchip[data-v="acquire"]'))==="Acquire3" && (await txt('.fchip[data-v="add"]'))==="Add1");
  await p.click('.fchip[data-v="add"]'); await p.waitForTimeout(100);
  ok("Add filter", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).join(",")))==="d2");
  await p.click('.fchip[data-v="acquire"]'); await p.waitForTimeout(100);
  ok("Acquire filter", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).sort().join(",")))==="d1,d3,d4");
  await p.click('.fchip[data-v="active"]'); await p.waitForTimeout(100);
  await p.screenshot({path:OUTDIR+"/track-deals.png"});

  // editor: follows the type until set; stores a track only when it's a real choice
  await p.goto(BASE+"#deal/d1"); await p.waitForSelector("#dealForm");
  ok("editor shows the effective track", (await p.inputValue("#f_track"))==="Acquire");
  await p.selectOption("#f_type","Partnership");
  ok("changing the type moves an untouched track", (await p.inputValue("#f_track"))==="Add");
  await p.selectOption("#f_type","Acquisition");
  ok("...and back", (await p.inputValue("#f_track"))==="Acquire");
  await p.fill("#f_nextStep","Call seller"); await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(300);
  ok("saving without choosing stores no track", (await p.evaluate(()=>window.__mock.store.deals.d1.doc)).track===undefined);
  await p.goto(BASE+"#deal/d1"); await p.waitForSelector("#dealForm");
  await p.selectOption("#f_track","Add"); await p.selectOption("#f_type","Minority investment");
  ok("a track set by hand stays when the type changes", (await p.inputValue("#f_track"))==="Add");
  await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(300);
  ok("explicit choice saved", (await p.evaluate(()=>window.__mock.store.deals.d1.doc)).track==="Add");
  ok("history names the field", await p.evaluate(()=>FIELD_LABELS.track)==="Add / Acquire");
  await p.goto(BASE+"#deals"); await p.waitForTimeout(200);
  ok("table updates", (await trk("d1"))[0]==="Add");

  // CEO view: split tiles, legend, bars
  await p.evaluate(()=>{ S.session.role="ceo"; render(); }); await p.goto(BASE+"#ceo"); await p.waitForTimeout(300);
  ok("tiles: count and EV split", (await txt(".tiles")).includes("2 Acquire · 2 Add") && (await txt(".tiles")).includes("Acquire $80M · Add $140M"), await txt(".tiles"));
  ok("legend with totals", (await txt(".tlegend"))==="Acquire $80M (2)Add $140M (2)", await txt(".tlegend"));
  const loi=await p.$$eval(".pr:not(.ph):not(.pt)",rows=>rows.map(r=>[...r.querySelectorAll(".ptrack i")].map(i=>i.className+":"+i.style.width)));
  ok("LOI bar: all Add (Harbor now Add + Summit), 63.6%", JSON.stringify(loi[2])===JSON.stringify(["trk-acq:0%","trk-add:63.6364%"]), loi);
  ok("Diligence bar: Acquire", loi[3][0].startsWith("trk-acq:27.27"), loi[3]);
  ok("deal summaries carry the tag and edge", (await p.$$('section:has(h3.sec:text-is("Deal summaries and documents")) tr.trk-add .trk-add')).length===2);
  await p.screenshot({path:OUTDIR+"/track-ceo.png",fullPage:true});
  await p.goto(BASE+"#deal/d2"); await p.waitForTimeout(200);
  ok("deal drawer shows the tag", (await txt("#drawerRoot .stagerow")).startsWith("Add"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(100);

  // CSV and Copilot brief
  await p.evaluate(()=>{ S.session.role="corpdev"; render(); }); await p.goto(BASE+"#deals"); await p.waitForTimeout(200);
  const [dl]=await Promise.all([p.waitForEvent("download"), p.click('button[data-act="export"]')]);
  const csv=fs.readFileSync(await dl.path(),"utf8");
  ok("CSV column", csv.includes('"Type","Add / Acquire"') && csv.includes('"Summit","","MGA / program","Add"'), csv.split("\n").slice(0,3));
  ok("Copilot brief", (await p.evaluate(()=>copilotBrief())).includes("- Summit: Add, LOI, MGA / program"));

  // board pack: stacked chart with both series
  await p.goto(BASE+"#ceo"); await p.waitForTimeout(200);
  const [dl2]=await Promise.all([p.waitForEvent("download",{timeout:30000}), p.click('button[data-act="board-pack"]')]);
  const f=path.join(OUTDIR,"pack-track.pptx"); await dl2.saveAs(f);
  const xml=require("child_process").execSync(`cd ${OUTDIR} && rm -rf pkt && mkdir pkt && cd pkt && unzip -q ../pack-track.pptx && cat ppt/charts/chart*.xml`).toString();
  ok("chart is stacked with Acquire and Add series", xml.includes('<c:grouping val="stacked"/>') && xml.includes(">Acquire<") && xml.includes(">Add<"));
  await p.setViewportSize({width:390,height:844}); await p.goto(BASE+"#deals"); await p.waitForTimeout(200);
  ok("phone: no sideways scroll", (await p.evaluate(()=>document.documentElement.scrollWidth))<=390);
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
