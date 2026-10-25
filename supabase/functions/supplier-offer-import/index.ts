// supabase/functions/supplier-offer-import/index.ts
// ============================================================================
// supplier-offer-import — offre de prix fournisseur (PDF) lue par l'IA, puis écrite au catalogue du fournisseur
// (demande d'Eric, 2026-10-25 : « certains devis dépendent du dimensionnement fait par le fournisseur »)
// ============================================================================
// verify_jwt:true + requireOrgMembership. Deux actions, rien n'est écrit sans validation humaine :
//   - extract : { org_id, pdf_base64, file_name? } — tout membre de l'org (création de devis). Claude lit le PDF
//     (bloc document : texte ET image des pages, un scan passe aussi) avec un format de sortie STRICT
//     (structured outputs, SCHEMA_OFFRE) ; la réponse est relue de façon tolérante et contrôlée (montants, total)
//     par le module pur _shared/catalogue/offreFournisseur.js (copie de src/lib/catalogue). N'écrit RIEN.
//   - apply : { org_id, supplier_id, offre: { numero, date }, lignes } — org_admin. Lignes validées à l'écran →
//     public.supplier_catalog_upsert (écrivain unique, service_role) avec p_meta.desactiver_absents = false (une
//     offre ne liste que quelques articles) : références nouvelles créées (article Majord'home posé par
//     catalog_items_ensure), prix d'achat des existantes mis à jour, champs humains jamais touchés. Répond les
//     lignes fournisseur obtenues (id, référence, article) pour que l'écran rattache ou pose les lignes du devis.
// Consommation de chaque lecture journalisée (console) et renvoyée à l'écran.
// Env : ANTHROPIC_API_KEY, ANTHROPIC_OFFER_MODEL (défaut claude-haiku-5-5 : modèle léger, décision d'Eric sur le
// coût IA), SUPABASE_URL, SUPABASE_ANON_KEY (+ service_role via getAdminClient pour la RPC).
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import {
  SCHEMA_OFFRE, construirePromptOffre, lireOffre, controlerOffre, lignesCatalogueDepuisOffre, versionOffre,
} from "../_shared/catalogue/offreFournisseur.js";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("ANTHROPIC_OFFER_MODEL") || "claude-haiku-5-5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const PDF_MAX = 8 * 1024 * 1024; // octets du PDF (le base64 pèse 4/3)
const DUREE_IA_MS = 120_000; // sous le plafond d'exécution d'une edge (150 s)
const LIGNES_MAX = 400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Codes d'erreur de la RPC → message lisible. */
const ERREURS_RPC: Record<string, string> = {
  rows_empty: "aucune ligne à écrire",
  row_invalid: "une ligne n'a ni référence, ni libellé, ni prix",
  reference_en_double: "une référence apparaît deux fois",
  supplier_not_in_org: "fournisseur inconnu de l'organisation",
};

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const orgId = typeof body.org_id === "string" ? body.org_id : "";
  const action = body.action === "apply" ? "apply" : body.action === "extract" ? "extract" : "";
  if (!UUID.test(orgId) || !action) return jsonResponse({ error: "org_id et action (extract | apply) requis" }, 400, req);

  const auth = await requireOrgMembership(req, { orgId, ...(action === "apply" ? { requiredRole: "org_admin" } : {}) });
  if (!auth.ok) return auth.response;

  try {
    if (action === "extract") {
      if (!ANTHROPIC_API_KEY) return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500, req);
      const pdf = typeof body.pdf_base64 === "string" ? body.pdf_base64.replace(/\s/g, "") : "";
      if (!pdf || !pdf.startsWith("JVBER")) return jsonResponse({ error: "le fichier n'est pas un PDF" }, 400, req);
      if (pdf.length * 0.75 > PDF_MAX) return jsonResponse({ error: `PDF trop lourd (plus de ${PDF_MAX / 1048576} Mo)` }, 413, req);

      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
      const ctrl = new AbortController();
      const minuterie = setTimeout(() => ctrl.abort(), DUREE_IA_MS);
      // deno-lint-ignore no-explicit-any
      let final: any;
      try {
        // deno-lint-ignore no-explicit-any
        const params: any = {
          model: MODEL, max_tokens: 32000,
          // lecture d'un tableau : effort bas suffit ; le format strict garantit un JSON au schéma
          output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA_OFFRE } },
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } },
              { type: "text", text: construirePromptOffre() },
            ],
          }],
        };
        final = await client.messages.stream(params, { signal: ctrl.signal }).finalMessage();
      } catch (e) {
        if (ctrl.signal.aborted) return jsonResponse({ error: "lecture trop longue : réessayez ou découpez le PDF" }, 504, req);
        throw e;
      } finally {
        clearTimeout(minuterie);
      }
      const u = final?.usage || {};
      const conso = {
        input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0,
        cache_read_input_tokens: u.cache_read_input_tokens || 0, cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
      };
      console.log("[supplier-offer-import] conso", JSON.stringify({ org: orgId, fichier: body.file_name ?? null, modele: final?.model ?? MODEL, stop: final?.stop_reason, ...conso }));
      if (final?.stop_reason === "refusal") return jsonResponse({ error: "lecture refusée par les garde-fous du modèle", conso }, 422, req);
      if (final?.stop_reason === "max_tokens") return jsonResponse({ error: "offre trop longue pour une seule lecture : découpez le PDF", conso }, 502, req);
      // deno-lint-ignore no-explicit-any
      const texte = (final?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      const offre = lireOffre(texte);
      if (offre.erreur) return jsonResponse({ error: "réponse de l'IA illisible : réessayez", conso }, 502, req);
      return jsonResponse({ ok: true, offre, controle: controlerOffre(offre), modele: final?.model ?? MODEL, conso }, 200, req);
    }

    // ---- apply ----
    const supplierId = typeof body.supplier_id === "string" ? body.supplier_id : "";
    if (!UUID.test(supplierId)) return jsonResponse({ error: "supplier_id requis" }, 400, req);
    const brutes = Array.isArray(body.lignes) ? body.lignes : [];
    if (!brutes.length || brutes.length > LIGNES_MAX) return jsonResponse({ error: `entre 1 et ${LIGNES_MAX} lignes` }, 400, req);
    const o = (body.offre && typeof body.offre === "object") ? body.offre as Record<string, unknown> : {};
    // relecture des lignes envoyées par l'écran : mêmes règles que la lecture de l'IA (types, libellés)
    const lues = lireOffre({ numero: o.numero, date: o.date, lignes: brutes });
    const offre = { numero: lues.numero, date: lues.date };

    // client au jeton de l'utilisateur : lectures sous RLS (fournisseur et lignes de l'org)
    const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: fournisseur, error: errF } = await user.from("majordhome_suppliers")
      .select("id, name").eq("id", supplierId).eq("org_id", orgId).maybeSingle();
    if (errF) return jsonResponse({ error: errF.message }, 500, req);
    if (!fournisseur) return jsonResponse({ error: "fournisseur introuvable" }, 404, req);

    const version = versionOffre(offre, fournisseur.name);
    const { lignes, ecartees } = lignesCatalogueDepuisOffre(offre, lues.lignes, { version });
    if (!lignes.length) return jsonResponse({ error: "aucune ligne écrivable (référence et prix requis)", ecartees }, 400, req);

    const admin = getAdminClient();
    const { data: resultat, error: errUp } = await admin.rpc("supplier_catalog_upsert", {
      p_org_id: orgId, p_supplier_id: supplierId, p_source_version: version, p_rows: lignes,
      p_meta: { desactiver_absents: false, source: "offre_fournisseur", offre_numero: offre.numero },
    });
    if (errUp) {
      const code = Object.keys(ERREURS_RPC).find((k) => errUp.message?.includes(k));
      return jsonResponse({ error: code ? `Écriture refusée : ${ERREURS_RPC[code]}` : errUp.message, ecartees }, code ? 400 : 500, req);
    }

    const { data: produits, error: errP } = await user.from("majordhome_supplier_products")
      .select("id, reference, catalog_item_id, purchase_price_ht")
      .eq("org_id", orgId).eq("supplier_id", supplierId).in("reference", lignes.map((l) => l.reference));
    if (errP) return jsonResponse({ error: `Catalogue écrit, mais relecture impossible : ${errP.message}`, resultat, ecartees }, 500, req);
    return jsonResponse({ ok: true, resultat, produits: produits || [], ecartees, version }, 200, req);
  } catch (e) {
    console.error("[supplier-offer-import]", e);
    return jsonResponse({ error: sanitizeError(e, "supplier-offer-import failed") }, 500, req);
  }
});
