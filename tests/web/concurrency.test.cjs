// Concurrency tests for web/index.html against a mocked supabase-js.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const WEB = process.argv[2] || require("path").join(__dirname, "../../web");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");
const BASE = "http://deal.test/";

let pass = 0, fail = 0; const failures = [];
function check(name, cond, extra){ if(cond){ pass++; console.log("  ok   " + name); } else { fail++; failures.push(name); console.log("  FAIL " + name + (extra!==undefined ? "  -> " + JSON.stringify(extra) : "")); } }

const DEAL = {codename:"Harbor", target:"Harbor MGA", type:"Acquisition", sector:"E&S casualty", stage:"Screening", priority:"Medium", ev:6.5, gwp:40, stake:100,
  origin:"Banker-led", lead:"Corp Dev 2", nextStep:"Mgmt call", nextStepDate:"2026-11-20", ceoSummary:"Good fit.", keyRisks:"Reserves", bankerIds:["b1"],
  links:[{label:"IC memo", url:"https://x.sharepoint.com/memo.docx"}], createdAt:1, createdBy:"u2", updatedAt:1, updatedBy:"u2", updatedByName:"Corp Dev 1"};
const BANKER = {name:"Ann Lee", firm:"Marsh", website:"", title:"MD", coverage:"Specialty", email:"ann@marsh.com", phone:"1", relationship:"Strong", lastContact:"2026-10-01", context:"Warm", createdAt:1, updatedBy:"u2", updatedByName:"Corp Dev 1"};

async function freshPage(browser){
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("**/*", async route => {
    const u = route.request().url();
    if(/supabase\.js(\?|$)/.test(u)) return route.fulfill({contentType:"application/javascript", body:MOCK});
    if(/\/config\.js(\?|$)/.test(u)) return route.fulfill({contentType:"application/javascript", body:'window.DEALDESK_CONFIG={supabaseUrl:"https://abc.supabase.co/rest/v1/",supabaseAnonKey:"sb_publishable_x",usernameDomain:"deal-desk.local"};'});
    if(u === BASE || u.startsWith(BASE + "index.html") || u.startsWith(BASE + "#")) return route.fulfill({contentType:"text/html", body:fs.readFileSync(path.join(WEB, "index.html"), "utf8")});
    if(u.startsWith("https://www.google.com/s2/favicons")) return route.fulfill({status:404, body:""});
    return route.fulfill({status:404, body:""});
  });
  // Seed before the app boots
  await page.addInitScript(({DEAL, BANKER}) => {
    window.__seed=[["bankers","b1",BANKER],["bankers","b2",{...BANKER, name:"Lou Medway", firm:"Aon"}],["deals","d1",DEAL],["deals","d2",{...DEAL, codename:"Quay", stage:"LOI"}]];
  }, {DEAL, BANKER});
  await page.goto(BASE + "#deals");
  await page.waitForSelector('button[data-act="edit-deal"][data-id="d1"]');
  page.errors = errors;
  return page;
}
const doc = (page, t, id) => page.evaluate(([t,id]) => window.__mock.doc(t,id), [t,id]);
const toastText = page => page.locator("#toastRoot").innerText().catch(()=> "");
const drawerOpen = page => page.locator("#drawerRoot aside").count().then(n=>n>0);
async function openDeal(page, id="d1"){ await page.click(`button[data-act="edit-deal"][data-id="${id}"]`); await page.waitForSelector("#dealForm"); }
async function save(page){ await page.click('.drawer-f button[data-act="save-deal"]'); await page.waitForTimeout(150); }

