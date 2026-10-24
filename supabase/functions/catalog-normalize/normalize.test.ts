// Tests de la logique pure de catalog-normalize (prompt, lecture de la réponse, clé modèle).
// deno test supabase/functions/catalog-normalize/normalize.test.ts
import { assertEquals, assertStringIncludes, assert } from "jsr:@std/assert@1";
import { parseNormalizeResponse, construirePrompt, SEUIL_CONFIANCE } from "./normalize.ts";
import { normaliserModele } from "../_shared/catalogue/modelKey.js";

Deno.test("parseNormalizeResponse : JSON propre", () => {
  const r = parseNormalizeResponse(JSON.stringify([{ reference: "35-119503", brand: "Tesla", model: "Powerwall 3", confiance: 0.98 }]));
  assertEquals(r, [{ reference: "35-119503", brand: "Tesla", model: "Powerwall 3", confiance: 0.98 }]);
});

Deno.test("parseNormalizeResponse : JSON entouré de texte ou de ```json", () => {
  const r = parseNormalizeResponse("Voici le résultat :\n```json\n[{\"reference\":\"A\",\"brand\":\"HUAWEI\",\"model\":\"LUNA2000-7-E1\",\"confiance\":0.95}]\n```\nFin.");
  assertEquals(r.length, 1);
  assertEquals(r[0].model, "LUNA2000-7-E1");
});

Deno.test("parseNormalizeResponse : confiance hors [0,1] ou entrée sans référence ⇒ ignorée ; modèle vide ⇒ null conservé ; texte sans JSON ⇒ vide", () => {
  const r = parseNormalizeResponse(JSON.stringify([
    { reference: "A", brand: "X", model: "M1", confiance: 1.4 },
    { brand: "X", model: "M2", confiance: 0.9 },
    { reference: "C", brand: "X", model: "", confiance: 0.9 },
    { reference: "D", brand: "X", model: "M4", confiance: "0.93" },
    { reference: "E", brand: "X", model: null, confiance: 0.2 },
  ]));
  assertEquals(r.map((x) => x.reference), ["C", "D", "E"]);
  assertEquals(r[0].model, null);
  assertEquals(r[1].confiance, 0.93);
  assertEquals(r[2].model, null);
  assertEquals(parseNormalizeResponse("rien d'utile"), []);
});

Deno.test("construirePrompt : une ligne par article avec référence, nom, marque, gamme, specs utiles ; consigne de sortie JSON", () => {
  const p = construirePrompt([
    { reference: "35-119503", name: "Tesla Powerwall 3 – batterie 13,5 kWh", brand: "Tesla", gamme: "Batterie", specs: { canonical: { mpn: "1707000-30-L", energie_utile_kwh: 13.5, stock_releve: { qty: 3 }, fiche_technique_fr: "https://…" } } },
  ]);
  assertStringIncludes(p, "35-119503");
  assertStringIncludes(p, "1707000-30-L");
  assertStringIncludes(p, "13.5");
  assert(!p.includes("stock_releve"), "le stock n'aide pas à identifier le modèle");
  assert(!p.includes("fiche_technique_fr"));
  assertStringIncludes(p, "confiance");
  assertStringIncludes(p, "JSON");
});

Deno.test("seuil de confiance et clé normalisée partagée avec src/lib/catalogue/modelKey.js", () => {
  assertEquals(SEUIL_CONFIANCE, 0.9);
  assertEquals(normaliserModele("LUNA2000-7-E1"), "LUNA20007E1");
});
