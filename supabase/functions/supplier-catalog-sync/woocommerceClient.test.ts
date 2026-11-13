// Tests de la logique pure du client WooCommerce (connexion wp-login + Store API).
// deno test --allow-read supabase/functions/supplier-catalog-sync/woocommerceClient.test.ts  (--allow-read : extrait réel du flux)
import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { parseWpLoginResponse, buildWooProductsUrl, buildWooCategoriesUrl, parseWooProductsBody, WooError } from "./woocommerceClient.ts";

Deno.test("parseWpLoginResponse : redirection avec cookie wordpress_logged_in = connecté", () => {
  assertEquals(parseWpLoginResponse(302, ["wordpress_logged_in_abc=x; Path=/; HttpOnly", "wordpress_sec_abc=y"], ""), null);
  assertEquals(parseWpLoginResponse(200, ["wordpress_logged_in_abc=x"], "<html>tableau de bord</html>"), null);
});

Deno.test("parseWpLoginResponse : formulaire de connexion renvoyé = identifiants refusés", () => {
  assertEquals(parseWpLoginResponse(200, [], '<form name="loginform" id="loginform"><p class="login-error">Mot de passe incorrect</p>'), "connexion_refusee");
  assertEquals(parseWpLoginResponse(200, ["wp-settings-time=1"], "<div class=\"woocommerce-error\">Nom d'utilisateur inconnu</div>"), "connexion_refusee");
});

Deno.test("parseWpLoginResponse : Cloudflare / Turnstile / 403 = accès bloqué (on ne contourne pas)", () => {
  assertEquals(parseWpLoginResponse(403, [], "<html>Access denied</html>"), "acces_bloque");
  assertEquals(parseWpLoginResponse(503, [], "<html><title>Un instant…</title></html>"), "acces_bloque");
  assertEquals(parseWpLoginResponse(200, [], '<html><input type="hidden" name="cf-turnstile-response"></html>'), "acces_bloque");
  assertEquals(parseWpLoginResponse(200, [], "<html>Checking if the site connection is secure cf-chl</html>"), "acces_bloque");
});

Deno.test("buildWooProductsUrl / buildWooCategoriesUrl : Store API paginée sur le site du fournisseur", () => {
  assertEquals(buildWooProductsUrl("https://webshop.domosindustries.com/", 3), "https://webshop.domosindustries.com/wp-json/wc/store/v1/products?per_page=100&page=3");
  assertStringIncludes(buildWooCategoriesUrl("https://x.fr"), "/wp-json/wc/store/v1/products/categories?per_page=100");
});

Deno.test("parseWooProductsBody : 401 = session non reconnue, HTML = bloqué, JSON = page + total", () => {
  const e1 = assertThrows(() => parseWooProductsBody(401, "application/json", '{"code":"domos_store_api_auth_required"}', "1", "1"), WooError);
  assertEquals(e1.code, "connexion_refusee");
  const e2 = assertThrows(() => parseWooProductsBody(200, "text/html", "<html>", "1", "1"), WooError);
  assertEquals(e2.code, "acces_bloque");
  const ok = parseWooProductsBody(200, "application/json; charset=UTF-8", JSON.stringify([{ id: 1, name: "A &#8211; B", sku: "1" }]), "761", "8");
  assertEquals(ok.total, 761);
  assertEquals(ok.pages, 8);
  assertEquals(ok.items[0].name, "A – B");
});

// ---------------------------------------------------------------------------------------------------------------
// Boutique publique (catalogue de pièces) : sans connexion, description et marque gardées, catégories paginées.
// ---------------------------------------------------------------------------------------------------------------
import { assertRejects, assertMatch, assert } from "jsr:@std/assert@1";
import { parseWooPublicProductsBody, parseWooPublicCategoriesBody, lireBoutiquePublique } from "./woocommerceClient.ts";
import { piecesDepuisReleveWoocommerce } from "../_shared/catalogue/woocommercePieces.js";

const SITE = "https://marchand.example";
const JSON_CT = "application/json; charset=UTF-8";

