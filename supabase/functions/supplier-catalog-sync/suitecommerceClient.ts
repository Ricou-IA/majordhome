// supabase/functions/supplier-catalog-sync/suitecommerceClient.ts
// Client NetSuite SuiteCommerce (BayWa r.e. et tout site compatible) : connexion avec les identifiants du compte de
// l'org, puis pagination de l'API catalogue `/api/items` avec la session obtenue. Paramétré par la ligne
// `suppliers` (site_url + connector_config { sca_path, site_id }) ; les autres constantes (paramètres de l'API items,
// chemins de connexion, en-têtes) restent celles de BayWa, seul site SuiteCommerce connu — assumé (spec tranche 2 § 5).
// Produit un relevé de la MÊME forme que scripts/catalogue/dump-suitecommerce.browser.js, consommé par l'adaptateur
// pur _shared/catalogue/suitecommerce.js. Fonctions pures testées dans suitecommerceClient.test.ts.
//
// Si le site refuse la connexion serveur (403 Akamai, HTML au lieu de JSON), l'erreur `acces_bloque` remonte
// telle quelle : on NE contourne PAS une protection anti-robot, le repli est le relevé depuis le navigateur.

const DEFAUT_SCA_PATH = "/sca-lux-2019-2";
const DEFAUT_SITE_ID = "6376560";
const PAGE = 100;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Majordhome-catalogue/1.0";

export type CodeErreurSuitecommerce = "acces_bloque" | "connexion_refusee" | "releve_incomplet" | "site_absent";

export class SuitecommerceError extends Error {
  code: CodeErreurSuitecommerce;
  detail?: string;
  constructor(code: CodeErreurSuitecommerce, detail?: string) {
    super(code + (detail ? `: ${detail}` : ""));
    this.code = code;
    this.detail = detail;
  }
}

export interface ConfigSuitecommerce { siteUrl: string; scaPath: string; siteId: string }

export interface ReleveSuitecommerce {
  source: string;
  fetched_at: string;
  total: number;
  items: Array<Record<string, unknown>>;
}

/** Configuration depuis la ligne fournisseur ; lève `site_absent` sans site_url. */
export function configSuitecommerce(supplier: { site_url?: string | null; connector_config?: Record<string, unknown> | null }): ConfigSuitecommerce {
  const siteUrl = String(supplier?.site_url || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(siteUrl)) throw new SuitecommerceError("site_absent");
  const cfg = supplier?.connector_config || {};
  const scaPath = String(cfg.sca_path || DEFAUT_SCA_PATH).trim().replace(/\/+$/, "");
  const siteId = String(cfg.site_id || DEFAUT_SITE_ID).trim();
  return { siteUrl, scaPath: scaPath.startsWith("/") ? scaPath : `/${scaPath}`, siteId };
}

/** Interprète la réponse du service de connexion : null = connecté, sinon le code d'erreur. */
export function parseLoginResponse(status: number, contentType: string | null, body: string): CodeErreurSuitecommerce | null {
  const ct = (contentType || "").toLowerCase();
  if (status === 403 || status === 503 || ct.includes("text/html") || /^\s*<(!doctype|html)/i.test(body)) return "acces_bloque";
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(body); } catch { json = null; }
  if (!json || typeof json !== "object") return "connexion_refusee";
  if (status >= 400 || json.errorCode || json.errorStatusCode || json.errorMessage) return "connexion_refusee";
  const user = (json.user && typeof json.user === "object") ? json.user as Record<string, unknown> : json;
  if (user.isLoggedIn === "T" || user.isLoggedIn === true || typeof user.email === "string") return null;
  return "connexion_refusee";
}

/** URL d'une page de l'API catalogue (100 articles). Pas de `pricelevel` : la session connectée fixe le niveau de prix. */
export function buildItemsUrl(cfg: ConfigSuitecommerce, offset: number): string {
  const p = new URLSearchParams({
    language: "fr", currency: "EUR", c: cfg.siteId, sitepath: `${cfg.scaPath}/searchApi.ssp`, use_pcv: "T",
    fieldset: "search", n: "4", custitem_frsy_purchasable_component: "false", country: "FR", q: "",
    limit: String(PAGE), offset: String(offset),
  });
  return `${cfg.siteUrl}/api/items?${p.toString()}`;
}

/** Première URL d'image d'une structure NetSuite imbriquée, ou null. */
function premiereImage(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) { for (const x of v) { const u = premiereImage(x); if (u) return u; } return null; }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.url === "string") return o.url;
    for (const k of Object.keys(o)) { const u = premiereImage(o[k]); if (u) return u; }
  }
  return null;
}

