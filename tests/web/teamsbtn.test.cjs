// Header "Team chat" link: Corp Dev only, only when TEAMS_CHAT_ID is set.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const LINK="https://teams.microsoft.com/l/chat/19%3Ad1391b0afec44bbca4d639d9b8d9bdf2%40thread.v2/conversations?context=%7B%22contextType%22%3A%22chat%22%7D";
const seed=[["deals","d1",{codename:"Harbor",stage:"LOI",ev:100,updatedAt:Date.now()}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(cfg, vp){ const ctx=await b.newContext({viewport:vp||{width:1440,height:900}}); const p=await ctx.newPage(); p.on("pageerror",e=>errs.push(String(e)));
    await p.route("**/*",r=>{const u=r.request().url();
      if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK});
      if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:"window.DEALDESK_CONFIG="+JSON.stringify({supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"sb_publishable_k",...cfg})+";"});
      if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    await p.addInitScript(s=>{ window.__seed=s; },seed); await p.goto(BASE+"#ceo"); await p.waitForTimeout(500); return p; }
  let p=await pg({teamsChatId:LINK});
  const vis=await p.isVisible("#teamsBtn"), href=await p.getAttribute("#teamsBtn","href");
  const lbl=(await p.innerText("#teamsBtn")).replace(/\s+/g," ").trim(); ok("Corp Dev: Team chat link shown beside Ask Copilot", vis && lbl==="Team chat ↗" && await p.isVisible("#copilotBtn"), lbl);
  ok("opens the group chat in Teams, new tab", href==="https://teams.microsoft.com/l/chat/19%3Ad1391b0afec44bbca4d639d9b8d9bdf2%40thread.v2/0" && (await p.getAttribute("#teamsBtn","target"))==="_blank" && (await p.getAttribute("#teamsBtn","rel")).includes("noopener"), href);
  const order=await p.$$eval(".who > *:not([hidden])",x=>x.map(e=>e.id));
  ok("sits right before Ask Copilot", order.indexOf("teamsBtn")===order.indexOf("copilotBtn")-1, order);
  await p.screenshot({path:OUTDIR+"/teamsbtn-desk.png",clip:{x:0,y:0,width:1440,height:150}});
  await p.evaluate(()=>{ S.session.role="ceo"; render(); });
  ok("CEO: hidden", !(await p.isVisible("#teamsBtn")));
  await p.evaluate(()=>{ S.session.role="corpdev"; render(); });
  await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(150);
  ok("phone: shown, no sideways scroll", await p.isVisible("#teamsBtn") && (await p.evaluate(()=>document.documentElement.scrollWidth))<=390);
  await p.screenshot({path:OUTDIR+"/teamsbtn-phone.png",clip:{x:0,y:0,width:390,height:200}});
  await p.close();
  p=await pg({});
  ok("no TEAMS_CHAT_ID: hidden", !(await p.isVisible("#teamsBtn")));
  await p.close();
  p=await pg({teamsChatId:"https://teams.microsoft.com/l/channel/19%3Axyz%40thread.tacv2/General"});
  ok("channel link (not a chat): hidden", !(await p.isVisible("#teamsBtn")));
  await p.evaluate(()=>signOut&&signOut()).catch(()=>{});
  await p.close();
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