const fiche = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: `Joint &#8211; ${id}`, slug: `joint-${id}`, sku: `REF${id}`, permalink: `${SITE}/produit/joint-${id}/`, type: "simple", parent: 0,
  prices: { price: "1200", currency_minor_unit: 2 }, is_in_stock: true, is_purchasable: true,
  categories: [{ id: 10, name: "Pièces détachées MCZ", slug: "pieces-mcz", link: "x" }],
  brands: [{ id: 5, name: "MCZ", slug: "mcz" }],
  description: "<p>Compatible <b>Club 2.0</b></p><script>alert(1)</script>", short_description: "<p>Joint</p>",
  images: [{ id: 1, src: `${SITE}/img/${id}.jpg`, alt: "" }],
  ...over,
});
const CATEGORIES = [
  { id: 9, name: "Conduits de fumées", slug: "conduits", parent: 0, count: 5, link: "x" },
  { id: 10, name: "Pièces détachées MCZ", slug: "pieces-mcz", parent: 0, count: 3, link: "x" },
  { id: 11, name: "Joints MCZ", slug: "joints-mcz", parent: 10, count: 2, link: "x" },
];

/** Faux serveur Store API : enregistre chaque requête, répond par pages de `parPage`. */
function faux(opts: { produits: unknown[]; categories?: unknown[]; parPageProduits?: number; parPageCategories?: number; panneA?: number; htmlA?: number; reseauA?: number; entetes?: { produits?: Record<string, string>; categories?: Record<string, string> } }) {
  const requetes: Array<{ url: string; headers: Record<string, string> }> = [];
  const parPageP = opts.parPageProduits ?? 100;
  const parPageC = opts.parPageCategories ?? 100;
  const cats = opts.categories ?? CATEGORIES;
  let compteProduits = 0;
  const fetchFn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requetes.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") ?? "1");
    const estCat = u.pathname.endsWith("/products/categories");
    if (!estCat) {
      compteProduits += 1;
      if (opts.reseauA === compteProduits) return Promise.reject(new TypeError("connexion coupée"));
      if (opts.panneA === compteProduits) return Promise.resolve(new Response("boom", { status: 500 }));
      if (opts.htmlA === compteProduits) return Promise.resolve(new Response("<html>Just a moment</html>", { status: 200, headers: { "content-type": "text/html" } }));
    }
    const source = estCat ? cats : opts.produits;
    const par = estCat ? parPageC : parPageP;
    const pages = Math.max(1, Math.ceil(source.length / par));
    return Promise.resolve(new Response(JSON.stringify(source.slice((page - 1) * par, page * par)), {
      status: 200, headers: { "content-type": JSON_CT, ...((estCat ? opts.entetes?.categories : opts.entetes?.produits) ?? { "x-wp-total": String(source.length), "x-wp-totalpages": String(pages) }) },
    }));
  };
  return { fetchFn, requetes };
}

Deno.test("parseWooPublicProductsBody : garde description, description courte, marque, images et catégories (brut, l'adaptateur nettoie)", () => {
  const r = parseWooPublicProductsBody(200, JSON_CT, JSON.stringify([fiche(1)]), "1", "1");
  assertEquals(r.total, 1);
  const it = r.items[0] as Record<string, any>;
  assertStringIncludes(String(it.description), "Club 2.0");
  assertEquals(it.short_description, "<p>Joint</p>");
  assertEquals(it.brands, [{ name: "MCZ" }]);
  assertEquals(it.images[0].src, `${SITE}/img/1.jpg`);
  assertEquals(it.categories[0].id, 10);
  assertEquals(it.sku, "REF1");
  assertEquals(it.prices.price, "1200");
});

