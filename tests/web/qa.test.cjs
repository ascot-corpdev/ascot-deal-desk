// CEO questions on deals, Add to calendar (.ics), and the board pack's per-deal slides.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs"); const path=require("path"); const os=require("os");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
const SAMPLE=fs.readFileSync(path.join(__dirname,"../fixtures/comps_sample.json"),"utf8");
const PPTX=fs.readFileSync(require("path").join(__dirname,"../../node_modules/pptxgenjs/dist/pptxgen.bundle.js"),"utf8");
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const day=86400000, now=Date.now(), iso=t=>new Date(t).toISOString().slice(0,10);
const seed=[
  ["deals","d1",{codename:"Harbor",target:"Harbor MGA",type:"Acquisition",sector:"E&S casualty",stage:"LOI",ev:150,gwp:260,equity:100,netIncome:15,stake:100,lead:"A. Chen",
    nextStep:"QoE kickoff",nextStepDate:iso(now+5*day),ceoSummary:"Strong E&S platform at a fair price. Adds $260M GWP.",keyRisks:"Reserve adequacy on 2019-21 years.",
    links:[{label:"Harbor profile",url:"https://ascot.sharepoint.com/p.pptx",type:"profile"},{label:"IC memo",url:"https://ascot.sharepoint.com/m.docx",type:"other"}],updatedAt:now}],
  ["deals","d2",{codename:"Summit",stage:"Diligence",ev:80,updatedAt:now}],
  ["deals","d3",{codename:"Cedar",stage:"Screening",ev:20,updatedAt:now}],
  ["notes","n1",{kind:"Update",text:"Ordinary context note",dealId:"d1",createdAt:now-day}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(opts={}){ const ctx=await b.newContext({viewport:opts.vp||{width:1440,height:900},acceptDownloads:true}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
    await p.route("**/*",r=>{const u=r.request().url();
      if(u==="https://a.supabase.co/functions/v1/comps") return r.fulfill({status:200,contentType:"application/json",body:SAMPLE});
      if(u==="https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js") return r.fulfill({contentType:"application/javascript",body:PPTX});
      if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
      if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k"};'});
      if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    await p.addInitScript(s=>{ window.__seed=s; },seed); await p.goto(BASE+(opts.hash||"#ceo")); await p.waitForTimeout(500); return p; }
  const txt=async (p,sel)=>((await p.textContent(sel).catch(()=>""))||"").replace(/\s+/g," ").trim();
  const asCEO=p=>p.evaluate(()=>{ S.session.role="ceo"; S.session.name="CEO"; render(); });
  const asCorp=p=>p.evaluate(()=>{ S.session.role="corpdev"; S.session.name="Corp Dev 2"; render(); });

  // ===== 1. CEO asks a question
  let p=await pg(); await asCEO(p);
  await p.goto(BASE+"#deal/d1"); await p.waitForTimeout(300);
  ok("CEO drawer: Questions section with an ask box", (await txt(p,"#qBox")).includes("No questions yet.") && await p.isVisible("#q_new"));
  await p.click('button[data-act="q-ask"]'); await p.waitForTimeout(100);
  ok("empty question refused", (await txt(p,"#toastRoot")).includes("Write the question first"));
  await p.fill("#q_new","Why is the price fair given the reserve risk?"); await p.click('button[data-act="q-ask"]'); await p.waitForTimeout(300);
  const qs=await p.evaluate(()=>Object.values(window.__mock.store.notes).map(r=>r.doc).filter(n=>n.kind==="Question"));
  ok("question saved as an insert (not upsert) in the CEO's name", qs.length===1 && qs[0].dealId==="d1" && qs[0].authorId==="u1" && qs[0].authorName==="CEO" && !qs[0].replyTo
     && (await p.evaluate(()=>window.__mock.log.some(l=>l.op==="insert"&&l.table==="notes"))), qs);
  ok("thread shows as Open, box cleared, toast", (await txt(p,"#qBox")).includes("Open") && (await txt(p,"#qBox")).includes("Why is the price fair") && (await p.inputValue("#q_new"))==="" && (await txt(p,"#toastRoot")).includes("Question sent to Corp Dev"));
  ok("Recent context keeps ordinary notes only", (await txt(p,"#drawerRoot")).includes("Ordinary context note") && !/Recent context.*Why is the price fair/.test(await txt(p,"#drawerRoot")));
  const qid=qs.length?Object.values(await p.evaluate(()=>window.__mock.store.notes)).find(r=>r.doc.kind==="Question").id:"";
  // live reply from Corp Dev arrives while the CEO is typing a follow-up
  await p.fill("#qr_"+qid, "half-typed follow-up");
  await p.evaluate(qid=>{ window.__mock.store.notes.nA={id:"nA",doc:{kind:"Answer",text:"Price is 1.5x book vs peers at 3.1x.",dealId:"d1",replyTo:qid,createdAt:Date.now(),authorId:"u2",authorName:"Corp Dev 1"},updated_at:new Date().toISOString(),updated_by:"u2"}; window.__mock.ping("notes"); }, qid);
  await p.waitForTimeout(400);
  ok("reply appears live, marked Answered", (await txt(p,"#qBox")).includes("Price is 1.5x book") && (await txt(p,"#qBox")).includes("Answered"), await txt(p,"#qBox"));
  ok("half-typed follow-up survives the refresh", (await p.inputValue("#qr_"+qid))==="half-typed follow-up", {v:await p.inputValue("#qr_"+qid), qid, ids:await p.$$eval("#qBox textarea",x=>x.map(e=>e.id+"="+e.value))});
  await p.fill("#qr_"+qid,"Thanks. And the 2021 year?"); await p.click(`button[data-act="q-reply"][data-id="${qid}"]`); await p.waitForTimeout(300);
  const fu=await p.evaluate(qid=>Object.values(window.__mock.store.notes).map(r=>r.doc).find(n=>n.replyTo===qid&&n.kind==="Question"), qid);
  ok("CEO follow-up saved as a Question reply; thread open again", !!fu && (await txt(p,"#qBox")).includes("Open"), fu);
  await p.screenshot({path:OUTDIR+"/qa-ceo-drawer.png"});
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  ok("CEO view table flags the deal", (await txt(p,'tr[data-id="d1"]')).includes("1 question"));
  // a CEO question doesn't count as deal activity (stalled stays stalled)
  ok("question isn't activity, answer is", await p.evaluate(()=>{ lastNoteAt.src=null; const a=lastNoteAt("deal","d1"); const ans=S.notes.find(n=>n.kind==="Answer"); return a===Math.max(...S.notes.filter(n=>n.dealId==="d1"&&n.kind!=="Question").map(n=>n.createdAt||0)) && a>=ans.createdAt; }));

  // ===== 2. Corp Dev sees it flagged and replies
  await asCorp(p); await p.goto(BASE+"#deals"); await p.waitForTimeout(250);
  ok("Deals: Open questions chip with count", (await txt(p,'.fchip[data-v="questions"]'))==="Open questions1");
  ok("Deals: row tag", (await txt(p,'tr[data-id="d1"]')).includes("1 question"));
  await p.click('.fchip[data-v="questions"]'); await p.waitForTimeout(100);
  ok("chip filters to deals with open questions", (await p.$$eval("tbody tr[data-id]",r=>r.map(x=>x.dataset.id).join(",")))==="d1");
  await p.goto(BASE+"#deal/d1"); await p.waitForSelector("#dealForm");
  ok("editor: Questions from the CEO with Reply and Mark answered", (await txt(p,"#drawerRoot")).includes("Questions") && await p.isVisible(`button[data-act="q-reply"][data-id="${qid}"]`) && await p.isVisible(`button[data-act="q-close"][data-id="${qid}"]`));
  ok("editor notes list excludes questions", !(await txt(p,"#noteList")).includes("Why is the price fair") && (await txt(p,"#noteList")).includes("Ordinary context note"));
  await p.fill("#f_nextStep","QoE kickoff (moved)");   // unsaved edit must survive a reply
  await p.fill("#qr_"+qid,"2021 is fully reserved per the actuary."); await p.click(`button[data-act="q-reply"][data-id="${qid}"]`); await p.waitForTimeout(300);
  const ans=await p.evaluate(qid=>Object.values(window.__mock.store.notes).map(r=>r.doc).filter(n=>n.replyTo===qid&&n.kind==="Answer"), qid);
  ok("Corp Dev reply saved as an Answer", ans.length===2 && ans.some(a=>a.text.startsWith("2021 is fully")), ans);
  ok("thread Answered, no open questions left", (await txt(p,"#qBox")).includes("Answered") && !(await txt(p,"#qBox")).includes("Open"));
  ok("unsaved form edit kept", (await p.inputValue("#f_nextStep"))==="QoE kickoff (moved)");
  // another question, closed without a reply
  await p.fill("#q_new","Corp Dev internal: check broker fee"); await p.click('button[data-act="q-ask"]'); await p.waitForTimeout(300);
  const q2=Object.values(await p.evaluate(()=>window.__mock.store.notes)).find(r=>r.doc.text==="Corp Dev internal: check broker fee").id;
  await p.click(`button[data-act="q-close"][data-id="${q2}"]`); await p.waitForTimeout(300);
  ok("Mark answered closes it without a reply", (await p.evaluate(q2=>window.__mock.store.notes[q2].doc.closedAt>0, q2)) && (await txt(p,"#qBox")).includes("Closed"));
  await p.screenshot({path:OUTDIR+"/qa-corp-editor.png"});
  await p.click('.drawer-f button[data-act="close"]').catch(()=>{}); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  await p.goto(BASE+"#deals"); await p.waitForTimeout(200);
  ok("filter on with nothing left shows 0", (await txt(p,'.fchip[data-v="questions"]'))==="Open questions0");
  await p.click('.fchip[data-v="active"]'); await p.waitForTimeout(100);
  ok("no open questions: chip and tag gone", !(await p.$('.fchip[data-v="questions"]')) && !(await txt(p,'tr[data-id="d1"]')).includes("question"), [await txt(p,".fchips"), await txt(p,'tr[data-id="d1"]'), await p.evaluate(()=>qThreads("d1").map(t=>[t.q.text,t.status]))]);
  await p.close();

  // migration not run: CEO gets a clear message
  p=await pg(); await asCEO(p); await p.evaluate(()=>{ window.__denyInsert="notes"; });
  await p.goto(BASE+"#deal/d1"); await p.waitForTimeout(300);
  await p.fill("#q_new","Anything?"); await p.click('button[data-act="q-ask"]'); await p.waitForTimeout(300);
  ok("without 0005: explains what to run, keeps the text", (await txt(p,"#toastRoot")).includes("0005_ceo_questions.sql") && (await p.inputValue("#q_new"))==="Anything?");
  await p.close();

  // ===== 3. Add to calendar
  p=await pg({hash:"#deal/d1"}); await asCEO(p); await p.goto(BASE+"#ceo"); await p.goto(BASE+"#deal/d1"); await p.waitForTimeout(300);
  const [dl]=await Promise.all([p.waitForEvent("download"), p.click('#drawerRoot button[data-act="ics-next"]')]);
  const ics=fs.readFileSync(await dl.path(),"utf8"), due=iso(now+5*day).replace(/-/g,""), nxt=iso(Date.parse(iso(now+5*day))+day).replace(/-/g,"");
  ok("next step .ics: all-day on the due date, reminder, link back", dl.suggestedFilename()===`Harbor-next-step-${iso(now+5*day)}.ics` && ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.includes(`DTSTART;VALUE=DATE:${due}\r\n`) && ics.includes(`DTEND;VALUE=DATE:${nxt}\r\n`)
     && ics.includes("SUMMARY:Harbor: QoE kickoff\r\n") && ics.includes("UID:next-d1@ascot-deal-desk") && ics.includes("TRIGGER:-PT15H") && ics.replace(/\r\n /g,"").includes("#deal/d1") && ics.trim().endsWith("END:VCALENDAR"), ics);
  ok("lines folded at 75 characters", ics.split("\r\n").every(l=>l.length<=75));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  ok("Next 30 days has calendar links", (await p.$$('ul.mlist button[data-act="ics-next"]')).length===1);
  // from the editor uses the form's (unsaved) date
  await asCorp(p); await p.goto(BASE+"#deal/d1"); await p.waitForSelector("#dealForm");
  await p.fill("#f_nextStepDate","2026-12-15"); await p.fill("#f_nextStep","Signing call, with commas; and semicolons");
  const [dl2]=await Promise.all([p.waitForEvent("download"), p.click('button[data-act="ics-next-form"]')]);
  const ics2=fs.readFileSync(await dl2.path(),"utf8");
  ok("editor: uses the form's date and escapes text", ics2.includes("DTSTART;VALUE=DATE:20261215") && ics2.includes("SUMMARY:Harbor: Signing call\\, with commas\\; and semicolons"), ics2);
  await p.fill("#f_nextStepDate","");
  await p.click('button[data-act="ics-next-form"]'); await p.waitForTimeout(100);
  ok("no date: asks for one", (await txt(p,"#toastRoot")).includes("Set a due date"));
  await p.click('.drawer-f button[data-act="close"]').catch(()=>{}); await p.waitForTimeout(150);
  // earnings call from Comps
  await p.goto(BASE+"#comps"); await p.waitForTimeout(500);
  const [dl3]=await Promise.all([p.waitForEvent("download"), p.click('table.comps button[data-act="ics-call"]')]);
  const ics3=fs.readFileSync(await dl3.path(),"utf8");
  ok("earnings call .ics: timed one-hour event in UTC", ics3.includes("DTSTART:20270125T210000Z") && ics3.includes("DTEND:20270125T220000Z") && ics3.includes("SUMMARY:W. R. Berkley Corporation\\, Q4 2026 Earnings Call\\, Jan 25\\, 2027") && ics3.includes("TRIGGER:-PT30M"), ics3);
  await p.close();

  // ===== 4. Board pack: a slide per LOI / diligence deal
  p=await pg(); await p.goto(BASE+"#ceo"); await p.waitForTimeout(300);
  const [dl4]=await Promise.all([p.waitForEvent("download",{timeout:30000}), p.click('button[data-act="board-pack"]')]);
  const f=path.join(OUTDIR,"pack-deals.pptx"); await dl4.saveAs(f);
  const unz=require("child_process").execSync(`cd ${path.dirname(f)} && rm -rf pk && mkdir pk && cd pk && unzip -q ../pack-deals.pptx && grep -l "Key metrics" ppt/slides/*.xml | wc -l && grep -h -o "<a:t>[^<]*</a:t>" $(grep -l "Key metrics" ppt/slides/*.xml) | sed 's/<[^>]*>//g' | tr '\\n' '|'`).toString();
  const [nSlides, texts]=[parseInt(unz), unz.split("\n").slice(1).join("")];
  ok("two deal slides (Harbor at LOI, Summit in diligence; not Cedar)", nSlides===2 && texts.includes("Harbor: Strong E&amp;S platform at a fair price") && texts.includes("Summit: Diligence, $80M valuation") && !texts.includes("Cedar"), [nSlides, texts.slice(0,300)]);
  ok("Harbor slide: metrics, risks, next step, documents", ["Valuation ($M)","150","1.50x","10.0x","Reserve adequacy","QoE kickoff","Harbor profile","IC memo","Lead: A. Chen"].every(x=>texts.includes(x)), texts);
  ok("document links are hyperlinks", require("child_process").execSync(`grep -h -o 'Target="https://ascot.sharepoint.com/[^"]*"' ${path.dirname(f)}/pk/ppt/slides/_rels/*.rels | sort -u`).toString().split("\n").filter(Boolean).length===2);
  await p.close();
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
