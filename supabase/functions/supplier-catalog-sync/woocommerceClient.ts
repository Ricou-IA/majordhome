// supabase/functions/supplier-catalog-sync/woocommerceClient.ts
// Client WooCommerce : connexion par le formulaire wp-login.php puis API Store (`/wp-json/wc/store/v1/products`,
// réservée aux comptes connectés chez un grossiste), paginée par 100, + catégories. Produit un relevé de la MÊME
// forme que scripts/catalogue/dump-woocommerce.browser.js (adaptateur pur _shared/catalogue/woocommerce.js).
// Un site derrière Cloudflare / Turnstile (Domos) répond une page de défi : `acces_bloque`, on ne contourne pas ;
// le relevé se fait alors depuis le navigateur connecté. Fonctions pures testées dans woocommerceClient.test.ts.

const PAGE = 100;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Majordhome-catalogue/1.0";

export type CodeErreurWoo = "acces_bloque" | "connexion_refusee" | "releve_incomplet" | "site_absent";

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
