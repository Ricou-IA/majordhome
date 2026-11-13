// supabase/functions/supplier-catalog-sync/woocommerceClient.ts
// Client WooCommerce : connexion par le formulaire wp-login.php puis API Store (`/wp-json/wc/store/v1/products`,
// réservée aux comptes connectés chez un grossiste), paginée par 100, + catégories. Produit un relevé de la MÊME
// forme que scripts/catalogue/dump-woocommerce.browser.js (adaptateur pur _shared/catalogue/woocommerce.js).
// Un site derrière Cloudflare / Turnstile (Domos) répond une page de défi : `acces_bloque`, on ne contourne pas ;
// le relevé se fait alors depuis le navigateur connecté. Fonctions pures testées dans woocommerceClient.test.ts.

import { rayonsDePieces } from "../_shared/catalogue/woocommercePieces.js";

const PAGE = 100;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Majordhome-catalogue/1.0";

export type CodeErreurWoo = "acces_bloque" | "connexion_refusee" | "releve_incomplet" | "site_absent" | "site_non_https" | "site_invalide" | "site_redirige";

export class WooError extends Error {
  code: CodeErreurWoo;
  detail?: string;
  constructor(code: CodeErreurWoo, detail?: string) {
    super(code + (detail ? `: ${detail}` : ""));
    this.code = code;
    this.detail = detail;
  }
}

export interface ReleveWoo {
  source: string;
  fetched_at: string;
  total: number;
  items: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
}

/** Site du fournisseur sans barre finale ; lève `site_absent`. */
export function siteWoo(supplier: { site_url?: string | null }): string {
  const s = String(supplier?.site_url || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(s)) throw new WooError("site_absent");
  return s;
}

export function buildWooProductsUrl(siteUrl: string, page: number): string {
  return `${siteUrl.replace(/\/+$/, "")}/wp-json/wc/store/v1/products?per_page=${PAGE}&page=${page}`;
}

