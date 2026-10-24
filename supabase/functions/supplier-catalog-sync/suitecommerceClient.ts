// supabase/functions/supplier-catalog-sync/baywaClient.ts
// Client BayWa r.e. (solarshop.baywa-re.fr, NetSuite SuiteCommerce) : connexion avec les identifiants du compte
// de l'org, puis pagination de l'API catalogue `/api/items` avec la session obtenue. Produit un relevé de la
// MÊME forme que scripts/catalogue/dump-baywa.browser.js, consommé par l'adaptateur pur _shared/catalogue/baywa.js.
// Les fonctions pures (parseLoginResponse, buildItemsUrl, itemDepuisApi, cookies) sont testées dans
// baywaClient.test.ts ; connecterBaywa / releverCatalogueBaywa font les appels réseau.
//
// Si BayWa refuse la connexion serveur (403 Akamai, HTML au lieu de JSON), l'erreur `acces_bloque` remonte
// telle quelle : on NE contourne PAS une protection anti-robot, le repli est le relevé depuis le navigateur.

export const BAYWA_SITE = "https://solarshop.baywa-re.fr";
const LOGIN_PAGE = "/sca-lux-2019-2/checkout.ssp?is=login&login=T";
const LOGIN_SERVICE = "/sca-lux-2019-2/services/Account.Login.Service.ss";
const PAGE = 100;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Majordhome-catalogue/1.0";

export type CodeErreurBaywa = "acces_bloque" | "connexion_refusee" | "releve_incomplet";

export class BaywaError extends Error {
  code: CodeErreurBaywa;
  detail?: string;
  constructor(code: CodeErreurBaywa, detail?: string) {
    super(code + (detail ? `: ${detail}` : ""));
    this.code = code;
    this.detail = detail;
  }
}

export interface ReleveBaywa {
  source: string;
  fetched_at: string;
  total: number;
  items: Array<Record<string, unknown>>;
}

/** Interprète la réponse du service de connexion : null = connecté, sinon le code d'erreur. */
export function parseLoginResponse(status: number, contentType: string | null, body: string): CodeErreurBaywa | null {
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
export function buildItemsUrl(offset: number): string {
  const p = new URLSearchParams({
    language: "fr", currency: "EUR", c: "6376560", sitepath: "/sca-lux-2019-2/searchApi.ssp", use_pcv: "T",
    fieldset: "search", n: "4", custitem_frsy_purchasable_component: "false", country: "FR", q: "",
    limit: String(PAGE), offset: String(offset),
  });
  return `${BAYWA_SITE}/api/items?${p.toString()}`;
}

/** Un article de l'API → la forme du relevé navigateur (fields = custitem_webshopjson parsé, docs FR/EN). */
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
    storedescription: it.storedescription, urlcomponent: it.urlcomponent, itemtype: it.itemtype,
    price: it.onlinecustomerprice, price_detail: it.onlinecustomerprice_detail, ispurchasable: it.ispurchasable,
    isbackorderable: it.isbackorderable, quantityavailable: it.quantityavailable,
    noprice_visible: it.custitem_frsy_noprice_visible, requiredsalesunit: it.custitem_frsy_requiredsalesunit,
    recommendedsalesunit: it.custitem_recommendedsalesunit, fields: (ws?.fields as Record<string, unknown> | undefined) ?? null, docs,
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

function setCookiesDe(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const one = res.headers.get("set-cookie");
  return one ? [one] : [];
}

/** Connexion au compte BayWa : renvoie le pot de cookies de la session. Lève BaywaError(acces_bloque | connexion_refusee). */
export async function connecterBaywa(creds: { email: string; password: string }): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const page = await fetch(BAYWA_SITE + LOGIN_PAGE, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "manual" });
  fusionnerCookies(jar, setCookiesDe(page));
  await page.text();
  if (page.status === 403) throw new BaywaError("acces_bloque", `page de connexion : HTTP ${page.status}`);

  const res = await fetch(BAYWA_SITE + LOGIN_SERVICE, {
    method: "POST",
    headers: {
      "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json",
      "X-SC-Touchpoint": "checkout", Cookie: enteteCookie(jar), Origin: BAYWA_SITE, Referer: BAYWA_SITE + LOGIN_PAGE,
    },
    body: JSON.stringify({ email: creds.email, password: creds.password, redirect: "true" }),
    redirect: "manual",
  });
  fusionnerCookies(jar, setCookiesDe(res));
  const body = await res.text();
  const code = parseLoginResponse(res.status, res.headers.get("content-type"), body);
  if (code) throw new BaywaError(code, `HTTP ${res.status}`);
  return jar;
}

/**
 * Interprète une page de l'API catalogue : HTML = accès bloqué ; statut non 2xx ou JSON illisible = relevé
 * incomplet (rien ne sera écrit). Jamais d'exception brute.
 */
export function parseItemsBody(status: number, contentType: string | null, body: string, offset: number): { total: number; items: Array<Record<string, unknown>> } {
  const ct = (contentType || "").toLowerCase();
  if (status === 403 || ct.includes("text/html") || /^\s*<(!doctype|html)/i.test(body)) {
    throw new BaywaError("acces_bloque", `catalogue : HTTP ${status} offset ${offset}`);
  }
  if (status < 200 || status >= 300) throw new BaywaError("releve_incomplet", `catalogue : HTTP ${status} offset ${offset}`);
  let j: { total?: number; items?: Array<Record<string, unknown>> };
  try { j = JSON.parse(body); } catch { throw new BaywaError("releve_incomplet", `catalogue : réponse illisible offset ${offset}`); }
  if (!j || typeof j !== "object") throw new BaywaError("releve_incomplet", `catalogue : réponse vide offset ${offset}`);
  return { total: Number(j.total) || 0, items: Array.isArray(j.items) ? j.items : [] };
}

/** Pagine l'API catalogue avec la session. Lève BaywaError(acces_bloque | releve_incomplet). */
export async function releverCatalogueBaywa(jar: Map<string, string>): Promise<ReleveBaywa> {
  const items: Array<Record<string, unknown>> = [];
  let total = 0;
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const res = await fetch(buildItemsUrl(offset), {
      headers: { "User-Agent": UA, Accept: "application/json", Cookie: enteteCookie(jar), "X-SC-Touchpoint": "shopping" },
    });
    fusionnerCookies(jar, setCookiesDe(res));
    const j = parseItemsBody(res.status, res.headers.get("content-type"), await res.text(), offset);
    total = j.total;
    const page = j.items;
    for (const it of page) items.push(itemDepuisApi(it));
    if (page.length < PAGE || items.length >= total) break;
  }
  if (!items.length || items.length < total) throw new BaywaError("releve_incomplet", `${items.length} / ${total}`);
  const sansPrix = items.filter((i) => typeof i.price !== "number").length;
  if (sansPrix > items.length / 2) throw new BaywaError("connexion_refusee", `${sansPrix} articles sans prix : session non reconnue`);
  return { source: `${BAYWA_SITE}/api/items (session serveur)`, fetched_at: new Date().toISOString(), total, items };
}
