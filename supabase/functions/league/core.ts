// League table data: pure helpers for the league function (no network). The page does the ranking, so it can
// switch between buy-side, sell-side, banks only or all advisors without asking Kensho again.

export const MAX_COMPANIES = 40;
export const MAX_DEALS = 400;

/** Tickers (or other Kensho identifiers): trimmed, upper-cased, de-duplicated, 1 to MAX_COMPANIES. */
export function cleanCompanies(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = [...new Set(input.map((t) => String(t).trim().toUpperCase()).filter(Boolean))];
  if (!out.length || out.length > MAX_COMPANIES || out.some((t) => !/^[A-Z0-9][A-Z0-9:._-]{0,24}$/.test(t))) return null;
  return out;
}

export function cleanYears(v: unknown): number | null {
  if (v === undefined || v === null) return 3;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** The first day of the window: the same calendar day `years` ago (UTC), as YYYY-MM-DD. */
export function sinceDate(now: number, years: number): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// ---- Kensho shapes (kensho-kfinance 11: mergers/{company_id}/{start}/{end} and POST mergers/info)
export type MergerSummary = { transaction_id: number | string; status?: string; start_date?: string | null; closed_date?: string | null; target?: string; buyers?: string[] };
export type MergersResp = { target?: MergerSummary[]; buyer?: MergerSummary[]; seller?: MergerSummary[] };
type AdvisorIn = { advisor_company_id?: number | string; advisor_company_name?: string; advisor_type_name?: string | null; advisor_fee_amount?: string | number | null; advisor_fee_currency?: string | null };
type ParticipantIn = { company_id?: number | string; company_name?: string; advisors?: AdvisorIn[] | null };
export type MergerInfo = {
  timeline?: { status: string; date: string }[];
  participants?: { target?: ParticipantIn; buyers?: ParticipantIn[]; sellers?: ParticipantIn[] };
  consideration?: { currency_name?: string | null; current_calculated_gross_total_transaction_value?: string | number | null; presentation_gross_total_transaction_value?: string | number | null } | null;
  error?: string;
};

export type Advisor = { name: string; type: string; side: "buy" | "sell"; client: string };
export type Deal = { id: string; announced: string | null; closed: string | null; status: string; target: string; buyers: string[]; sellers: string[];
  valueM: number | null; currency: string | null; via: string[]; advisors: Advisor[] };

export const isDead = (status: string | undefined) => /cancel|withdraw|terminat|lapsed/i.test(status || "");

/** Transactions from each company's list, de-duplicated, still live, started on or after `since` (or with no
    start date but closed since), newest first, at most MAX_DEALS. Remembers which companies each came from. */
export function pickDeals(lists: { ticker: string; resp: MergersResp | null }[], since: string) {
  const byId = new Map<string, { s: MergerSummary; via: string[] }>();
  for (const { ticker, resp } of lists) {
    for (const role of ["target", "buyer", "seller"] as const) for (const s of resp?.[role] ?? []) {
      const id = String(s.transaction_id);
      if (isDead(s.status)) continue;
      const when = s.start_date || s.closed_date || "";
      if (!when || when < since) continue;
      const hit = byId.get(id);
      if (hit) { if (!hit.via.includes(ticker)) hit.via.push(ticker); } else byId.set(id, { s, via: [ticker] });
    }
  }
  const all = [...byId.entries()].sort((a, b) => String(b[1].s.start_date || b[1].s.closed_date).localeCompare(String(a[1].s.start_date || a[1].s.closed_date)));
  return { picked: all.slice(0, MAX_DEALS), dropped: Math.max(0, all.length - MAX_DEALS) };
}

const num = (v: unknown) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return isFinite(n) ? n : null; };

/** One deal for the page: dates, parties, value in millions (of the deal's currency) and every advisor with
    their side: advisors to the buyers are buy-side; advisors to the target or the sellers are sell-side. */
export function toDeal(id: string, info: MergerInfo, summary: MergerSummary, via: string[]): Deal {
  const tl = info.timeline ?? [];
  const at = (re: RegExp) => tl.find((t) => re.test(t.status))?.date ?? null;
  const p = info.participants ?? {};
  const advisors: Advisor[] = [];
  const add = (who: ParticipantIn | undefined, side: "buy" | "sell") => {
    for (const a of who?.advisors ?? []) {
      if (!a?.advisor_company_name) continue;
      advisors.push({ name: a.advisor_company_name, type: a.advisor_type_name || "Advisor", side, client: who?.company_name || "" });
    }
  };
  for (const b of p.buyers ?? []) add(b, "buy");
  add(p.target, "sell");
  for (const s of p.sellers ?? []) add(s, "sell");
  const c = info.consideration ?? null;
  const raw = num(c?.presentation_gross_total_transaction_value) ?? num(c?.current_calculated_gross_total_transaction_value);
  return {
    id,
    announced: at(/announc/i) ?? summary.start_date ?? null,
    closed: at(/clos|complet/i) ?? summary.closed_date ?? null,
    status: summary.status || (tl.length ? tl[tl.length - 1].status : ""),
    target: p.target?.company_name || summary.target || "",
    buyers: (p.buyers ?? []).map((b) => b.company_name || "").filter(Boolean),
    sellers: (p.sellers ?? []).map((s) => s.company_name || "").filter(Boolean),
    valueM: raw === null || raw <= 0 ? null : Math.round(raw / 1e5) / 10,
    currency: raw === null || raw <= 0 ? null : (c?.currency_name || null),
    via,
    advisors,
  };
}