/** Un article de l'API → la forme du relevé navigateur (fields = custitem_webshopjson parsé, docs FR/EN, photo, page). */
export function itemDepuisApi(it: Record<string, unknown>): Record<string, unknown> {
  let ws: Record<string, unknown> | null = null;
  try { ws = typeof it.custitem_webshopjson === "string" ? JSON.parse(it.custitem_webshopjson) : null; } catch { ws = null; }
  const docs: Array<{ type: string; lang: string; url: string }> = [];
  const groupes = (ws?.documents as { documents?: Array<{ name?: string; docs?: Array<{ language?: string; url?: string }> }> } | undefined)?.documents || [];
  for (const g of groupes) {
    for (const x of (g.docs || [])) {
      if ((x.language === "FR" || x.language === "EN") && x.url) docs.push({ type: g.name || "", lang: x.language, url: x.url });
    }
  }
  return {
    internalid: it.internalid, itemid: it.itemid, displayname: it.displayname, storedisplayname2: it.storedisplayname2,
    urlcomponent: it.urlcomponent, itemtype: it.itemtype,
    price: it.onlinecustomerprice, ispurchasable: it.ispurchasable, isbackorderable: it.isbackorderable, quantityavailable: it.quantityavailable,
    itemimages_detail: premiereImage(it.itemimages_detail),
    fields: (ws?.fields as Record<string, unknown> | undefined) ?? null, docs,
  };
}

/** Fusionne des en-têtes Set-Cookie dans le pot (le dernier gagne). */
export function fusionnerCookies(jar: Map<string, string>, setCookies: string[]): void {
  for (const sc of setCookies) {
    const premier = sc.split(";")[0];
    const i = premier.indexOf("=");
    if (i <= 0) continue;
    jar.set(premier.slice(0, i).trim(), premier.slice(i + 1).trim());
  }
}

/** En-tête Cookie depuis le pot. */
export function enteteCookie(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export function setCookiesDe(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const one = res.headers.get("set-cookie");
  return one ? [one] : [];
}

/** Connexion au compte : renvoie le pot de cookies de la session. Lève SuitecommerceError(acces_bloque | connexion_refusee). */
export async function connecterSuitecommerce(cfg: ConfigSuitecommerce, creds: { email: string; password: string }): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const loginPage = `${cfg.siteUrl}${cfg.scaPath}/checkout.ssp?is=login&login=T`;
  const page = await fetch(loginPage, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "manual" });
  fusionnerCookies(jar, setCookiesDe(page));
  await page.text();
  if (page.status === 403) throw new SuitecommerceError("acces_bloque", `page de connexion : HTTP ${page.status}`);

  const res = await fetch(`${cfg.siteUrl}${cfg.scaPath}/services/Account.Login.Service.ss`, {
    method: "POST",
    headers: {
      "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json",
      "X-SC-Touchpoint": "checkout", Cookie: enteteCookie(jar), Origin: cfg.siteUrl, Referer: loginPage,
    },
    body: JSON.stringify({ email: creds.email, password: creds.password, redirect: "true" }),
    redirect: "manual",
  });
  fusionnerCookies(jar, setCookiesDe(res));
  const body = await res.text();
  const code = parseLoginResponse(res.status, res.headers.get("content-type"), body);
  if (code) throw new SuitecommerceError(code, `HTTP ${res.status}`);
  return jar;
}

/**
 * Interprète une page de l'API catalogue : HTML = accès bloqué ; statut non 2xx ou JSON illisible = relevé
 * incomplet (rien ne sera écrit). Jamais d'exception brute.
 */
export function parseItemsBody(status: number, contentType: string | null, body: string, offset: number): { total: number; items: Array<Record<string, unknown>> } {
  const ct = (contentType || "").toLowerCase();
  if (status === 403 || ct.includes("text/html") || /^\s*<(!doctype|html)/i.test(body)) {
    throw new SuitecommerceError("acces_bloque", `catalogue : HTTP ${status} offset ${offset}`);
  }
  if (status < 200 || status >= 300) throw new SuitecommerceError("releve_incomplet", `catalogue : HTTP ${status} offset ${offset}`);
  let j: { total?: number; items?: Array<Record<string, unknown>> };
  try { j = JSON.parse(body); } catch { throw new SuitecommerceError("releve_incomplet", `catalogue : réponse illisible offset ${offset}`); }
  if (!j || typeof j !== "object") throw new SuitecommerceError("releve_incomplet", `catalogue : réponse vide offset ${offset}`);
  return { total: Number(j.total) || 0, items: Array.isArray(j.items) ? j.items : [] };
}

/** Pagine l'API catalogue avec la session. Lève SuitecommerceError(acces_bloque | releve_incomplet | connexion_refusee). */
export async function releverCatalogueSuitecommerce(cfg: ConfigSuitecommerce, jar: Map<string, string>): Promise<ReleveSuitecommerce> {
  const items: Array<Record<string, unknown>> = [];
  let total = 0;
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const res = await fetch(buildItemsUrl(cfg, offset), {
      headers: { "User-Agent": UA, Accept: "application/json", Cookie: enteteCookie(jar), "X-SC-Touchpoint": "shopping" },
    });
    fusionnerCookies(jar, setCookiesDe(res));
    const j = parseItemsBody(res.status, res.headers.get("content-type"), await res.text(), offset);
    total = j.total;
    const page = j.items;
    for (const it of page) items.push(itemDepuisApi(it));
    if (page.length < PAGE || items.length >= total) break;
  }
  if (!items.length || items.length < total) throw new SuitecommerceError("releve_incomplet", `${items.length} / ${total}`);
  const sansPrix = items.filter((i) => typeof i.price !== "number").length;
  if (sansPrix > items.length / 2) throw new SuitecommerceError("connexion_refusee", `${sansPrix} articles sans prix : session non reconnue`);
  return { source: `${cfg.siteUrl}/api/items (session serveur)`, fetched_at: new Date().toISOString(), total, items };
}
