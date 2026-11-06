// Claude chat on the Comps tab: what the page sends (the comps on screen, never the tracker), how answers and errors show.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs"); const path=require("path");
const WEB=path.join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
const SAMPLE=fs.readFileSync(path.join(__dirname,"../fixtures/comps_sample.json"),"utf8");
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const seed=[["deals","d1",{codename:"Project Tamarind",target:"Secret Target MGA",stage:"LOI",ev:100,updatedAt:Date.now()}],
  ["bankers","b1",{name:"Avery Example",firm:"Example Bank",updatedAt:Date.now()}],["notes","n1",{kind:"Call",text:"Confidential note text",dealId:"d1",createdAt:Date.now()}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  const ctx=await b.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
  const calls=[]; let mode="ok", delay=0;
  await p.route("**/*",async r=>{const u=r.request().url();
    if(u==="https://a.supabase.co/functions/v1/comps") return r.fulfill({status:200,contentType:"application/json",body:SAMPLE});
    if(u==="https://a.supabase.co/functions/v1/comps-chat"){ const req=r.request(); calls.push({body:JSON.parse(req.postData()||"{}"), auth:req.headers()["authorization"], raw:req.postData()});
      if(delay) await new Promise(res=>setTimeout(res,delay));
      if(mode==="404") return r.fulfill({status:404,contentType:"application/json",body:'{"code":"NOT_FOUND"}'});
      if(mode==="503") return r.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"not_configured",message:"Claude isn't connected yet. Set ANTHROPIC_API_KEY on Supabase (README, Comps chat)."})});
      return r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({text:"**W. R. Berkley** has the lower combined ratio (derived).\n- **Median:** 93.8%\n- <script>bad()</script>", lookups:[{tool:"get_statement",detail:"WRB income statement, 8 quarterly"}], model:"claude-opus-5-5"})}).catch(()=>{}); }
    if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
    if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'});
    if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
  await p.addInitScript(s=>{ window.__seed=s; },seed);
  const txt=async sel=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();

  await p.goto(BASE+"#ceo"); await p.waitForTimeout(500);
  ok("not on the CEO view", !(await p.$(".ccbox")));
  await p.goto(BASE+"#deals"); await p.waitForTimeout(200);
  ok("not on Deals", !(await p.$(".ccbox")));
  await p.goto(BASE+"#comps"); await p.waitForTimeout(500);
  ok("on Comps: heading, Kensho-only note, suggestions", (await txt(".ccbox h3"))==="Ask Claude about these comps" && (await txt(".ccbox")).includes("Uses S&P Global data via Kensho only, not the deal tracker") && (await p.$$(".ccbox .chip")).length===3);

  // a suggestion sends the comps on screen and nothing from the tracker
  await p.click(".ccbox .chip >> nth=0"); await p.waitForTimeout(400);
  const c0=calls[0];
  ok("sends the question with the user's token", c0 && c0.auth==="Bearer t" && JSON.stringify(c0.body.messages)===JSON.stringify([{role:"user",text:"Rank the peers by combined ratio and show how far each is from the median"}]), c0&&c0.body.messages);
  ok("sends the comps table on screen", c0.body.screen.period==="quarter" && c0.body.screen.companies.length===2 && c0.body.screen.companies[0].ticker && "combinedRatio" in c0.body.screen.companies[0] && c0.body.screen.medians);
  ok("never sends the tracker", !/Tamarind|Secret Target|Avery Example|Confidential note/.test(c0.raw), c0.raw.slice(0,200));
  ok("answer rendered: bold, bullets, lookups", (await p.$eval(".ccmsg.a",e=>e.innerHTML)).includes("<b>W. R. Berkley</b>") && (await p.$$(".ccmsg.a li")).length===2 && (await txt(".ccmsg.a .look"))==="Looked up in Kensho: WRB income statement, 8 quarterly");
  ok("answer text is escaped, nothing runs", (await p.$eval(".ccmsg.a",e=>e.innerHTML)).includes("&lt;script&gt;") && !(await p.$(".ccmsg.a script")));
  ok("suggestions hidden once chatting; New chat shown", (await p.$$(".ccbox .chip")).length===0 && await p.isVisible('button[data-act="cc-clear"]'));

  // follow-up with Enter; history goes with it
  await p.fill("#cc_input","And on ROE?"); await p.press("#cc_input","Enter"); await p.waitForTimeout(400);
  ok("Enter sends; history included", calls.length===2 && calls[1].body.messages.map(m=>m.role).join(",")==="user,assistant,user" && calls[1].body.messages[1].text.startsWith("**W. R. Berkley**") && calls[1].body.messages[2].text==="And on ROE?", calls[1]&&calls[1].body.messages);
  await p.fill("#cc_input","line one"); await p.press("#cc_input","Shift+Enter"); await p.waitForTimeout(100);
  ok("Shift+Enter makes a new line, doesn't send", calls.length===2 && (await p.inputValue("#cc_input"))==="line one\n");
  // half-typed text survives a live re-render
  await p.fill("#cc_input","half-typed"); await p.evaluate(()=>render()); await p.waitForTimeout(100);
  ok("typed text kept across a re-render", (await p.inputValue("#cc_input"))==="half-typed");
  await p.screenshot({path:OUTDIR+"/compschat.png",fullPage:true});

  // Stop while waiting
  delay=3000; await p.fill("#cc_input","slow one"); await p.click('button[data-act="cc-send"]'); await p.waitForTimeout(300);
  ok("busy: Stop button and a waiting line", await p.isVisible('button[data-act="cc-stop"]') && (await txt("#ccLog")).includes("Claude is reading the comps"));
  await p.click('button[data-act="cc-stop"]'); await p.waitForTimeout(300);
  ok("Stop: says so, Ask is back", (await txt(".ccmsg.err"))==="Stopped." && await p.isVisible('button[data-act="cc-send"]'));
  delay=0;

  // errors
  await p.click('button[data-act="cc-clear"]'); await p.waitForTimeout(100);
  ok("New chat clears", !(await p.$(".ccmsg")) && (await p.$$(".ccbox .chip")).length===3);
  mode="404"; await p.fill("#cc_input","q"); await p.click('button[data-act="cc-send"]'); await p.waitForTimeout(300);
  ok("not deployed: tells Corp Dev the command", (await txt(".ccmsg.err")).includes("supabase functions deploy comps-chat --no-verify-jwt"));
  await p.evaluate(()=>{ S.session.role="ceo"; S.cc=null; render(); });
  await p.fill("#cc_input","q"); await p.click('button[data-act="cc-send"]'); await p.waitForTimeout(300);
  ok("CEO can use it; not deployed: 'Ask Corp Dev'", (await txt(".ccmsg.err"))==="The comps chat isn't set up yet. Ask Corp Dev.");
  mode="503"; await p.fill("#cc_input","q2"); await p.click('button[data-act="cc-send"]'); await p.waitForTimeout(300);
  ok("not configured: the function's reason", (await p.$$eval(".ccmsg.err",e=>e.map(x=>x.textContent))).some(t=>t.includes("ANTHROPIC_API_KEY")));
  mode="ok";
  await p.click('button[data-act="cc-send"]'); await p.waitForTimeout(150);
  ok("empty question refused", (await txt("#toastRoot")).includes("Type a question first"));
  await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(150);
  ok("phone: no sideways scroll", (await p.evaluate(()=>document.documentElement.scrollWidth))<=390);
  // sign out clears the conversation
  await p.evaluate(()=>{ S.cc={msgs:[{role:"user",text:"x"}],busy:false}; });
  await p.evaluate(()=>signOut && signOut()).catch(()=>{}); await p.waitForTimeout(300);
  ok("sign out clears the chat", await p.evaluate(()=>!S.cc));
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
