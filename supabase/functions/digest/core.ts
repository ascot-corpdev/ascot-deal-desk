// Weekly digest: what needs attention in the deal tracker. Pure functions, no I/O, so they can be tested.
// The rules match the website: active stages, overdue next steps, deals stalled for 30 days,
// and bankers not contacted in 90 days.

export type Doc = Record<string, unknown> & { id: string };
export type HistoryRow = { tbl: string; record_id: string; op: string; changes: Record<string, any>; changed_at: string };

const ACTIVE = ["Screening", "NDA signed", "LOI", "Diligence"];
const STAGE_ALIAS: Record<string, string> = { IOI: "LOI", Signed: "Closed" };
const STALL_DAYS = 30;
const DAY = 86_400_000;

const stageOf = (d: Doc) => { const s = String(d.stage ?? ""); return STAGE_ALIAS[s] ?? s; };
const isActive = (d: Doc) => ACTIVE.includes(stageOf(d));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / DAY);
// The year only when it isn't this year, so an old contact never reads as recent
const fmtDate = (s: string) => { const d = new Date(s + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC", ...(d.getUTCFullYear() !== new Date().getUTCFullYear() ? { year: "numeric" as const } : {}) }); };
const money = (v: unknown) => {
  if (v === "" || v == null || isNaN(Number(v))) return "n/d";
  const n = Number(v); if (n === 0) return "$0M";
  return "$" + (Math.abs(n) < 10 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US")) + "M";
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export type Digest = {
  subject: string;
  text: string;
  html: string;
  counts: { active: number; overdue: number; stalled: number; dueThisWeek: number; coldBankers: number; changes: number };
};

export function buildDigest(input: {
  deals: Doc[]; bankers: Doc[]; notes: Doc[]; history?: HistoryRow[] | null; now: number; siteUrl?: string;
}): Digest {
  const { deals, bankers, notes, now } = input;
  const today = iso(now);
  const site = (input.siteUrl ?? "").replace(/\/+$/, "");
  const link = (kind: string, id: string) => (site ? `${site}/#${kind}/${encodeURIComponent(id)}` : "");

  const lastNote: Record<string, number> = {};
  for (const n of notes) {
    if (n.kind === "Question") continue;   // a CEO question isn't deal activity; Corp Dev's answer is
    const k = n.dealId ? "d:" + n.dealId : n.bankerId ? "b:" + n.bankerId : "";
    if (k) lastNote[k] = Math.max(lastNote[k] ?? 0, Number(n.createdAt) || 0);
  }
  const lastActivity = (d: Doc) => Math.max(Number(d.updatedAt) || 0, Number(d.createdAt) > 1e11 ? Number(d.createdAt) : 0, lastNote["d:" + d.id] ?? 0);

  const active = deals.filter(isActive);
  const ev = active.reduce((t, d) => t + (Number(d.ev) || 0), 0);
  const overdue = active.filter((d) => d.nextStepDate && daysBetween(today, String(d.nextStepDate)) < 0)
    .sort((a, b) => String(a.nextStepDate).localeCompare(String(b.nextStepDate)));
  const stalled = active.filter((d) => { const la = lastActivity(d); return la > 0 && Math.floor((now - la) / DAY) >= STALL_DAYS; })
    .sort((a, b) => lastActivity(a) - lastActivity(b));
  const dueThisWeek = active.filter((d) => { if (!d.nextStepDate) return false; const n = daysBetween(today, String(d.nextStepDate)); return n >= 0 && n <= 7; })
    .sort((a, b) => String(a.nextStepDate).localeCompare(String(b.nextStepDate)));
  const cold = bankers.filter((b) => !b.lastContact || daysBetween(String(b.lastContact), today) > 90)
    .sort((a, b) => String(a.lastContact ?? "").localeCompare(String(b.lastContact ?? "")));

  // What changed in the last 7 days (needs migration 0003; skipped quietly without it)
  const since = now - 7 * DAY;
  const dealName = (id: string, r?: HistoryRow) => {
    const d = deals.find((x) => x.id === id); const ch = r?.changes ?? {};
    return String(d?.codename ?? ch.doc?.codename ?? ch.codename?.to ?? ch.codename?.from ?? "A deleted deal");
  };
  const changes: string[] = [];
  for (const r of (input.history ?? []).filter((r) => r.tbl === "deals" && Date.parse(r.changed_at) >= since)) {
    const n = dealName(r.record_id, r);
    if (r.op === "insert") changes.push(`New deal: ${n}`);
    else if (r.op === "delete") changes.push(`${n} deleted`);
    else if (r.changes?.stage) {
      const f = STAGE_ALIAS[r.changes.stage.from] ?? r.changes.stage.from, t = STAGE_ALIAS[r.changes.stage.to] ?? r.changes.stage.to;
      if (f !== t) changes.push(`${n} moved ${f ?? "n/d"} to ${t ?? "n/d"}`);
    }
  }

  const counts = { active: active.length, overdue: overdue.length, stalled: stalled.length, dueThisWeek: dueThisWeek.length, coldBankers: cold.length, changes: changes.length };
  const attention = overdue.length + stalled.length;
  const subject = `Deal desk weekly: ${active.length} active deal${active.length === 1 ? "" : "s"}` +
    (attention ? `, ${overdue.length} overdue, ${stalled.length} stalled` : ", nothing overdue or stalled");

  type Item = { text: string; href?: string };
  const sections: { title: string; items: Item[]; empty: string }[] = [
    { title: "Overdue next steps", empty: "None.", items: overdue.map((d) => ({ text: `${d.codename}: ${d.nextStep || "next step not set"} (due ${fmtDate(String(d.nextStepDate))}, ${stageOf(d)})`, href: link("deal", d.id) })) },
    { title: `Stalled: no update or note in ${STALL_DAYS} days`, empty: "None.", items: stalled.map((d) => ({ text: `${d.codename} (${stageOf(d)}): quiet for ${Math.floor((now - lastActivity(d)) / DAY)} days`, href: link("deal", d.id) })) },
    { title: "Next steps due this week", empty: "None.", items: dueThisWeek.map((d) => ({ text: `${fmtDate(String(d.nextStepDate))}: ${d.codename}, ${d.nextStep || "next step not set"}`, href: link("deal", d.id) })) },
    { title: "Bankers not contacted in 90 days", empty: "None.", items: cold.slice(0, 15).map((b) => ({ text: `${b.name}${b.firm ? ` (${b.firm})` : ""}: last contact ${b.lastContact ? fmtDate(String(b.lastContact)) : "not recorded"}`, href: link("banker", b.id) })) },
  ];
  if (input.history) sections.push({ title: "What changed in the last 7 days", empty: "No changes.", items: changes.slice(0, 15).map((t) => ({ text: t })) });

  const headline = `${active.length} active deal${active.length === 1 ? "" : "s"}, ${money(ev)} pipeline EV (derived).`;
  const text = [
    `Deal desk weekly, ${fmtDate(today)}`, headline, "",
    ...sections.flatMap((s) => [s.title, ...(s.items.length ? s.items.map((i) => `- ${i.text}${i.href ? ` ${i.href}` : ""}`) : [`- ${s.empty}`]), ""]),
    site ? `Open the tracker: ${site}` : "",
    "Confidential: corporate development use only.",
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#FFFFFF;font-family:Arial,Helvetica,sans-serif;color:#262166">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:6px;background:#EB008C"></td></tr></table>
<div style="max-width:640px;margin:0 auto;padding:20px 16px">
<div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase">Corporate development</div>
<h1 style="margin:4px 0 6px;font-size:22px;font-weight:normal;color:#EB008C">Deal desk weekly, ${esc(fmtDate(today))}</h1>
<p style="margin:0 0 18px;font-size:14px">${esc(headline)}</p>
${sections.map((s) => `<h2 style="margin:18px 0 6px;font-size:15px;color:#262166;border-bottom:1px solid #D9DCE6;padding-bottom:4px">${esc(s.title)}</h2>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5">${s.items.length ? s.items.map((i) => `<li>${i.href ? `<a href="${esc(i.href)}" style="color:#00539E">${esc(i.text)}</a>` : esc(i.text)}</li>`).join("") : `<li style="color:#666666">${esc(s.empty)}</li>`}</ul>`).join("\n")}
${site ? `<p style="margin:22px 0 0"><a href="${esc(site)}" style="display:inline-block;background:#262166;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:9px 16px">Open the tracker</a></p>` : ""}
<p style="margin:22px 0 0;font-size:11px;color:#666666">Confidential: corporate development use only. Sent by the deal desk weekly digest.</p>
</div></body></html>`;

  return { subject, text, html, counts };
}
