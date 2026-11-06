// Ask Copilot: copies a tracker brief and opens Microsoft 365 Copilot; fallback drawer when copying fails.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const now=Date.now(), day=86400000;
const seed=[
  ["deals","d1",{codename:"Harbor",target:"Harbor MGA",stage:"LOI",type:"Acquisition",ev:100,gwp:40,lead:"A. Chen",nextStep:"QoE kickoff",nextStepDate:"2026-01-01",ceoSummary:"Good fit.",keyRisks:"Reserves",bankerIds:["b1"],updatedAt:now}],
  ["deals","d2",{codename:"Oak",stage:"Dead",deadReason:"Price",updatedAt:now}],
  ["bankers","b1",{name:"Ann Lee",firm:"Marsh",relationship:"Strong",lastContact:"2026-10-01",updatedAt:now}],
  ["notes","n1",{kind:"Call",text:"Ann says <b>pricing</b> firm",bankerId:"b1",createdAt:now-day}],
  ["notes","n2",{kind:"Update",text:"Data room open",dealId:"d1",createdAt:now}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(opts={}){ const ctx=await b.newContext({viewport:opts.vp||{width:1440,height:900}}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
    await p.route("**/*",r=>{const u=r.request().url();
      if(u.includes("/functions/v1/")) return r.fulfill({status:404,body:"{}"});
      if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    await p.addInitScript(([s,deny])=>{ window.__seed=s; window.__copied=null; window.__opened=[];
      Object.defineProperty(navigator,"clipboard",{value:{writeText:async t=>{ if(deny) throw new Error("denied"); window.__copied=t; }}});
      if(deny) document.execCommand=()=>false;
      window.open=(u,n,f)=>{ window.__opened.push([u,n,f]); return null; }; },[seed,!!opts.deny]);
    await p.goto(BASE+(opts.hash||"#ceo")); await p.waitForTimeout(500); return p; }

  let p=await pg();
  ok("Ask Copilot button, no Ask Claude", (await p.textContent("#copilotBtn")).trim()==="Ask Copilot" && await p.isVisible("#copilotBtn") && !(await p.$("#aiBtn")) && !(await p.textContent("header")).includes("Ask Claude"));
  await p.click("#copilotBtn"); await p.waitForTimeout(300);
  const t=await p.evaluate(()=>window.__copied), op=await p.evaluate(()=>window.__opened);
  ok("opens M365 Copilot in a new tab", op.length===1 && op[0][0]==="https://m365.cloud.microsoft/chat" && op[0][1]==="_blank", op);
  ok("brief: instructions and question slot", t.startsWith("You're helping Ascot's Corporate Development team.") && t.includes("My question:") && t.includes("Confidential"), t.slice(0,200));
  ok("brief: active deal line", t.includes("ACTIVE DEALS (1)") && t.includes("- Harbor (Harbor MGA): LOI, Acquisition, valuation $100M, GWP $40M") && t.includes("lead A. Chen") && t.includes("Next step: QoE kickoff by 2026-01-01 (overdue)") && t.includes("Summary: Good fit.") && t.includes("Risks: Reserves"), t);
  ok("brief: dead deal with reason", t.includes("CLOSED, ON HOLD OR DEAD (1)") && t.includes("- Oak: Dead") && t.includes("Outcome: Price"), t);
  ok("brief: bankers", t.includes("BANKERS (1)") && t.includes("- Ann Lee, Marsh: Strong, last contact 2026-10-01"), t);
  ok("brief: notes newest first, tags stripped", /LATEST NOTES \(2\)\n- \S+ Harbor \[Update\]: Data room open\n- \S+ Ann Lee \(Marsh\) \[Call\]: Ann says pricing firm/.test(t), t.slice(t.indexOf("LATEST")));
  ok("toast says to paste", ((await p.textContent("#toastRoot"))||"").includes("Tracker summary copied. Paste it into Copilot"));
  ok("no Claude panel or docking", !(await p.$("#aiRoot .ai")) && !(await p.evaluate(()=>document.body.classList.contains("ai-docked"))));
  // big tracker: trimmed to fit
  const big=await p.evaluate(()=>{ for(let i=0;i<300;i++) S.bankers.push({id:"x"+i,name:"Banker "+i,firm:"Firm "+i,coverage:"Specialty insurance and MGAs across the US and London markets",relationship:"Active",lastContact:"2026-0"+(1+i%9)+"-01"});
    for(let i=0;i<60;i++) S.notes.push({id:"y"+i,kind:"Call",text:"word ".repeat(80),dealId:"d1",createdAt:Date.now()-i}); return copilotBrief(); });
  ok("large tracker trimmed under 15,000 characters, deals kept", big.length<=15000 && big.includes("- Harbor (Harbor MGA)") && /BANKERS \(\d+ most recently contacted of 301\)/.test(big), [big.length, (big.match(/BANKERS \([^)]*\)/)||[])[0]]);
  // CEO can use it too
  await p.evaluate(()=>{ S.session.role="ceo"; render(); });
  ok("CEO sees Ask Copilot", await p.isVisible("#copilotBtn"));
  await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(150);
  ok("phone: no sideways scroll", (await p.evaluate(()=>document.documentElement.scrollWidth))<=390);
  await p.screenshot({path:OUTDIR+"/copilot-phone.png"});
  await p.close();

  // clipboard blocked: drawer with the text
  p=await pg({deny:true});
  await p.click("#copilotBtn"); await p.waitForTimeout(300);
  ok("copy blocked: drawer shows the text to copy and an Open Copilot link", await p.isVisible("#copilotText") && (await p.inputValue("#copilotText")).includes("- Harbor (Harbor MGA)") && (await p.getAttribute('#drawerRoot a[href="https://m365.cloud.microsoft/chat"]',"target"))==="_blank");
  ok("Copilot still opened", (await p.evaluate(()=>window.__opened.length))===1);
  await p.screenshot({path:OUTDIR+"/copilot-fallback.png"});
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  ok("Esc closes it", !(await p.$("#copilotText")));
  await p.close();
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