Deno.test("parseWooPublicProductsBody / Categories : 403, 401 et page HTML = accès bloqué ; 500 ou JSON illisible = relevé incomplet", () => {
  for (const [st, ct, body] of [[403, JSON_CT, "{}"], [401, JSON_CT, "{}"], [200, "text/html", "<html>"], [200, JSON_CT, "<!doctype html><title>x</title>"], [200, JSON_CT, "cf-turnstile"]] as const) {
    assertEquals(assertThrows(() => parseWooPublicProductsBody(st, ct, body, "1", "1"), WooError).code, "acces_bloque", `${st} ${ct}`);
    assertEquals(assertThrows(() => parseWooPublicCategoriesBody(st, ct, body, "1", "1"), WooError).code, "acces_bloque", `cat ${st} ${ct}`);
  }
  assertEquals(assertThrows(() => parseWooPublicProductsBody(500, JSON_CT, "boom", "1", "1"), WooError).code, "releve_incomplet");
  assertEquals(assertThrows(() => parseWooPublicProductsBody(200, JSON_CT, "{pas du json", "1", "1"), WooError).code, "releve_incomplet");
  assertEquals(assertThrows(() => parseWooPublicProductsBody(200, JSON_CT, '{"code":"x"}', "1", "1"), WooError).code, "releve_incomplet");
});

Deno.test("lireBoutiquePublique : sans cookie ni connexion, User-Agent qui nomme Majord'home, catégories ET produits paginés, 400 ms entre deux pages", async () => {
  const produits = Array.from({ length: 5 }, (_, i) => fiche(i + 1));
  const { fetchFn, requetes } = faux({ produits, parPageProduits: 2, parPageCategories: 2 });
  const pauses: number[] = [];
  const releve = await lireBoutiquePublique(SITE + "/", { fetchFn, attendre: (ms) => { pauses.push(ms); return Promise.resolve(); } });

  assertEquals(releve.items.length, 5);
  assertEquals(releve.total, 5);
  assertEquals(releve.categories.length, 3); // 2 pages de catégories (2 + 1)
  assertEquals(releve.categories[2].parent, 10);
  assert(releve.fetched_at && !Number.isNaN(Date.parse(releve.fetched_at)));
  // 2 pages de catégories + 3 pages de produits = 5 requêtes, 4 pauses de 400 ms (jamais avant la première)
  assertEquals(requetes.length, 5);
  assertEquals(pauses, [400, 400, 400, 400]);
  for (const r of requetes) {
    assert(!Object.keys(r.headers).some((k) => k.toLowerCase() === "cookie"), "aucun cookie");
    assertMatch(r.headers["User-Agent"], /Majordhome/);
    assert(r.url.startsWith(`${SITE}/wp-json/wc/store/v1/products`), r.url);
  }
  // les produits ne sont demandés que pour les rayons de pièces (10 et son sous-rayon 11), jamais pour « Conduits » (9)
  const urlProduits = requetes.filter((r) => !r.url.includes("/categories"));
  for (const r of urlProduits) {
    const ids = (new URL(r.url).searchParams.get("category") ?? "").split(",").sort();
    assertEquals(ids, ["10", "11"]);
  }
});

Deno.test("lireBoutiquePublique : le relevé rendu donne à l'adaptateur de pièces EXACTEMENT les lignes de l'extrait réel", async () => {
  const extrait = JSON.parse(await Deno.readTextFile(new URL("../../../scripts/catalogue/data/ebd-pieces-2026-11.json", import.meta.url)));
  const { fetchFn } = faux({ produits: extrait.items, categories: extrait.categories, parPageProduits: 100 });
  const releve = await lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 });
  assertEquals(releve.items.length, extrait.items.length);
  const options = { version: "woocommerce_2026-11-12", releveLe: "2026-11-12T04:00:00Z", remisePct: 10 };
  const lu = piecesDepuisReleveWoocommerce(releve as never, options);
  const attendu = piecesDepuisReleveWoocommerce(extrait, options);
  assertEquals(lu.compte, attendu.compte);
  assertEquals(lu.rayons, attendu.rayons);
  assertEquals(lu.lignes, attendu.lignes);
  assert(lu.lignes.length > 100);
  // description et marque du marchand présentes sur au moins une ligne
  assert(lu.lignes.some((l: Record<string, any>) => String(l.specs.canonical.description_marchand).length > 50));
});