export function buildWooCategoriesUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/wp-json/wc/store/v1/products/categories?per_page=100`;
}

const RE_DEFI = /cf-turnstile|cf-chl|challenge-platform|Checking if the site connection|Un instant…|Just a moment/i;

/** Réponse de wp-login.php : null = connecté (cookie wordpress_logged_in_*), sinon le code d'erreur. */
export function parseWpLoginResponse(status: number, setCookies: string[], body: string): CodeErreurWoo | null {
  if (status === 403 || status === 503 || RE_DEFI.test(body || "")) return "acces_bloque";
  if (setCookies.some((c) => /^wordpress_logged_in_/.test(c.trim()))) return null;
  return "connexion_refusee";
}

/** Entités HTML courantes des libellés WooCommerce. */
export function strip(h: unknown): string {
  return String(h || "").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#8211;|&#8217;|&rsquo;|&amp;|&#8220;|&#8221;/g, (m) => ({ "&nbsp;": " ", "&#8211;": "–", "&#8217;": "’", "&rsquo;": "’", "&amp;": "&", "&#8220;": "“", "&#8221;": "”" })[m] || m)
    .replace(/\s+/g, " ").trim();
}

/** Une page de la Store API : 401 = session non reconnue, HTML = bloqué, JSON = articles réduits à la forme du relevé. */
export function parseWooProductsBody(status: number, contentType: string | null, body: string, totalHeader: string | null, pagesHeader: string | null): { total: number; pages: number; items: Array<Record<string, unknown>> } {
  const ct = (contentType || "").toLowerCase();
  if (status === 403 || ct.includes("text/html") || /^\s*<(!doctype|html)/i.test(body) || RE_DEFI.test(body)) throw new WooError("acces_bloque", `catalogue : HTTP ${status}`);
  if (status === 401) throw new WooError("connexion_refusee", "Store API : authentification requise");
  if (status < 200 || status >= 300) throw new WooError("releve_incomplet", `catalogue : HTTP ${status}`);
  let j: Array<Record<string, unknown>>;
  try { j = JSON.parse(body); } catch { throw new WooError("releve_incomplet", "catalogue : réponse illisible"); }
  if (!Array.isArray(j)) throw new WooError("releve_incomplet", "catalogue : réponse inattendue");
  const items = j.map((p) => ({
    id: p.id, name: strip(p.name), slug: p.slug, sku: p.sku, permalink: p.permalink, type: p.type, parent: p.parent,
    prices: p.prices, on_sale: p.on_sale, is_in_stock: p.is_in_stock, is_purchasable: p.is_purchasable,
    categories: ((p.categories as Array<Record<string, unknown>>) || []).map((c) => ({ id: c.id, name: strip(c.name), slug: c.slug })),
    attributes: ((p.attributes as Array<Record<string, unknown>>) || []).map((a) => ({ name: a.name, terms: ((a.terms as Array<Record<string, unknown>>) || []).map((t) => t.name) })),
    short_description: strip(p.short_description).slice(0, 600),
    image: ((p.images as Array<Record<string, unknown>>) || [])[0]?.src || null,
  }));
  return { total: Number(totalHeader) || items.length, pages: Number(pagesHeader) || 1, items };
}

/** Connexion WordPress par formulaire ; renvoie le pot de cookies. Lève WooError(acces_bloque | connexion_refusee). */
export async function connecterWoocommerce(siteUrl: string, creds: { email: string; password: string }): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const page = await fetch(`${siteUrl}/wp-login.php`, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "manual" });
  for (const c of setCookiesDe(page)) ajouterCookie(jar, c);
  const html = await page.text();
  if (page.status === 403 || page.status === 503 || RE_DEFI.test(html)) throw new WooError("acces_bloque", `wp-login : HTTP ${page.status}`);

  const form = new URLSearchParams({ log: creds.email, pwd: creds.password, rememberme: "forever", "wp-submit": "Se connecter", redirect_to: `${siteUrl}/mon-compte/`, testcookie: "1" });
  const res = await fetch(`${siteUrl}/wp-login.php`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html", Cookie: enteteCookie(jar) + "; wordpress_test_cookie=WP%20Cookie%20check", Origin: siteUrl, Referer: `${siteUrl}/wp-login.php` },
    body: form.toString(),
    redirect: "manual",
  });
  const setCookies = setCookiesDe(res);
  for (const c of setCookies) ajouterCookie(jar, c);
  const code = parseWpLoginResponse(res.status, setCookies, await res.text());
  if (code) throw new WooError(code, `HTTP ${res.status}`);
  return jar;
}

/** Pagine la Store API avec la session, puis les catégories. */
export async function releverCatalogueWoocommerce(siteUrl: string, jar: Map<string, string>): Promise<ReleveWoo> {
  const items: Array<Record<string, unknown>> = [];
  let total = 0;
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(buildWooProductsUrl(siteUrl, page), { headers: { "User-Agent": UA, Accept: "application/json", Cookie: enteteCookie(jar) } });
    const j = parseWooProductsBody(res.status, res.headers.get("content-type"), await res.text(), res.headers.get("x-wp-total"), res.headers.get("x-wp-totalpages"));
    total = j.total;
    items.push(...j.items);
    if (page >= j.pages) break;
  }
  if (!items.length || items.length < total) throw new WooError("releve_incomplet", `${items.length} / ${total}`);
  const rc = await fetch(buildWooCategoriesUrl(siteUrl), { headers: { "User-Agent": UA, Accept: "application/json", Cookie: enteteCookie(jar) } });
  let categories: Array<Record<string, unknown>> = [];
  if (rc.ok) {
    try {
      const c = JSON.parse(await rc.text()) as Array<Record<string, unknown>>;
      categories = c.map((x) => ({ id: x.id, name: strip(x.name), slug: x.slug, parent: x.parent, count: x.count }));
    } catch { categories = []; }
  }
  return { source: `${siteUrl}/wp-json/wc/store/v1/products (session serveur)`, fetched_at: new Date().toISOString(), total, items, categories };
}

// ---------------------------------------------------------------------------------------------------------------
// Boutique PUBLIQUE (catalogue de pièces détachées d'un marchand qui a donné son accord) : même API Store, mais sans
// connexion ni cookie. Garde `description` et `brands` que le relevé groupé ne garde pas, pagine produits ET catégories.
// Rien de partiel : toute page en échec, ou plus de pages que la borne, lève une erreur et AUCUN relevé n'est rendu.
// On ne contourne jamais une protection anti-robot : une page HTML, un 401 ou un 403 = `acces_bloque`, on s'arrête.
// ---------------------------------------------------------------------------------------------------------------

const UA_PUBLIC = "Majordhome-catalogue/1.0 (+Majord'home; releve de pieces detachees avec l'accord du marchand)";
/** Pause entre deux pages (politesse envers le marchand). */
export const PAUSE_PAGES_MS = 400;
/** Borne dure du nombre de pages par ressource (produits, catégories) : au-delà, erreur, jamais un relevé tronqué. */
export const PAGES_MAX = 60;
/** HTML brut gardé par fiche (l'adaptateur le nettoie puis le borne à DESCRIPTION_MAX caractères de texte). */
const HTML_MAX = 400_000;
/** Délai maximal d'une requête (réponse ET corps) : au-delà, le relevé échoue, rien de partiel. */
export const DELAI_REQUETE_MS = 30_000;

/**
 * Adresse d'une boutique PUBLIQUE : https obligatoire, nom de domaine public (au moins un point), ni localhost, ni
 * adresse IP littérale (v4 sous toutes ses écritures, que l'analyseur d'URL normalise, ou v6), ni identifiants dans
 * l'adresse. Renvoie origine + chemin sans barre finale.
 * @throws WooError site_absent | site_non_https | site_invalide
 */
export function siteBoutiquePublique(siteUrl: string): string {
  const brut = String(siteUrl || "").trim();
  if (!/^https?:\/\//i.test(brut)) throw new WooError("site_absent");
  let u: URL;
  try { u = new URL(brut); } catch { throw new WooError("site_invalide", "adresse illisible"); }
  if (u.protocol !== "https:") throw new WooError("site_non_https", brut.slice(0, 120));
  const hote = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!hote) throw new WooError("site_invalide", "hôte vide");
  if (hote === "localhost" || hote.endsWith(".localhost")) throw new WooError("site_invalide", `hôte local (${hote})`);
  if (hote.startsWith("[") || hote.includes(":")) throw new WooError("site_invalide", `adresse IP (${hote})`);
  if (/^\d+(\.\d+){3}$/.test(hote)) throw new WooError("site_invalide", `adresse IP (${hote})`);
  if (!hote.includes(".")) throw new WooError("site_invalide", `pas un nom de domaine (${hote})`);
  if (u.username || u.password) throw new WooError("site_invalide", "identifiants dans l'adresse");
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

export interface OptionsBoutiquePublique {
  pauseMs?: number;
  pagesMax?: number;
  /** Délai par requête en millisecondes (défaut DELAI_REQUETE_MS ; injectable pour les tests). */
  delaiRequeteMs?: number;
  /** Injectable pour les tests (défaut : fetch). */
  fetchFn?: typeof fetch;
  /** Attente injectable pour les tests (défaut : setTimeout). */
  attendre?: (ms: number) => Promise<void>;
}

type PagePublique = { total: number; pages: number; items: Array<Record<string, unknown>> };
type LecturePage = (status: number, contentType: string | null, body: string, totalHeader: string | null, pagesHeader: string | null) => PagePublique;

/**
 * Corps d'une page de la boutique publique : tableau JSON, ou erreur. La détection de page de défi anti-robot ne
 * s'applique qu'à une réponse NON JSON : une réponse JSON valide n'est jamais un défi (une description de fiche peut
 * contenir « Just a moment » ou « Un instant »).
 */
function lireCorps(status: number, contentType: string | null, body: string, quoi: string): Array<Record<string, unknown>> {
  const ct = (contentType || "").toLowerCase();
  if (status === 401 || status === 403 || ct.includes("text/html")) throw new WooError("acces_bloque", `${quoi} : HTTP ${status}`);
  let json: unknown;
  let jsonValide = true;
  try { json = JSON.parse(body); } catch { jsonValide = false; }
  if (!jsonValide && (/^\s*<(!doctype|html)/i.test(body) || RE_DEFI.test(body))) throw new WooError("acces_bloque", `${quoi} : HTTP ${status}`);
  if (status < 200 || status >= 300) throw new WooError("releve_incomplet", `${quoi} : HTTP ${status}`);
  if (!jsonValide) throw new WooError("releve_incomplet", `${quoi} : réponse illisible`);
  if (!Array.isArray(json)) throw new WooError("releve_incomplet", `${quoi} : réponse inattendue`);
  return json as Array<Record<string, unknown>>;
}

/** En-tête de pagination : entier positif ou nul, sinon erreur (jamais de repli : sans lui, on ne sait pas si le relevé est complet). */
function entetePagination(valeur: string | null, nom: string, quoi: string): number {
  const v = (valeur ?? "").trim();
  if (!/^\d{1,9}$/.test(v)) throw new WooError("releve_incomplet", `${quoi} : en-tête de pagination ${nom} absent ou illisible (« ${v.slice(0, 20)} »), relevé abandonné`);
  return Number(v);
}

const texteBrut = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const htmlBrut = (v: unknown) => (typeof v === "string" ? v.slice(0, HTML_MAX) : "");
const liste = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>> : []);

/** Une page de produits de la boutique publique, réduite aux champs que lit l'adaptateur de pièces (description et marque comprises). */
export function parseWooPublicProductsBody(status: number, contentType: string | null, body: string, totalHeader: string | null, pagesHeader: string | null): PagePublique {
  const brut = lireCorps(status, contentType, body, "catalogue");
  const total = entetePagination(totalHeader, "X-WP-Total", "catalogue");
  const pages = entetePagination(pagesHeader, "X-WP-TotalPages", "catalogue");
  const items = liste(brut).map((p) => {
    const prix = (p.prices && typeof p.prices === "object" ? p.prices : {}) as Record<string, unknown>;
    const photo = liste(p.images)[0]?.src;
    return {
      id: p.id, name: texteBrut(p.name), slug: p.slug, sku: p.sku, permalink: p.permalink, type: p.type, parent: p.parent,
      prices: { price: prix.price, currency_minor_unit: prix.currency_minor_unit },
      on_sale: p.on_sale, is_in_stock: p.is_in_stock, is_purchasable: p.is_purchasable,
      categories: liste(p.categories).map((c) => ({ id: c.id, name: texteBrut(c.name), slug: c.slug })),
      brands: liste(p.brands).map((b) => ({ name: texteBrut(b.name) })),
      description: htmlBrut(p.description), short_description: htmlBrut(p.short_description),
      images: typeof photo === "string" && photo ? [{ src: photo }] : [],
    };
  });
  return { total, pages, items };
}

/** Une page de catégories de la boutique publique (avec le parent : l'arbre des rayons de pièces en dépend). */
export function parseWooPublicCategoriesBody(status: number, contentType: string | null, body: string, totalHeader: string | null, pagesHeader: string | null): PagePublique {
  const brut = lireCorps(status, contentType, body, "catégories");
  const total = entetePagination(totalHeader, "X-WP-Total", "catégories");
  const pages = entetePagination(pagesHeader, "X-WP-TotalPages", "catégories");
  const items = liste(brut).map((x) => ({ id: x.id, name: texteBrut(x.name), slug: x.slug, parent: x.parent, count: x.count }));
  return { total, pages, items };
}

/**
 * Relevé de la boutique publique d'un marchand : catégories (toutes les pages), puis les produits des seuls rayons de
 * pièces (toutes les pages). Forme du relevé = celle que lit `piecesDepuisReleveWoocommerce`.
 * Https seulement, aucune redirection suivie (une 3xx = erreur, jamais une requête vers un autre hôte), délai par
 * requête, et le nombre de fiches lues doit être ÉGAL au total annoncé (total ≥ 1, identique sur toutes les pages).
 * @throws WooError site_absent | site_non_https | site_invalide | site_redirige | acces_bloque | releve_incomplet
 */
export async function lireBoutiquePublique(siteUrl: string, opts: OptionsBoutiquePublique = {}): Promise<ReleveWoo> {
  const site = siteBoutiquePublique(siteUrl);
  const delaiMs = opts.delaiRequeteMs ?? DELAI_REQUETE_MS;
  const pauseMs = opts.pauseMs ?? PAUSE_PAGES_MS;
  const pagesMax = opts.pagesMax ?? PAGES_MAX;
  const appel = opts.fetchFn ?? fetch;
  const attendre = opts.attendre ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let premiere = true;

  async function demander(url: string): Promise<{ res: Response; corps: string }> {
    if (!premiere && pauseMs > 0) await attendre(pauseMs);
    premiere = false;
    let res: Response;
    let corps: string;
    try {
      res = await appel(url, { headers: { "User-Agent": UA_PUBLIC, Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(delaiMs) });
      if (estRedirection(res)) {
        await res.body?.cancel().catch(() => {});
        throw new WooError("site_redirige", `le site redirige vers ${hoteDeRedirection(res, url)} : corrigez l'adresse du site`);
      }
      corps = await res.text();
    } catch (e) {
      if (e instanceof WooError) throw e;
      const nom = e instanceof Error || e instanceof DOMException ? (e as Error).name : "";
      if (nom === "TimeoutError" || nom === "AbortError") throw new WooError("releve_incomplet", `délai dépassé (${Math.round(delaiMs / 1000)} s) sur ${new URL(url).pathname}`);
      throw new WooError("releve_incomplet", `réseau : ${e instanceof Error ? e.message : String(e)}`);
    }
    return { res, corps };
  }

  async function toutesLesPages(urlDe: (n: number) => string, lire: LecturePage, quoi: string) {
    const items: Array<Record<string, unknown>> = [];
    let total: number | null = null;
    for (let n = 1; ; n++) {
      const { res, corps } = await demander(urlDe(n));
      const j = lire(res.status, res.headers.get("content-type"), corps, res.headers.get("x-wp-total"), res.headers.get("x-wp-totalpages"));
      if (total !== null && j.total !== total) throw new WooError("releve_incomplet", `${quoi} : total annoncé changé en cours de relevé (${total} puis ${j.total}), relevé abandonné`);
      total = j.total;
      items.push(...j.items);
      if (n >= j.pages) break;
      if (n >= pagesMax) throw new WooError("releve_incomplet", `${quoi} : plus de ${pagesMax} pages (pagesMax), relevé abandonné`);
    }
    if (!total || total < 1) throw new WooError("releve_incomplet", `${quoi} : total annoncé nul`);
    if (items.length !== total) throw new WooError("releve_incomplet", `${quoi} : ${items.length} fiche(s) lue(s) pour un total annoncé de ${total}`);
    return { items, total };
  }

  const racine = `${site}/wp-json/wc/store/v1/products`;
  const categories = await toutesLesPages((n) => `${racine}/categories?per_page=100&page=${n}`, parseWooPublicCategoriesBody, "catégories");
  const rayons = [...rayonsDePieces(categories.items as Array<{ id: number; name?: string; parent?: number }>)].sort((a, b) => a - b);
  if (!rayons.length) throw new WooError("releve_incomplet", "aucun rayon « Pièces détachées » dans les catégories du site");

  const produits = await toutesLesPages((n) => `${racine}?per_page=${PAGE}&page=${n}&category=${rayons.join(",")}`, parseWooPublicProductsBody, "catalogue");
  if (!produits.items.length) throw new WooError("releve_incomplet", "catalogue : aucune fiche dans les rayons de pièces");
  return { source: `${site}/wp-json/wc/store/v1/products (boutique publique)`, fetched_at: new Date().toISOString(), total: produits.total, items: produits.items, categories: categories.items };
}

/** Réponse de redirection (3xx, ou redirection opaque d'un `redirect: "manual"` côté navigateur). */
function estRedirection(res: Response): boolean {
  return (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect";
}

/** Hôte vers lequel le site redirige (pour le message), sinon « une autre adresse ». */
function hoteDeRedirection(res: Response, depuis: string): string {
  const loc = res.headers.get("location");
  if (!loc) return "une autre adresse";
  try { return new URL(loc, depuis).host || "une autre adresse"; } catch { return "une autre adresse"; }
}

function ajouterCookie(jar: Map<string, string>, sc: string) {
  const premier = sc.split(";")[0];
  const i = premier.indexOf("=");
  if (i > 0) jar.set(premier.slice(0, i).trim(), premier.slice(i + 1).trim());
}

function enteteCookie(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function setCookiesDe(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const one = res.headers.get("set-cookie");
  return one ? [one] : [];
}
