// Tests de la logique pure du client NetSuite SuiteCommerce (connexion + pagination de l'API catalogue), paramétré
// par le site du fournisseur (site_url, sca_path, site_id — BayWa par défaut).
// deno test supabase/functions/supplier-catalog-sync/suitecommerceClient.test.ts
import { assertEquals, assertStringIncludes, assert, assertThrows } from "jsr:@std/assert@1";
import {
  parseLoginResponse, buildItemsUrl, itemDepuisApi, fusionnerCookies, enteteCookie, parseItemsBody, SuitecommerceError, configSuitecommerce,
} from "./suitecommerceClient.ts";

const BAYWA = { siteUrl: "https://solarshop.baywa-re.fr", scaPath: "/sca-lux-2019-2", siteId: "6376560" };

Deno.test("configSuitecommerce : site_url + connector_config du fournisseur, défauts BayWa, URL sans barre finale", () => {
  assertEquals(configSuitecommerce({ site_url: "https://solarshop.baywa-re.fr/", connector_config: { sca_path: "/sca-lux-2019-2", site_id: "6376560" } }), BAYWA);
  assertEquals(configSuitecommerce({ site_url: "https://autre.example", connector_config: {} }), { siteUrl: "https://autre.example", scaPath: "/sca-lux-2019-2", siteId: "6376560" });
  assertThrows(() => configSuitecommerce({ site_url: null, connector_config: {} }), SuitecommerceError);
});

Deno.test("parseLoginResponse : 403 ou HTML = accès bloqué (Akamai / protection anti-robot)", () => {
  assertEquals(parseLoginResponse(403, "text/html", "<html>Access Denied</html>"), "acces_bloque");
  assertEquals(parseLoginResponse(200, "text/html; charset=utf-8", "<html><body>…</body></html>"), "acces_bloque");
});

Deno.test("parseLoginResponse : JSON d'erreur SuiteCommerce = identifiants refusés", () => {
  assertEquals(parseLoginResponse(401, "application/json", JSON.stringify({ errorStatusCode: "401", errorCode: "ERR_USER_INVALID_EMAIL_OR_PASSWORD" })), "connexion_refusee");
  assertEquals(parseLoginResponse(200, "application/json", JSON.stringify({ errorCode: "ERR_X", errorMessage: "x" })), "connexion_refusee");
  assertEquals(parseLoginResponse(200, "application/json", "pas du json"), "connexion_refusee");
});

Deno.test("parseLoginResponse : JSON avec utilisateur connecté = OK", () => {
  assertEquals(parseLoginResponse(200, "application/json", JSON.stringify({ user: { email: "a@b.fr", isLoggedIn: "T" }, touchpoints: {} })), null);
  assertEquals(parseLoginResponse(200, "application/json;charset=UTF-8", JSON.stringify({ isLoggedIn: "T" })), null);
});

Deno.test("buildItemsUrl : site du fournisseur, pagination par 100, fieldset search, sans niveau de prix", () => {
  const url = buildItemsUrl(BAYWA, 300);
  assert(url.startsWith("https://solarshop.baywa-re.fr/api/items?"));
  assertStringIncludes(url, "offset=300");
  assertStringIncludes(url, "limit=100");
  assertStringIncludes(url, "fieldset=search");
  assertStringIncludes(url, "c=6376560");
  assertStringIncludes(url, "sitepath=%2Fsca-lux-2019-2%2FsearchApi.ssp");
  assert(!url.includes("pricelevel"), "pricelevel ne doit pas être forcé");
  assert(buildItemsUrl({ ...BAYWA, siteUrl: "https://autre.example", siteId: "42" }, 0).startsWith("https://autre.example/api/items?") && buildItemsUrl({ ...BAYWA, siteId: "42" }, 0).includes("c=42"));
});

Deno.test("itemDepuisApi : même forme que le relevé navigateur (fields parsé, docs FR/EN, prix, photo, page)", () => {
  const it = {
    internalid: 1, itemid: "35-119503", displayname: "Tesla Powerwall 3", storedisplayname2: "Powerwall 3 Battery", urlcomponent: "tesla-powerwall-3",
    itemtype: "InvtPart", onlinecustomerprice: 4773.29, ispurchasable: true, quantityavailable: 86,
    itemimages_detail: { urls: [{ url: "/img/pw3.jpg" }] },
    custitem_webshopjson: JSON.stringify({
      fields: { mpn: "1707000-30-L", custitem_usableenergy: "13,5" },
      documents: { documents: [{ name: "Data Sheet", docs: [{ language: "FR", url: "/core/media/a.pdf" }, { language: "DE", url: "/core/media/de.pdf" }] }] },
    }),
  };
  const r = itemDepuisApi(it as Record<string, unknown>);
  assertEquals(r.itemid, "35-119503");
  assertEquals(r.price, 4773.29);
  assertEquals(r.urlcomponent, "tesla-powerwall-3");
  assertEquals(r.itemimages_detail, "/img/pw3.jpg");
  assertEquals((r.fields as Record<string, string>).mpn, "1707000-30-L");
  assertEquals(r.docs, [{ type: "Data Sheet", lang: "FR", url: "/core/media/a.pdf" }]);
  const sans = itemDepuisApi({ itemid: "x", custitem_webshopjson: "{pas du json" } as Record<string, unknown>);
  assertEquals(sans.fields, null);
  assertEquals(sans.docs, []);
  assertEquals(sans.itemimages_detail, null);
});

Deno.test("cookies : fusion des Set-Cookie (dernier gagne) et en-tête Cookie", () => {
  const jar = new Map<string, string>();
  fusionnerCookies(jar, ["JSESSIONID=abc; Path=/; HttpOnly", "NLShopperId=111; Path=/"]);
  fusionnerCookies(jar, ["JSESSIONID=def; Path=/", "bm_sv=x; Path=/"]);
  assertEquals(jar.get("JSESSIONID"), "def");
  assertEquals(jar.get("NLShopperId"), "111");
  assertEquals(enteteCookie(jar), "JSESSIONID=def; NLShopperId=111; bm_sv=x");
});

Deno.test("parseItemsBody : page HTML ou JSON illisible = erreur typée, jamais une exception brute", () => {
  const e1 = assertThrows(() => parseItemsBody(200, "text/html", "<html>Access Denied</html>", 0), SuitecommerceError);
  assertEquals(e1.code, "acces_bloque");
  const e2 = assertThrows(() => parseItemsBody(200, "application/json", "{pas du json", 100), SuitecommerceError);
  assertEquals(e2.code, "releve_incomplet");
  const ok = parseItemsBody(200, "application/json;charset=UTF-8", JSON.stringify({ total: 2, items: [{ itemid: "a" }] }), 0);
  assertEquals(ok.total, 2);
  assertEquals(ok.items.length, 1);
});
