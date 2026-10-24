// Tests de la logique pure du client WooCommerce (connexion wp-login + Store API).
// deno test supabase/functions/supplier-catalog-sync/woocommerceClient.test.ts
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