Deno.test("lireBoutiquePublique : flux en panne à la page 3 des produits => erreur, AUCUN relevé rendu", async () => {
  const produits = Array.from({ length: 6 }, (_, i) => fiche(i + 1));
  const { fetchFn, requetes } = faux({ produits, parPageProduits: 2, panneA: 3 });
  let rendu: unknown = undefined;
  const e = await assertRejects(async () => { rendu = await lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 }); }, WooError);
  assertEquals(e.code, "releve_incomplet");
  assertEquals(rendu, undefined);
  assertEquals(requetes.filter((r) => !r.url.includes("/categories")).length, 3, "on s'arrête à la page en panne");
});

Deno.test("lireBoutiquePublique : connexion coupée en cours de route => releve_incomplet, rien de partiel", async () => {
  const produits = Array.from({ length: 6 }, (_, i) => fiche(i + 1));
  const { fetchFn } = faux({ produits, parPageProduits: 2, reseauA: 2 });
  const e = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e.code, "releve_incomplet");
  assertStringIncludes(String(e.detail), "connexion coupée");
});

Deno.test("lireBoutiquePublique : page HTML (anti-robot) => acces_bloque et on s'arrête, sans insister", async () => {
  const produits = Array.from({ length: 6 }, (_, i) => fiche(i + 1));
  const { fetchFn, requetes } = faux({ produits, parPageProduits: 2, htmlA: 1 });
  const e = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e.code, "acces_bloque");
  assertEquals(requetes.filter((r) => !r.url.includes("/categories")).length, 1);
});

Deno.test("lireBoutiquePublique : pagesMax est une borne dure => erreur (jamais un relevé tronqué)", async () => {
  const produits = Array.from({ length: 6 }, (_, i) => fiche(i + 1));
  const { fetchFn } = faux({ produits, parPageProduits: 2 });
  const e = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0, pagesMax: 2 }), WooError);
  assertEquals(e.code, "releve_incomplet");
  assertStringIncludes(String(e.detail), "pagesMax");
  // pile à la borne : accepté
  const ok = await lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0, pagesMax: 3 });
  assertEquals(ok.items.length, 6);
});

Deno.test("lireBoutiquePublique : moins de fiches que le total annoncé => releve_incomplet ; aucun rayon de pièces => releve_incomplet", async () => {
  const produits = Array.from({ length: 4 }, (_, i) => fiche(i + 1));
  // le serveur annonce 4 mais la page 2 revient vide
  const base = faux({ produits, parPageProduits: 2 });
  const fetchTronque = (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    if (!u.pathname.endsWith("/categories") && u.searchParams.get("page") === "2") {
      return Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": JSON_CT, "x-wp-total": "4", "x-wp-totalpages": "2" } }));
    }
    return base.fetchFn(input, init);
  };
  const e = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn: fetchTronque, pauseMs: 0 }), WooError);
  assertEquals(e.code, "releve_incomplet");
  const sans = faux({ produits, categories: [{ id: 9, name: "Conduits de fumées", slug: "c", parent: 0, count: 1 }] });
  const e2 = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn: sans.fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e2.code, "releve_incomplet");
  assertEquals(sans.requetes.filter((r) => !r.url.includes("/categories")).length, 0, "aucun produit demandé sans rayon de pièces");
});

Deno.test("lireBoutiquePublique : site absent => site_absent", async () => {
  const e = await assertRejects(() => lireBoutiquePublique("pas-une-url", { fetchFn: faux({ produits: [] }).fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e.code, "site_absent");
});

// --- Correctif 1 : jamais de relevé tronqué sans erreur, défi lu hors JSON seulement ---------------------------------

Deno.test("lireBoutiquePublique : en-têtes de pagination absents, vides ou non numériques => releve_incomplet, aucun relevé (produits COMME catégories)", async () => {
  const produits = Array.from({ length: 3 }, (_, i) => fiche(i + 1));
  const cas: Array<[string, { produits?: Record<string, string>; categories?: Record<string, string> }]> = [
    ["produits sans aucun en-tête", { produits: {} }],
    ["produits sans X-WP-TotalPages", { produits: { "x-wp-total": "3" } }],
    ["produits sans X-WP-Total", { produits: { "x-wp-totalpages": "1" } }],
    ["produits X-WP-TotalPages: abc", { produits: { "x-wp-total": "3", "x-wp-totalpages": "abc" } }],
    ["produits X-WP-Total vide", { produits: { "x-wp-total": "", "x-wp-totalpages": "1" } }],
    ["catégories sans aucun en-tête", { categories: {} }],
    ["catégories sans X-WP-TotalPages", { categories: { "x-wp-total": "3" } }],
    ["catégories X-WP-TotalPages: abc", { categories: { "x-wp-total": "3", "x-wp-totalpages": "abc" } }],
  ];
  for (const [nom, entetes] of cas) {
    const { fetchFn } = faux({ produits, entetes });
    let rendu: unknown = undefined;
    const e = await assertRejects(async () => { rendu = await lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 }); }, WooError, undefined, nom);
    assertEquals(e.code, "releve_incomplet", nom);
    assertStringIncludes(String(e.detail), "pagination", nom);
    assertEquals(rendu, undefined, nom);
  }
});

