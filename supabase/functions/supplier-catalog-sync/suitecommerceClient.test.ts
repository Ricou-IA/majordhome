// Tests de la logique pure du client BayWa (connexion SuiteCommerce + pagination de l'API catalogue).
// deno test supabase/functions/supplier-catalog-sync/baywaClient.test.ts
import { assertEquals, assertStringIncludes, assert } from "jsr:@std/assert@1";
import { parseLoginResponse, buildItemsUrl, itemDepuisApi, fusionnerCookies, enteteCookie, parseItemsBody, BaywaError } from "./baywaClient.ts";
import { assertThrows } from "jsr:@std/assert@1";

Deno.test("parseItemsBody : page HTML ou JSON illisible = erreur typée, jamais une exception brute", () => {
  const e1 = assertThrows(() => parseItemsBody(200, "text/html", "<html>Access Denied</html>", 0), BaywaError);
  assertEquals(e1.code, "acces_bloque");
  const e2 = assertThrows(() => parseItemsBody(200, "application/json", "{pas du json", 100), BaywaError);
  assertEquals(e2.code, "releve_incomplet");
  const e3 = assertThrows(() => parseItemsBody(500, "application/json", "{}", 200), BaywaError);
  assertEquals(e3.code, "releve_incomplet");
  const ok = parseItemsBody(200, "application/json;charset=UTF-8", JSON.stringify({ total: 2, items: [{ itemid: "a" }] }), 0);
  assertEquals(ok.total, 2);
  assertEquals(ok.items.length, 1);
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

Deno.test("buildItemsUrl : pagination par 100, fieldset search, sans niveau de prix (la session le fixe)", () => {
  const url = buildItemsUrl(300);
  assertStringIncludes(url, "/api/items?");
  assertStringIncludes(url, "offset=300");
  assertStringIncludes(url, "limit=100");
  assertStringIncludes(url, "fieldset=search");
  assertStringIncludes(url, "q=");
  assert(!url.includes("pricelevel"), "pricelevel ne doit pas être forcé");
});

Deno.test("itemDepuisApi : même forme que le relevé navigateur (fields parsé, docs FR/EN, prix)", () => {
  const it = {
    internalid: 1, itemid: "35-119503", displayname: "Tesla Powerwall 3", storedisplayname2: "Powerwall 3 Battery",
    itemtype: "InvtPart", onlinecustomerprice: 4773.29, ispurchasable: true, quantityavailable: 86,
    custitem_webshopjson: JSON.stringify({
      fields: { mpn: "1707000-30-L", custitem_usableenergy: "13,5" },
      documents: { documents: [{ name: "Data Sheet", docs: [{ language: "FR", url: "/core/media/a.pdf" }, { language: "DE", url: "/core/media/de.pdf" }] }] },
    }),
  };
  const r = itemDepuisApi(it as Record<string, unknown>);
  assertEquals(r.itemid, "35-119503");
  assertEquals(r.price, 4773.29);
  assertEquals((r.fields as Record<string, string>).mpn, "1707000-30-L");
  assertEquals(r.docs, [{ type: "Data Sheet", lang: "FR", url: "/core/media/a.pdf" }]);
  const sans = itemDepuisApi({ itemid: "x", custitem_webshopjson: "{pas du json" } as Record<string, unknown>);
  assertEquals(sans.fields, null);
  assertEquals(sans.docs, []);
});

Deno.test("cookies : fusion des Set-Cookie (dernier gagne) et en-tête Cookie", () => {
  const jar = new Map<string, string>();
  fusionnerCookies(jar, ["JSESSIONID=abc; Path=/; HttpOnly", "NLShopperId=111; Path=/"]);
  fusionnerCookies(jar, ["JSESSIONID=def; Path=/", "bm_sv=x; Path=/"]);
  assertEquals(jar.get("JSESSIONID"), "def");
  assertEquals(jar.get("NLShopperId"), "111");
  assertEquals(enteteCookie(jar), "JSESSIONID=def; NLShopperId=111; bm_sv=x");
});
