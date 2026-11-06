// Banker import from a pasted table (made-up names: tests/fixtures/banker-list.tsv), firm grouping, logos for long firm names.
const OUTDIR=require("path").join(__dirname,"../out"); require("fs").mkdirSync(OUTDIR,{recursive:true});
const { chromium } = require("playwright"); const fs=require("fs");
const WEB=require("path").join(__dirname,"../../web"); const MOCK=fs.readFileSync(__dirname+"/mock-supabase.js","utf8"); const BASE="http://localhost:8123/";
let pass=0, fail=0; const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log("FAIL "+n+"  "+JSON.stringify(x)); } };
const T=[["Firm","People","What the emails were about"],
["Goldman Sachs","Avery Ashdown, Blake Bramley, Casey Calder, Dana Dunmore, Ellis Elstow, Finley Fairley, Gray Garnett, Harper Halloway","Project Alder, Project Birch, Target A discussion"],
["Deutsche Bank","Indy Inglis, Jordan Jessop, Kendall Kirkby, Logan Larkin, Marlow Mabry, Noel Northam, Oakley Orwell, Parker Pendle, Quinn Quarry","Project Cedarline, Project Dogwood, Target B opportunity"],
["Howden Capital Markets & Advisory","Reese Redfern, Sage Selby, Tatum Thorne, Umber Upton, Vale Varley, Wren Whitlock, Yael Yardley, Zion Ashby, Arden Brockett, Bellamy Carrow, Corin Denholm, Darby Everly","Target C, Project Elmstead, Target D, Target E"],
["Citi","Emery Fenwick, Fallon Gilmore, Greer Hartigan, Hollis Ivers, Islay Jarrow, Jules Kestrel, Keaton Lowther, Lennox Merrion, Merritt Nettle","Project Alder, NDA, meetings"],
["Cavendish","Nico Oxley, Orrin Prescott, Peyton Raeburn","Target H, Project Fernhill, Project Gorse"],
["Evercore","Remy Sowerby, Sutton Tamworth, Teagan Underhill, Vesper Vickery, Winslow Wardle","Project Hazel / Hazel II, discussion of a possible new deal"],
["Ardea Partners","Ash Yelland, Briar Aldous, Cove Benning, Dell Corrigan, Eden Dacre, Fable Elphick, Gale Farrant, Hart Gosling, Ivo Haddon, Joss Ilkley, Kit Jeffery, Hawthorne (last name not shown)","Project Ivywood, \"New Opportunity,\" Birch underwriting call"],
["Reagan Consulting","Moss Lyndon, Nell Marlowe, Odell Neville, Pax Ormond","Target F NDA"],
["Guy Carpenter Capital & Advisory","Rook Purcell, Shay Ramsey, Tam Stannard","Project Dogwood, Project Juniperus, an MGA opportunity"],
["Raymond James","Uri Tremayne, Vaughn Ulverston, Wade Vance, Yarrow Weston","Project Kalmia"],
["RBC Capital Markets","Zeal Yorke, Alder Abbott, Bram Blythe, Cass Cheswick, Drew Darnell, Eli Eskdale","Introductions and meetings; Target A and Target C follow-up"],
["Aon","Fenn Frome, Glen Grantly, Hale Hurst, Ira Ingram","Project Larchmont"],
["Marsh (capital markets / CMA team)","Jem O. Jolley, Kai Kearsley (Tam Stannard and Shay Ramsey also appear at Marsh)","Project Maplewood"],
["KBW","Lyle Langdon, Mace Moffat","Project Nettlebed"],
["J.P. Morgan","Ned Newbold, Ozzie J. Overton","Project Osier"],
["Chardan","Penn Pritchard, Rafe Quaife","Target G data room"],
["PJT Partners","Seth Rowntree","Catch-ups and coffee, plus deal announcements"],
["Wells Fargo","Tobin Sherwin, Ulric Tolley, Vic Uppal","Project Pinecrest investor presentation"]];
const TSV=T.map(r=>r.join("\t")).join("\n");
const seed=[["bankers","bx",{name:"Seth Rowntree",firm:"PJT Partners",relationship:"Strong",lastContact:"2026-10-01"}],
  ["deals","dO",{codename:"Project Alder",stage:"LOI",bankerIds:[]}],["deals","dJ",{codename:"Birch",stage:"Screening",bankerIds:["bx"]}],["deals","dS",{codename:"Larchmont",stage:"Diligence",bankerIds:[]}]];