Deno.test("lireBoutiquePublique : catalogue annoncé vide (total 0, liste vide) => releve_incomplet, jamais un relevé vide", async () => {
  const { fetchFn } = faux({ produits: [] });
  const e = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e.code, "releve_incomplet");
  // même verdict quand le serveur annonce 0 page
  const z = faux({ produits: [], entetes: { produits: { "x-wp-total": "0", "x-wp-totalpages": "0" } } });
  const e2 = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn: z.fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e2.code, "releve_incomplet");
});

Deno.test("parseWooPublic* : une description qui contient « Just a moment » ou « Un instant » n'est pas un défi (JSON valide)", () => {
  const f = fiche(1, { description: "<p>Just a moment... Un instant… cf-turnstile cf-chl</p>" });
  const r = parseWooPublicProductsBody(200, JSON_CT, JSON.stringify([f]), "1", "1");
  assertEquals(r.items.length, 1);
  assertStringIncludes(String((r.items[0] as Record<string, unknown>).description), "Just a moment");
  const c = parseWooPublicCategoriesBody(200, JSON_CT, JSON.stringify([{ id: 1, name: "Un instant…", slug: "x", parent: 0, count: 1 }]), "1", "1");
  assertEquals(c.items.length, 1);
});

Deno.test("lireBoutiquePublique : relevé complet accepté malgré « Just a moment » dans une description ; page de défi non JSON = toujours acces_bloque", async () => {
  const produits = [fiche(1, { description: "<p>Just a moment...</p>" }), fiche(2)];
  const { fetchFn } = faux({ produits });
  const releve = await lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 });
  assertEquals(releve.items.length, 2);
  // défis : HTML, texte « Just a moment » sous un type JSON, 403, 401
  for (const [st, ct, body] of [[200, "text/html", "<html>Just a moment</html>"], [200, JSON_CT, "Just a moment..."], [503, "text/plain", "Checking if the site connection is secure"], [403, JSON_CT, '{"a":1}'], [401, JSON_CT, "[]"]] as const) {
    assertEquals(assertThrows(() => parseWooPublicProductsBody(st, ct, body, "1", "1"), WooError).code, "acces_bloque", `${st} ${ct} ${body}`);
  }
});

// --- Correctif final A2 : https seulement, aucune redirection suivie, délai par requête, compte strict -------------

Deno.test("lireBoutiquePublique : adresse en http => site_non_https, AUCUNE requête émise", async () => {
  const { fetchFn, requetes } = faux({ produits: [fiche(1)] });
  const e = await assertRejects(() => lireBoutiquePublique("http://marchand.example", { fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e.code, "site_non_https");
  assertEquals(requetes.length, 0);
});

Deno.test("lireBoutiquePublique : localhost, adresse IP littérale (v4, v6) ou hôte vide => site_invalide, aucune requête", async () => {
  for (const site of ["https://localhost", "https://localhost:8443", "https://api.localhost", "https://127.0.0.1", "https://10.0.0.5:8080/boutique",
    "https://[::1]", "https://[fd00::1]", "https://169.254.169.254", "https://2130706433", "https://0x7f.0.0.1", "https:///chemin"]) {
    const { fetchFn, requetes } = faux({ produits: [fiche(1)] });
    const e = await assertRejects(() => lireBoutiquePublique(site, { fetchFn, pauseMs: 0 }), WooError, undefined, site);
    assert(["site_invalide", "site_absent"].includes(e.code), `${site} : ${e.code}`);
    assertEquals(requetes.length, 0, site);
  }
});

Deno.test("lireBoutiquePublique : chaque requête part avec redirect: 'manual' et un signal de délai", async () => {
  const vus: RequestInit[] = [];
  const base = faux({ produits: [fiche(1)] });
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => { vus.push(init ?? {}); return base.fetchFn(input, init); };
  await lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 });
  assert(vus.length >= 2);
  for (const init of vus) {
    assertEquals(init.redirect, "manual");
    assert(init.signal instanceof AbortSignal, "signal de délai");
  }
});

