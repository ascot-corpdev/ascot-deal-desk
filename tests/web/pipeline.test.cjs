// CEO view "Pipeline slide": grouping, columns, Vision 2030 colours, new deal fields, and the .pptx download.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs"); const path=require("path");
const WEB=path.join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
const PPTX=fs.readFileSync(path.join(__dirname,"../../node_modules/pptxgenjs/dist/pptxgen.bundle.js"),"utf8");
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const now=Date.now();
const D=(id,o)=>["deals",id,{updatedAt:now,...o}];
const seed=[
  D("d1",{codename:"Project Ironbound",target:"Ironbound MGA",type:"Acquisition",stage:"LOI",ev:150,ownership:"PE-backed",hq:"Austin, TX",keyStats:"$120M GWP; $18M EBITDA",vision2030:"Quick hit",ceoSummary:"Specialty MGA with strong loss ratios.",nextStep:"Submit LOI by 20 Nov",sellsideAdvisor:"Example Partners"}),
  D("d2",{codename:"Vyrd",type:"Acquisition",stage:"Screening",ev:30,vision2030:"Careful consideration"}),
  D("d3",{codename:"Project Lantern",target:"Lantern Programs",type:"MGA / program",stage:"Diligence",ev:60,vision2030:"TBC"}),
  D("d4",{codename:"Project Oak",target:"Oak Re",type:"Acquisition",stage:"Dead",ev:80,deadReason:"Price"}),
  D("d5",{codename:"Project Done",target:"Done Co",type:"Acquisition",stage:"Closed",ev:10}),
  D("d6",{codename:"Project Pause",target:"Pause Co",type:"Partnership",stage:"On hold",ev:5})];