(async () => {
  const browser = await chromium.launch();

  console.log("(e) single user, normal editing");
  { const p = await freshPage(browser);
    await openDeal(p);
    await p.fill("#f_nextStep", "Send LOI draft");
    await p.selectOption("#f_priority", "High");
    await save(p);
    const d = await doc(p, "deals", "d1");
    check("drawer closes after save", !(await drawerOpen(p)));
    check("toast says Saved", (await toastText(p)).includes("Saved"));
    check("next step and priority saved", d.nextStep === "Send LOI draft" && d.priority === "High", d);
    check("untouched fields unchanged", d.stage === "Screening" && d.ev === 6.5 && d.codename === "Harbor" && JSON.stringify(d.bankerIds) === '["b1"]' && d.links.length === 1, d);
    check("createdAt/createdBy kept, updatedByName is me", d.createdAt === 1 && d.createdBy === "u2" && d.updatedByName === "Corp Dev 2", d);
    check("write was a compare-and-set update", (await p.evaluate(()=>window.__mock.log)).some(l=>l.op==="update" && l.cas && l.matched===1));
    check("table shows saved next step", (await p.locator("table").innerText()).includes("Send LOI draft"));
    // New deal still inserts
    await p.click('button[data-act="new-deal"]'); await p.waitForSelector("#dealForm");
    await p.fill("#f_codename", "Pier"); await p.click('.drawer-f button[data-act="save-deal"]'); await p.waitForTimeout(150);
    const ids = await p.evaluate(()=>Object.values(window.__mock.store.deals).filter(r=>r.doc.codename==="Pier").length);
    check("new deal created", ids === 1 && (await toastText(p)).includes("Deal created"));
    // Open and save with no edits: nothing written
    const before = (await p.evaluate(()=>window.__mock.log.length));
    await openDeal(p); await save(p);
    check("save with no edits writes nothing", (await p.evaluate(()=>window.__mock.log.length)) === before && !(await drawerOpen(p)));
    // Banker edit
    await p.goto(BASE + "#bankers"); await p.waitForSelector('button[data-act="edit-banker"][data-id="b1"]');
    await p.click('button[data-act="edit-banker"][data-id="b1"]'); await p.waitForSelector("#bankerForm");
    await p.fill("#b_title", "Managing Director"); await p.click('.drawer-f button[data-act="save-banker"]'); await p.waitForTimeout(150);
    const b = await doc(p, "bankers", "b1");
    check("banker title saved, rest unchanged", b.title === "Managing Director" && b.firm === "Marsh" && b.relationship === "Strong", b);
    check("no page errors", p.errors.length === 0, p.errors);
    await p.close(); }

  console.log("(a) different fields edited concurrently");
  { const p = await freshPage(browser);
    await openDeal(p);
    await p.evaluate(()=>window.__mock.otherSave("deals","d1",{stage:"LOI"}));   // other user, with realtime ping
    await p.waitForTimeout(400);                                                  // refetch arrives while drawer open
    check("open form not overwritten by live data", (await p.inputValue("#f_stage")) === "Screening");
    await p.fill("#f_nextStep", "Book site visit");
    await save(p);
    const d = await doc(p, "deals", "d1");
    check("their stage survives", d.stage === "LOI", d);
    check("my next step survives", d.nextStep === "Book site visit", d);
    check("no conflict panel, drawer closed", !(await drawerOpen(p)));
    // Same thing without the realtime ping (stale cache)
    await openDeal(p);
    await p.evaluate(()=>window.__mock.otherSave("deals","d1",{ev:12, links:[]},{notify:false}));
    await p.fill("#f_keyRisks", "Reserves; cat exposure"); await save(p);
    const d2 = await doc(p, "deals", "d1");
    check("stale cache: their EV and links survive, my risks saved", d2.ev === 12 && d2.links.length === 0 && d2.keyRisks === "Reserves; cat exposure" && d2.stage === "LOI", d2);
    check("no page errors", p.errors.length === 0, p.errors);
    await p.close(); }

  console.log("(b) same field: conflict panel");
  for(const choice of ["mine", "theirs"]){
    const p = await freshPage(browser);
    await openDeal(p);
    await p.evaluate(()=>window.__mock.otherSave("deals","d1",{stage:"LOI", priority:"Low"}));
    await p.waitForTimeout(400);
    await p.selectOption("#f_stage", "Diligence");
    await p.fill("#f_nextStep", "Start QoE");
    await save(p);
    const panel = await p.locator("#drAlert").innerText();
    check(`[${choice}] panel shown, drawer stays open`, (await drawerOpen(p)) && panel.includes("Someone else saved this deal"), panel);
    check(`[${choice}] message names who, field, both values`, /Corp Dev 1 changed Stage to LOI while you were editing; you have Diligence\./.test(panel.replace(/\s+/g," ")), panel);
    if(choice==="mine") await p.screenshot({path:OUTDIR+"/conflict.png"});
    check(`[${choice}] only the clashing field listed (not priority)`, !panel.includes("Priority"), panel);
    check(`[${choice}] nothing saved yet`, (await doc(p,"deals","d1")).nextStep === "Mgmt call");
    // Save without choosing is refused
    await p.click('#drAlert button[data-act="save-deal"]'); await p.waitForTimeout(100);
    check(`[${choice}] save without a choice is refused`, (await toastText(p)).includes("Choose Keep theirs or Use mine") && (await doc(p,"deals","d1")).nextStep === "Mgmt call");
    await p.click(`#drAlert button[data-act="cf-pick"][data-c="${choice}"]`);
    check(`[${choice}] choice shows as pressed`, (await p.getAttribute(`#drAlert button[data-c="${choice}"]`, "aria-pressed")) === "true");
    await p.click('#drAlert button[data-act="save-deal"]'); await p.waitForTimeout(150);
    const d = await doc(p, "deals", "d1");
    check(`[${choice}] stage is ${choice==="mine"?"Diligence":"LOI"}`, d.stage === (choice==="mine" ? "Diligence" : "LOI"), d);
    check(`[${choice}] my other change saved, their priority kept`, d.nextStep === "Start QoE" && d.priority === "Low", d);
    check(`[${choice}] drawer closed`, !(await drawerOpen(p)));
    check(`[${choice}] no page errors`, p.errors.length === 0, p.errors);
    await p.close();
  }
  // Conflict on an array field (bankers) and fallback name from profiles
  { const p = await freshPage(browser);
    await openDeal(p);
    await p.evaluate(()=>{ const r=window.__mock.store.deals.d1; r.doc={...r.doc, bankerIds:["b2"], updatedByName:"", updatedBy:""}; r.updated_at="2026-11-04T13:00:00.999+00:00"; r.updated_by="u2"; });
    await p.check('input[name=bk][value="b2"]');   // mine: b1 + b2
    await save(p);
    const panel = (await p.locator("#drAlert").innerText()).replace(/\s+/g," ");
    check("array conflict: names from profiles, banker names shown", /Corp Dev 1 changed Bankers to Lou Medway while you were editing; you have Ann Lee, Lou Medway\./.test(panel), panel);
    await p.click('#drAlert button[data-c="theirs"]'); await p.click('#drAlert button[data-act="save-deal"]'); await p.waitForTimeout(150);
    check("keep theirs on bankers with no other edits leaves their value", JSON.stringify((await doc(p,"deals","d1")).bankerIds) === '["b2"]' && !(await drawerOpen(p)));
    await p.close(); }

  console.log("(c) deleted while open");
  for(const action of ["discard", "recreate"]){
    const p = await freshPage(browser);
    await openDeal(p);
    await p.fill("#f_nextStep", "Revive");
    await p.evaluate(()=>window.__mock.otherDelete("deals","d1"));
    await p.waitForTimeout(400);
    await save(p);
    const panel = await p.locator("#drAlert").innerText();
    check(`[${action}] says it was deleted`, panel.includes("This deal was deleted by someone else"), panel);
    check(`[${action}] not silently recreated`, (await doc(p,"deals","d1")) === null);
    await save(p);  // footer save again: still refused
    check(`[${action}] second save still does not recreate`, (await doc(p,"deals","d1")) === null);
    if(action === "discard"){
      await p.click('#drAlert button:has-text("Discard my changes")'); await p.waitForTimeout(100);
      check("discard closes drawer, row stays deleted", !(await drawerOpen(p)) && (await doc(p,"deals","d1")) === null);
    } else {
      await p.click('#drAlert button[data-act="gone-recreate"]'); await p.waitForTimeout(150);
      const d = await doc(p,"deals","d1");
      check("recreate brings it back with my changes", d && d.nextStep === "Revive" && d.codename === "Harbor" && d.createdAt === 1, d);
      check("recreate toast", (await toastText(p)).includes("Deal recreated"));
    }
    check(`[${action}] no page errors`, p.errors.length === 0, p.errors);
    await p.close();
  }

  console.log("(d) compare-and-set miss, retry");
  { const p = await freshPage(browser);
    await openDeal(p);
    await p.fill("#f_nextStep", "IC on Friday");
    // Someone saves between our read and our write
    await p.evaluate(()=>{ window.__mock.bumpBeforeNextUpdate={table:"deals", id:"d1", patch:{priority:"High"}}; window.__mock.log.length=0; });
    await save(p);
    const d = await doc(p, "deals", "d1");
    const log = await p.evaluate(()=>window.__mock.log.filter(l=>l.op==="update"));
    check("first write missed, retry matched", log.length === 2 && log[0].matched === 0 && log[1].matched === 1, log);
    check("both changes survive", d.nextStep === "IC on Friday" && d.priority === "High", d);
    check("drawer closed with Saved", !(await drawerOpen(p)) && (await toastText(p)).includes("Saved"));
    // Retry sees a real conflict: the in-between save touched my field
    await openDeal(p);
    await p.fill("#f_nextStep", "Mine");
    await p.evaluate(()=>{ window.__mock.bumpBeforeNextUpdate={table:"deals", id:"d1", patch:{nextStep:"Theirs"}}; });
    await save(p);
    const panel = (await p.locator("#drAlert").innerText()).replace(/\s+/g," ");
    check("retry that finds a clash shows the panel", panel.includes("changed Next step to Theirs") && (await doc(p,"deals","d1")).nextStep === "Theirs", panel);
    check("no page errors", p.errors.length === 0, p.errors);
    await p.close(); }

  console.log("Claude proposals merge onto the latest row");
  { const p = await freshPage(browser);
    await p.evaluate(()=>window.__mock.otherSave("deals","d1",{stage:"Diligence"},{notify:false}));  // page cache is stale
    await p.evaluate(()=>{ S.proposals.px={id:"px", kind:"deal-update", target:"d1", changes:{priority:"High"}, status:"pending", title:"t"}; });
    await p.evaluate(()=>applyProposal("px")); await p.waitForTimeout(100);
    const d = await doc(p,"deals","d1");
    check("proposal applied without undoing their stage", d.priority === "High" && d.stage === "Diligence", d);
    // Deleted target: no recreate
    await p.evaluate(()=>window.__mock.otherDelete("deals","d2",{notify:false}));
    await p.evaluate(()=>{ S.proposals.py={id:"py", kind:"deal-update", target:"d2", changes:{priority:"Low"}, status:"pending", title:"t"}; });
    await p.evaluate(()=>applyProposal("py")); await p.waitForTimeout(100);
    check("proposal on a deleted deal does not recreate it", (await doc(p,"deals","d2")) === null && (await toastText(p)).includes("deleted by someone else"));
    check("no page errors", p.errors.length === 0, p.errors);
    await p.close(); }

  console.log("Also editing notice (presence)");
  { const p = await freshPage(browser);
    await p.waitForTimeout(50);
    check("joined deal-desk-presence", (await p.evaluate(()=>window.__mock.channels)).includes("deal-desk-presence"));
    check("tracks editing:null when nothing open", (await p.evaluate(()=>window.__mock.tracked)).editing === null);
    await openDeal(p); await p.waitForTimeout(50);
    const tr = await p.evaluate(()=>window.__mock.tracked);
    check("tracks editing deal:d1 with my id and name", tr.editing === "deal:d1" && tr.id === "u1" && tr.name === "Corp Dev 2", tr);
    await p.evaluate(()=>window.__mock.setOthers([{id:"u1",name:"Corp Dev 2",editing:"deal:d1"},{id:"u2",name:"Corp Dev 1",editing:"deal:d1"}]));
    check("shows Corp Dev 1 is editing this deal", (await p.locator("#drPresence").innerText()) === "Corp Dev 1 is editing this deal");
    await p.evaluate(()=>window.__mock.setOthers([{id:"u2",name:"Corp Dev 1",editing:"deal:d2"}]));
    check("clears when they move to another deal", (await p.locator("#drPresence").innerText()) === "");
    await p.evaluate(()=>window.__mock.setOthers([{id:"u2",name:"Corp Dev 1",editing:"deal:d1"}]));
    await p.click('.drawer-f button[data-act="close"]'); await p.waitForTimeout(50);
    check("close sends editing:null", (await p.evaluate(()=>window.__mock.tracked)).editing === null);
    await p.goto(BASE + "#bankers"); await p.waitForSelector('button[data-act="edit-banker"][data-id="b1"]'); await p.waitForTimeout(50);
    await p.click('button[data-act="edit-banker"][data-id="b1"]'); await p.waitForSelector("#bankerForm");
    await p.evaluate(()=>window.__mock.setOthers([{id:"u2",name:"Corp Dev 1",editing:"banker:b1"}]));
    check("banker drawer notice", (await p.locator("#drPresence").innerText()) === "Corp Dev 1 is editing this banker");
    await p.evaluate(()=>signOut()); await p.waitForTimeout(100);
    const m = await p.evaluate(()=>({u:window.__mock.untracked, r:window.__mock.removed}));
    check("sign-out untracks and leaves the presence channel", m.u === true && (m.r||[]).includes("deal-desk-presence"), m);
    check("no page errors", p.errors.length === 0, p.errors);
    await p.close(); }

  console.log("Logging a banker interaction while the drawer is open");
  { const p = await freshPage(browser);
    await p.goto(BASE + "#bankers"); await p.waitForSelector('button[data-act="edit-banker"][data-id="b1"]');
    await p.click('button[data-act="edit-banker"][data-id="b1"]'); await p.waitForSelector("#bankerForm");
    await p.fill("#n_text", "Called about Q1"); await p.click('button[data-act="add-note"]'); await p.waitForTimeout(200);
    await p.fill("#b_context", "Very warm"); await p.click('.drawer-f button[data-act="save-banker"]'); await p.waitForTimeout(150);
    const b = await doc(p,"bankers","b1");
    check("note's last contact kept and my edit saved, no self-conflict", b.lastContact === (await p.evaluate(()=>TODAY())), b);
    check("context saved, drawer closed", b.context === "Very warm" && !(await drawerOpen(p)));
    check("no page errors", p.errors.length === 0, p.errors);
    await p.close(); }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); if(fail){ console.log("Failed: " + failures.join("; ")); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