Deno.test("lireBoutiquePublique : réponse 301 => site_redirige (hôte cité), et AUCUNE seconde requête", async () => {
  const requetes: string[] = [];
  const fetchFn = (input: string | URL | Request) => {
    requetes.push(String(input));
    return Promise.resolve(new Response("", { status: 301, headers: { location: "https://ailleurs.example/wp-json/wc/store/v1/products/categories" } }));
  };
  const e = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e.code, "site_redirige");
  assertStringIncludes(String(e.detail), "ailleurs.example");
  assertStringIncludes(String(e.detail), "corrigez l'adresse du site");
  assertEquals(requetes.length, 1);
  // une redirection opaque (sans Location lisible) est aussi un refus
  const opaque = () => Promise.resolve(new Response("", { status: 302 }));
  assertEquals((await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn: opaque, pauseMs: 0 }), WooError)).code, "site_redirige");
});

Deno.test("lireBoutiquePublique : délai dépassé => releve_incomplet (délai), rien de partiel", async () => {
  const produits = Array.from({ length: 4 }, (_, i) => fiche(i + 1));
  const base = faux({ produits, parPageProduits: 2 });
  let n = 0;
  // la 3e requête (page 2 des produits) ne répond jamais : seul le signal de délai l'interrompt
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    n += 1;
    if (n === 3) {
      return new Promise<Response>((_, rejeter) => {
        init?.signal?.addEventListener("abort", () => rejeter(init.signal?.reason ?? new DOMException("délai", "TimeoutError")));
      });
    }
    return base.fetchFn(input, init);
  };
  let rendu: unknown = undefined;
  const e = await assertRejects(async () => { rendu = await lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0, delaiRequeteMs: 20 }); }, WooError);
  assertEquals(e.code, "releve_incomplet");
  assertStringIncludes(String(e.detail), "délai");
  assertEquals(rendu, undefined);
});

Deno.test("lireBoutiquePublique : X-WP-Total: 0 avec des fiches => releve_incomplet", async () => {
  const { fetchFn } = faux({ produits: [fiche(1), fiche(2)], entetes: { produits: { "x-wp-total": "0", "x-wp-totalpages": "1" } } });
  const e = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e.code, "releve_incomplet");
});

Deno.test("lireBoutiquePublique : plus de fiches que le total annoncé => releve_incomplet (compte strict)", async () => {
  const { fetchFn } = faux({ produits: [fiche(1), fiche(2), fiche(3)], entetes: { produits: { "x-wp-total": "2", "x-wp-totalpages": "1" } } });
  const e = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e.code, "releve_incomplet");
});

Deno.test("lireBoutiquePublique : total qui change d'une page à l'autre => releve_incomplet", async () => {
  const produits = Array.from({ length: 4 }, (_, i) => fiche(i + 1));
  const base = faux({ produits, parPageProduits: 2 });
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    if (!u.pathname.endsWith("/categories") && u.searchParams.get("page") === "2") {
      return Promise.resolve(new Response(JSON.stringify(produits.slice(2, 4)), { status: 200, headers: { "content-type": JSON_CT, "x-wp-total": "5", "x-wp-totalpages": "2" } }));
    }
    return base.fetchFn(input, init);
  };
  const e = await assertRejects(() => lireBoutiquePublique(SITE, { fetchFn, pauseMs: 0 }), WooError);
  assertEquals(e.code, "releve_incomplet");
  assertStringIncludes(String(e.detail), "total");
});