(async()=>{
  const b=await chromium.launch(); const errs=[];
  async function pg(vp){ const p=await b.newPage({viewport:vp||{width:1440,height:900}}); p.on("pageerror",e=>errs.push(String(e)));
    await p.route("**/*",r=>{const u=r.request().url(); if(/supabase\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:MOCK}); if(/config\.js/.test(u)) return r.fulfill({contentType:"application/javascript",body:'window.DEALDESK_CONFIG={supabaseUrl:"https://a.supabase.co",supabaseAnonKey:"k"};'}); if(u.startsWith(BASE)) return r.fulfill({contentType:"text/html",body:fs.readFileSync(WEB+"/index.html","utf8")}); return r.fulfill({status:404,body:""});});
    await p.addInitScript(s=>{window.__seed=s;},seed); await p.goto(BASE+"#bankers"); await p.waitForTimeout(400); return p; }
  const p=await pg();
  await p.click('button[data-act="import-open"]'); await p.waitForSelector("#importForm");
  await p.fill("#im_text", TSV); await p.fill("#im_last","2026-11-03"); await p.click('button[data-act="im-preview"]'); await p.waitForTimeout(150);
  const sum=(await p.textContent(".imsum")).replace(/\s+/g," ");
  ok("preview counts: 90 new at 17 firms, 1 update (Seth gets the notes)", sum.includes("90 new people at 17 firms") && sum.includes("1 to update"), sum);
  const rows=await p.$$eval(".imtbl tbody tr",tr=>tr.map(r=>[...r.querySelectorAll("td")].map(td=>td.textContent.replace(/\s+/g," ").trim())));
  const find=n=>rows.find(r=>r[1].startsWith(n));
  const full=await p.evaluate(()=>Object.fromEntries(S.drawer.im.people.map(x=>[x.name,x.context])));
  const data=await p.evaluate(()=>Object.fromEntries(S.drawer.im.people.map(x=>[x.name,{firm:x.firm,coverage:x.coverage,status:x.status}])));
  const dealsOf=n=>find(n)[6];
  ok("Hawthorne parsed with note", find("Hawthorne")[1]==="Hawthorne" && full["Hawthorne"].endsWith("Note: last name not shown"), full["Hawthorne"]);
  ok("Marsh firm cleaned, team as coverage", data["Jem O. Jolley"].firm==="Marsh" && data["Jem O. Jolley"].coverage==="capital markets / CMA team", data["Jem O. Jolley"]);
  ok("Marsh parenthetical becomes a note on Kearsley", find("Kai Kearsley")[1]==="Kai Kearsley" && full["Kai Kearsley"].endsWith("Note: Tam Stannard and Shay Ramsey also appear at Marsh"), find("Kai Kearsley"));
  ok("existing PJT contact matched for an update", data["Seth Rowntree"].status==="Update: last contact 3 Nov, notes", data["Seth Rowntree"]);
  ok("deal links from notes", dealsOf("Avery Ashdown")==="Project Alder, Birch" && dealsOf("Emery Fenwick")==="Project Alder" && dealsOf("Fenn Frome")==="Larchmont" && dealsOf("Indy Inglis")==="", [find("Avery Ashdown"),find("Fenn Frome")]);
  ok("quoted text kept", full["Ash Yelland"].includes("New Opportunity"));
  // untick one
  await p.uncheck('.imtbl input[aria-label="Include Hawthorne"]');
  ok("untick updates the button", (await p.textContent("#imSave"))==="Add 89 and update 1");
  await p.click("#imSave"); await p.waitForTimeout(500);
  const st=await p.evaluate(()=>{ const B=Object.values(window.__mock.store.bankers).map(r=>r.doc); return {n:B.length, firms:[...new Set(B.map(x=>x.firm))].length, benson:B.some(x=>x.name==="Hawthorne"), sample:B.find(x=>x.name==="Avery Ashdown"), otter:window.__mock.doc("deals","dO").bankerIds.length, juniper:window.__mock.doc("deals","dJ").bankerIds.length, inserts:window.__mock.log.filter(l=>l.op==="insert").map(l=>l.n)}; });
  ok("saved 89 people (plus 1 existing) in one insert", st.n===90 && JSON.stringify(st.inserts)==="[89]" && !st.benson, st);
  ok("person record", st.sample.firm==="Goldman Sachs" && st.sample.relationship==="Active" && st.sample.lastContact==="2026-11-03" && st.sample.context==="What the emails were about: Project Alder, Project Birch, Target A discussion", st.sample);
  ok("deals linked: Alder gets GS + Citi (17), Birch keeps its banker and adds GS + Ardea (1+8+11)", st.otter===17 && st.juniper===20, st);
  ok("toast", ((await p.textContent("#toastRoot"))||"").includes("Added 89 bankers and updated 1"));
  // grouped view
  const groups=await p.$$eval("tr.firmrow .t1",x=>x.map(e=>e.textContent));
  ok("one header per firm, alphabetical", groups.length===18 && groups[0]==="Aon" && groups.includes("Howden Capital Markets & Advisory") && groups.includes("Marsh"), groups);
  const gs=(await p.textContent('tr.firmrow:has(.t1:text-is("Goldman Sachs"))')).replace(/\s+/g," ");
  ok("firm header summary", gs.includes("8 people") && gs.includes("2 live mandates") && gs.includes("Last contact 3 Nov (Avery Ashdown)"), gs);
  const cells=await p.$$eval('tr.firmrow:has(.t1:text-is("Goldman Sachs")) td',t=>t.map(x=>x.textContent.replace(/\s+/g," ").trim()));
  ok("firm row: deals aggregated once each, in their column", cells[3]==="Project Alder (LOI)Birch (Screening)" || cells[3]==="Project Alder (LOI) Birch (Screening)", cells[3]);
  ok("firm row: last contact column shows the latest and who", cells[4]==="3 NovAvery Ashdown" || cells[4]==="3 Nov Avery Ashdown", cells[4]);
  const ar=await p.$$eval('tr.firmrow:has(.t1:text-is("Ardea Partners")) td',t=>t.map(x=>x.textContent.replace(/\s+/g," ").trim()));
  ok("firm row: Ardea shows Birch from 11 people, once", (ar[3].match(/Birch/g)||[]).length===1, ar[3]);
  ok("firm row: no deals reads None yet", ((await p.$$eval('tr.firmrow:has(.t1:text-is("Chardan")) td',t=>t[3].textContent.trim())))==="None yet");
  // ---- folding
  ok("90 people: firms start collapsed", (await p.$$("tr.inrow")).length===0 && (await p.$$("tr.firmrow")).length===18);
  ok("collapsed header previews names", ((await p.textContent('tr.firmrow:has(.t1:text-is("KBW")) .who-list'))||"").trim()==="Lyle Langdon, Mace Moffat");
  ok("Goldman preview says how many more", ((await p.textContent('tr.firmrow:has(.t1:text-is("Goldman Sachs")) .who-list'))||"").includes("and 5 more"));
  await p.click('tr.firmrow:has(.t1:text-is("Aon")) .t2 >> nth=0'); await p.waitForTimeout(100);
  ok("clicking a firm row opens it", (await p.$$("tr.inrow")).length===4 && (await p.getAttribute('.fold[data-k="aon"]',"aria-expanded"))==="true");
  await p.focus('.fold[data-k="aon"]'); await p.keyboard.press("Enter"); await p.waitForTimeout(100);
  ok("keyboard toggles it closed, focus stays on the toggle", (await p.$$("tr.inrow")).length===0 && (await p.evaluate(()=>document.activeElement.dataset.k))==="aon");
  await p.fill("#bq","langdon"); await p.waitForTimeout(100);
  ok("search opens matching firms", (await p.$$("tr.inrow")).length===1 && (await p.$$("tr.firmrow")).length===1);
  await p.fill("#bq",""); await p.waitForTimeout(100);
  ok("clearing search folds back", (await p.$$("tr.inrow")).length===0);
  await p.evaluate(()=>{ location.hash="#banker/"+Object.values(window.__mock.store.bankers).find(r=>r.doc.name==="Mace Moffat").id; }); await p.waitForTimeout(300);
  ok("opening a banker by link opens their firm", await p.isVisible("#bankerForm") && (await p.getAttribute('.fold[data-k="kbw"]',"aria-expanded"))==="true");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("focus returns to that banker's row", (await p.evaluate(()=>document.activeElement&&document.activeElement.closest("tr")&&document.activeElement.closest("tr").textContent.includes("Mace Moffat"))));
  ok("choice saved in this browser", JSON.parse(await p.evaluate(()=>localStorage.getItem("dealdesk.bankerFolds"))).kbw===true);
  await p.evaluate(()=>{ S.bfold=null; render(); }); await p.waitForTimeout(150);   // re-read from storage, as after a reload
  ok("open firms remembered after reload", (await p.getAttribute('.fold[data-k="kbw"]',"aria-expanded"))==="true" && (await p.getAttribute('.fold[data-k="aon"]',"aria-expanded"))==="false");
  ok("Expand all offered", ((await p.textContent('button[data-act="fold-all"]'))||"")==="Expand all");
  await p.click('button[data-act="fold-all"]'); await p.waitForTimeout(150);
  ok("Expand all shows all 90", (await p.$$("tr.inrow")).length===90 && ((await p.textContent('button[data-act="fold-all"]'))||"")==="Collapse all");
  const logos=await p.evaluate(()=>["Howden Capital Markets & Advisory","Guy Carpenter Capital & Advisory","Marsh","Cavendish","Chardan","J.P. Morgan","RBC Capital Markets","Ardea Partners"].map(f=>domainOf({firm:f})));
  ok("logos for long firm names", ["howdengroup.com","guycarp.com","marsh.com","cavendish.com","chardan.com","jpmorgan.com","rbccm.com","ardeapartners.com"].every(d=>logos.includes(d)), logos);
  ok("people rows have no repeated logo", (await p.$$("tr.inrow .logo")).length===0);
  await p.click('tr.firmrow:has(.t1:text-is("KBW")) button[data-act="new-banker"]'); await p.waitForSelector("#bankerForm");
  ok("Add person doesn't toggle the firm", (await p.getAttribute('.fold[data-k="kbw"]',"aria-expanded"))==="true");
  ok("Add person pre-fills the firm", (await p.inputValue("#b_firm"))==="KBW"); await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  await p.click('button[data-act="bgroup"]'); await p.waitForTimeout(100);
  ok("toggle off: flat list with logos", (await p.$$("tr.firmrow")).length===0 && (await p.$$("tbody tr .logo")).length===90);
  await p.click('button[data-act="bgroup"]'); await p.waitForTimeout(100);
  // colleagues in the drawer
  await p.click('tr[data-id] >> text="Rook Purcell"'); await p.waitForSelector("#bankerForm");
  const col=(await p.textContent(".colleagues")).replace(/\s+/g," ");
  ok("others at the firm", col.includes("Shay Ramsey") && col.includes("Tam Stannard"), col);
  await p.click('.colleagues a:text-is("Shay Ramsey")'); await p.waitForTimeout(300);
  ok("clicking a colleague opens them", (await p.inputValue("#b_name"))==="Shay Ramsey");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  ok("Esc after a colleague link closes the drawer", !(await p.isVisible("#drawerRoot aside")) && (await p.evaluate(()=>location.hash))==="#bankers", await p.evaluate(()=>location.hash));
  await p.screenshot({path:OUTDIR+"/imp-grouped.png"});
  // re-import is idempotent
  await p.click('button[data-act="import-open"]'); await p.fill("#im_text", TSV); await p.click('button[data-act="im-preview"]'); await p.waitForTimeout(100);
  ok("re-import finds everyone already there except Hawthorne", ((await p.textContent(".imsum"))||"").replace(/\s+/g," ").includes("1 new person at 1 firm0 to update"), await p.textContent(".imsum"));
  await p.keyboard.press("Escape");
  // errors
  await p.click('button[data-act="import-open"]'); await p.fill("#im_text","Firm\tTopic\nAon\tx"); await p.click('button[data-act="im-preview"]'); await p.waitForTimeout(100);
  ok("clear error without a name column", ((await p.textContent("#imPreview"))||"").includes("Add a Name column") && await p.isDisabled("#imSave"));
  await p.fill("#im_text",'Name,Firm,Email,Last contact\n"Lee, Ann",Marsh,ann@marsh.com,2026-10-02'); await p.click('button[data-act="im-preview"]'); await p.waitForTimeout(100);
  const r1=await p.$$eval(".imtbl tbody tr td",t=>t.map(x=>x.textContent.trim()));
  ok("CSV with quotes, one per row", r1[1]==="Lee, Ann" && r1[2]==="Marsh" && r1[3]==="ann@marsh.com", r1);
  await p.keyboard.press("Escape");
  // phone layout
  await p.setViewportSize({width:390,height:800}); await p.waitForTimeout(150);
  ok("phone: no sideways scroll", (await p.evaluate(()=>document.documentElement.scrollWidth))<=390);
  await p.screenshot({path:OUTDIR+"/imp-phone.png"});
  ok("no page errors", errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
