// Minimal Kensho (kfinance) API client, following Kensho's own Python client (kensho-kfinance 11):
//   refresh token: POST https://kfinance.kensho.com/oauth2/refresh {"refresh_token"} -> {"access_token"}
//   key pair:      RS256 JWT assertion -> POST https://kensho.okta.com/oauth2/default/v1/token (client_credentials)
//   data:          https://kfinance.kensho.com/api/v1/... with "Authorization: Bearer <access token>"

export const API_HOST = "https://kfinance.kensho.com";
export const OKTA_HOST = "https://kensho.okta.com";
const API = `${API_HOST}/api/v1/`;
const UA = "ascot-deal-desk/1 (+supabase function comps)";

export type Creds = { refreshToken?: string; clientId?: string; privateKey?: string; keyId?: string };
type Fetch = typeof fetch;

const b64url = (b: Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b;
  let s = ""; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function signJwt(clientId: string, pem: string, kid: string | undefined, now: number): Promise<string> {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) throw new Error("KENSHO_PRIVATE_KEY is in PKCS#1 format; convert it to PKCS#8 (BEGIN PRIVATE KEY), see README");
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", ...(kid ? { kid } : {}) }));
  const body = b64url(JSON.stringify({ aud: `${OKTA_HOST}/oauth2/default/v1/token`, exp: iat + 3600, iat, sub: clientId, iss: clientId }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

export class Kensho {
  private token: { value: string; until: number } | null = null;
  constructor(private creds: Creds, private f: Fetch = fetch, private clock: () => number = Date.now) {}

  static configured(c: Creds) { return !!(c.refreshToken || (c.clientId && c.privateKey)); }

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.until > this.clock()) return this.token.value;
    let res: Response;
    if (this.creds.refreshToken) {
      res = await this.f(`${API_HOST}/oauth2/refresh`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ refresh_token: this.creds.refreshToken }) });
    } else {
      const assertion = await signJwt(this.creds.clientId!, this.creds.privateKey!, this.creds.keyId, this.clock());
      res = await this.f(`${OKTA_HOST}/oauth2/default/v1/token`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ scope: "kensho:app:kfinance", grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion }),
      });
    }
    if (!res.ok) throw new KenshoError(`Kensho sign-in failed (${res.status})`, res.status, true);
    const value = (await res.json()).access_token;
    if (!value) throw new KenshoError("Kensho sign-in returned no access token", 502, true);
    this.token = { value, until: this.clock() + 45 * 60_000 };   // tokens last about an hour; renew early
    return value;
  }

  async call<T>(path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(attempt > 0);
      const res = await this.f(API + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": UA },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.status === 401 && attempt === 0) continue;          // token expired early: sign in again once
      if (!res.ok) throw new KenshoError(`Kensho ${path.split("/")[0]} request failed (${res.status}): ${(await res.text()).slice(0, 200)}`, res.status);
      return await res.json() as T;
    }
    throw new KenshoError("Kensho refused the access token", 401, true);
  }
}
export class KenshoError extends Error { constructor(msg: string, public status: number, public auth = false) { super(msg); } }
