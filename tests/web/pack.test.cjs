// Batch C: board pack download and print/PDF.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs"); const path=require("path");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
const PPTX=fs.readFileSync(require("path").join(__dirname,"../../node_modules/pptxgenjs/dist/pptxgen.bundle.js"),"utf8");
const OUT=OUTDIR;
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const DAY=86400000, now=Date.now(), iso=ms=>new Date(ms).toISOString().slice(0,10);
const sum="Specialty E&S casualty MGA with ten years of underwriting profit; seller wants a signed SPA by year end. Pricing discipline and reserve adequacy are the main diligence points; actuarial review under way.";
const seed=[
  ["bankers","b1",{name:"Ann Lee",firm:"Marsh",relationship:"Strong",lastContact:iso(now-75*DAY)}],
  ["bankers","b2",{name:"Lou Medway",firm:"Aon",relationship:"Active",lastContact:iso(now-5*DAY)}],
  ["bankers","b3",{name:"Cy Dee",firm:"KBW",relationship:"Dormant",lastContact:iso(now-200*DAY)}]
];
const names=["Harbor","Quay","Pier","Jetty","Wharf","Dock","Mole"], stages=["Screening","NDA signed","LOI","Diligence","LOI","Diligence","Screening"];
names.forEach((n,i)=>seed.push(["deals","d"+i,{codename:"Project "+n,target:"US specialty MGA "+(i+1),stage:stages[i],stageSince:now-(i*7+3)*DAY,createdAt:now-90*DAY,updatedAt:now-(i===6?40:2)*DAY,ev:[6.5,120,45,800,15.2,300,9][i],
  nextStep:"Management meeting and data room review",nextStepDate:iso(now+(i%3===0?-4:i*3)*DAY),ceoSummary:sum,bankerIds:["b"+(1+i%3)],lead:"Corp Dev 1"}]));
seed.push(["deals","dX",{codename:"Project Ember",stage:"Dead",deadReason:"Price / valuation",outcomeDate:iso(now-10*DAY),ev:60,updatedAt:now-10*DAY}]);
seed.push(["deals","dY",{codename:"Project Cove",stage:"Closed",outcomeDate:iso(now-30*DAY),ev:140,updatedAt:now-30*DAY}]);
(async()=>{
  const b=await chromium.launch(); const errs=[];
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
  let libRequests=0;
  await p.route("**/*",r=>{const u=r.request().url();
    if(u==="https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js"){ libRequests++; return r.fulfill({contentType:"application/javascript",body:PPTX}); }
    if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await p.addInitScript(s=>{ window.__seed=s; },seed);
  await p.goto(BASE+"#ceo"); await p.waitForTimeout(500);
  // add a little history so "what changed" has content
  await p.evaluate(()=>{ const M=window.__mock; M.hist("deals","d3","update",{stage:"Diligence"},{stage:"LOI"},"u2"); M.hist("deals","d1","update",{links:[]},{links:[{label:"IC memo v2",url:"https://x/a.docx"}]},"u2"); M.hist("deals","d5","insert",null,{codename:"Project Dock"},"u1"); });
  await p.selectOption("#chgDays","14"); await p.waitForTimeout(300);
  ok("library not loaded until asked", libRequests===0);
  const [dl]=await Promise.all([p.waitForEvent("download",{timeout:30000}), p.click('button[data-act="board-pack"]')]);
  const file=path.join(OUT,"pack.pptx"); await dl.saveAs(file);
  ok("download name", /^Deal pipeline board pack \d{4}-\d{2}-\d{2}\.pptx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok("library loaded once", libRequests===1);
  await p.waitForTimeout(200);
  ok("toast says downloaded", ((await p.textContent("#toastRoot"))||"").includes("Board pack downloaded"));
  // print / PDF
  await p.emulateMedia({media:"print"});
  ok("print hides buttons and tabs", !(await p.isVisible('button[data-act="board-pack"]')) && !(await p.isVisible("nav.tabs")));
  await p.pdf({path:path.join(OUT,"print.pdf"),format:"A4",landscape:true,printBackground:true});
  await p.emulateMedia({media:"screen"});
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