for(let i=0;i<12;i++) seed.push(D("a"+i,{codename:"Project A"+i,target:"Acq "+i,type:"Acquisition",stage:"Screening",ev:i}));
(async()=>{
  const b=await chromium.launch(); const errs=[];
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
  await p.route("**/*",r=>{const u=r.request().url();
    if(u==="https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js") return r.fulfill({contentType:"application/javascript",body:PPTX});
    if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
    if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'});
    if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await p.addInitScript(s=>{ window.__seed=s; },seed); await p.goto(BASE+"#ceo"); await p.waitForTimeout(500);
  const txt=async sel=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();

  ok("Dashboard by default, Board pack button", (await p.getAttribute('button[data-act="ceo-mode"][data-v="dash"]',"aria-pressed"))==="true" && await p.isVisible('button[data-act="board-pack"]'));
  await p.click('button[data-act="ceo-mode"][data-v="slide"]'); await p.waitForTimeout(200);
  ok("slide view: title and download button", (await txt("h2.pstitle"))==="15 active situations; 2 at LOI or later" && await p.isVisible('button[data-act="pipeline-pptx"]') && !(await p.$('button[data-act="board-pack"]')), await txt("h2.pstitle"));
  const heads=await p.$$eval("table.pslide thead th",t=>t.map(x=>x.textContent));
  ok("slide columns", JSON.stringify(heads)==='["Company","Ownership","HQ","2025 key stats","Project name","Vision 2030 type","Description","Current status","Sell-side advisor"]', heads);
  const bands=await p.$$eval("table.pslide tr.pband",t=>t.map(x=>x.className.replace("pband ","")+":"+x.textContent.replace(/\s+/g," ").trim()));
  ok("sections in order with counts", JSON.stringify(bands)==='["trk-acq:Acquire (14)","trk-add:Add (2)","pass:Passed deals (1)"]', bands);
  const row=async id=>p.$$eval(`table.pslide tr[data-id="${id}"] td`,t=>t.map(x=>x.textContent.replace(/\s+/g," ").trim()));
  ok("full row from the deal's fields", JSON.stringify(await row("d1"))===JSON.stringify(["Ironbound MGALOI","PE-backed","Austin, TX","$120M GWP; $18M EBITDA","Project Ironbound","Quick hit","Specialty MGA with strong loss ratios.","Submit LOI by 20 Nov","Example Partners"]), await row("d1"));
  const vyrd=await row("d2");
  ok("no target: company is the codename; codename not 'Project' so no project name", vyrd[0]==="VyrdScreening" && vyrd[4]==="", vyrd);
  ok("Vision 2030 colours", await p.$eval('tr[data-id="d1"] td:nth-child(6)',e=>e.className)==="v-quick" && await p.$eval('tr[data-id="d2"] td:nth-child(6)',e=>e.className)==="v-careful" && await p.$eval('tr[data-id="d3"] td:nth-child(6)',e=>e.className)==="");
  ok("dead deal under Passed, closed deal left off, on-hold kept", !!(await p.$('tr.pband.pass + tr[data-id="d4"]')) && !(await p.$('tr[data-id="d5"]')) && !!(await p.$('tr[data-id="d6"]')));
  ok("Add section: MGA and partnership deals", (await p.$$eval("table.pslide tr[data-id]",r=>r.map(x=>x.dataset.id))).join(",").includes("d3,d6"));
  await p.screenshot({path:OUTDIR+"/pipeline-slide.png",fullPage:true});
  await p.click('button[data-act="ceo-track"][data-v="add"]'); await p.waitForTimeout(150);
  ok("Add / Acquire filter applies", (await p.$$("table.pslide tr.pband")).length===1 && (await txt("h2.pstitle"))==="1 active situation; 1 at LOI or later", await txt("h2.pstitle"));
  await p.click('button[data-act="ceo-track"][data-v="all"]'); await p.waitForTimeout(150);
  await p.reload(); await p.waitForTimeout(500);
  ok("mode remembered after reload", !!(await p.$("table.pslide")));
  // click a row opens the deal
  await p.click('table.pslide tr[data-id="d3"]'); await p.waitForTimeout(200);
  ok("row opens the deal", (await p.evaluate(()=>location.hash))==="#deal/d3"); await p.keyboard.press("Escape"); await p.waitForTimeout(150);

  // pptx
  const [dl]=await Promise.all([p.waitForEvent("download",{timeout:30000}), p.click('button[data-act="pipeline-pptx"]')]);
  const today=await p.evaluate(()=>TODAY());
  ok("file name", dl.suggestedFilename()===`Ascot-pipeline-${today}.pptx`, dl.suggestedFilename());
  const f=path.join(OUTDIR,"pipeline.pptx"); await dl.saveAs(f);
  const cp=require("child_process"); cp.execSync(`cd ${OUTDIR} && rm -rf pps && mkdir pps && cd pps && unzip -q ../pipeline.pptx`);
  const slides=fs.readdirSync(path.join(OUTDIR,"pps/ppt/slides")).filter(x=>/^slide\d+\.xml$/.test(x)).sort((a,b)=>parseInt(a.slice(5))-parseInt(b.slice(5)));
  const xml=slides.map(x=>fs.readFileSync(path.join(OUTDIR,"pps/ppt/slides",x),"utf8"));
  const texts=xml.map(x=>(x.match(/<a:t>[^<]*<\/a:t>/g)||[]).map(t=>t.slice(5,-6)).join("|"));
  ok("two slides: 14 Acquire rows split at 11; the rest and Add and Passed on slide 2", slides.length===2 && texts[0].includes("|Acquire|") && texts[1].includes("Acquire (continued)") && texts[1].includes("|Add|") && texts[1].includes("Passed deals"), [slides.length, texts.map(t=>t.slice(0,80))]);
  ok("title, footer, source on each slide", texts.every(t=>t.includes("15 active situations; 2 at LOI or later")) && xml.every(x=>x.includes("Source: Corp Dev deal tracker as of")) && fs.readFileSync(path.join(OUTDIR,"pps/ppt/slideLayouts/slideLayout2.xml"),"utf8").includes("Ascot Group"));
  ok("header navy, white bold; title magenta 28pt Arial", xml[0].includes('<a:srgbClr val="262166"/>') && /sz="2800"[^>]*>.*?EB008C/s.test(xml[0]) && xml[0].includes('typeface="Arial"'));
  ok("Vision 2030 colours in the slide", xml.some(x=>/00857C.{0,400}Quick hit|Quick hit/.test(x)) && xml.join("").includes("C46A1B"));
  ok("section bands in track colours", xml[0].includes('val="00539E"') && xml[1].includes('val="00857C"') && xml[1].includes('val="8A8A8A"'));

  // new fields in the editor
  await p.evaluate(()=>{ S.session.role="corpdev"; render(); });
  await p.goto(BASE+"#deal/d2"); await p.waitForSelector("#dealForm");
  ok("editor has the slide fields", ["f_ownership","f_hq","f_keyStats","f_vision2030","f_sellsideAdvisor"].every(Boolean) && (await p.$$eval("#f_vision2030 option",o=>o.map(x=>x.textContent))).join(",")==="Not set,Quick hit,Careful consideration,TBC,NA");
  await p.fill("#f_ownership","Founder owned"); await p.fill("#f_hq","Bermuda"); await p.fill("#f_keyStats","$40M GWP"); await p.selectOption("#f_vision2030","TBC"); await p.fill("#f_sellsideAdvisor","Example Advisors");
  await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(300);
  const doc=await p.evaluate(()=>window.__mock.store.deals.d2.doc);
  ok("saved", doc.ownership==="Founder owned" && doc.hq==="Bermuda" && doc.keyStats==="$40M GWP" && doc.vision2030==="TBC" && doc.sellsideAdvisor==="Example Advisors", doc);
  ok("history labels", await p.evaluate(()=>FIELD_LABELS.vision2030==="Vision 2030 type" && FIELD_LABELS.sellsideAdvisor==="Sell-side advisor"));
  await p.setViewportSize({width:390,height:844}); await p.goto(BASE+"#ceo"); await p.waitForTimeout(200);
  ok("phone: slide table scrolls inside its box, page doesn't", (await p.evaluate(()=>document.documentElement.scrollWidth))<=390);
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
