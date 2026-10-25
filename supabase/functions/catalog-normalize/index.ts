// supabase/functions/catalog-normalize/index.ts
// ============================================================================
// catalog-normalize — modèle fabricant par l'IA, en lot (spec tranche 2 § 7, niveau 2)
// ============================================================================
// verify_jwt:true + requireOrgMembership(org_admin). Body { org_id, supplier_id? (absent = toute l'org), limit? (≤ 200) }.
// Sélectionne les lignes actives SANS clé modèle (model_key IS NULL, source ≠ manuel), les soumet à
// Claude par lots de 50 (nom, marque, gamme, specs utiles — jamais la description longue), lit { brand, model,
// confiance } et, pour confiance ≥ 0,9, pose model_key = normaliserModele(model), model_key_source = 'ia' et
// specs.canonical.modele_ia / modele_ia_confiance (fusion, rien d'autre n'est touché). Les modèles sous le seuil
// sont conservés dans les specs (modele_ia, confiance) sans poser de clé — et l'article n'est jamais resoumis
// (sélection sur modele_ia_confiance absente). Puis catalog_matches_propose(org). Une saisie manuelle
// (model_key_source = 'manuel') n'est jamais recalculée. Réponse { traites, poses, restants, sans_cle_apres_ia }.
// Env : ANTHROPIC_API_KEY, ANTHROPIC_MODEL (défaut claude-sonnet-5-5).
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import { normaliserModele } from "../_shared/catalogue/modelKey.js";
import { construirePrompt, parseNormalizeResponse, SEUIL_CONFIANCE, TAILLE_LOT, type ArticleAPrompt } from "./normalize.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
const LIMITE_MAX = 200;

interface Produit extends ArticleAPrompt { id: string; model_key_source: string | null }

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);
  if (!ANTHROPIC_API_KEY) return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500, req);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const orgId = typeof body.org_id === "string" ? body.org_id : "";
  const supplierId = typeof body.supplier_id === "string" ? body.supplier_id : "";
  const limit = Math.min(LIMITE_MAX, Math.max(1, Number(body.limit) || TAILLE_LOT));
  if (!orgId) return jsonResponse({ error: "org_id requis" }, 400, req);

  const auth = await requireOrgMembership(req, { orgId, requiredRole: "org_admin" });
  if (!auth.ok) return auth.response;
  const admin = auth.supabase;

  try {
    // supplier_id optionnel : sans lui, toutes les lignes de l'org (page « Harmoniser les bases »). La fumisterie est
    // écartée : ~24 000 pièces DINAK / Modinox sans équivalent d'une marque à l'autre, qui noyaient l'IA (100 lignes par
    // clic, ordre alphabétique) — les bornes Ecostal n'avaient jamais été soumises (constat du 2026-10-25).
    // deno-lint-ignore no-explicit-any
    const perimetre = (q: any) => {
      const base = q.or("category.is.null,category.neq.fumisterie");
      return supplierId ? base.eq("supplier_id", supplierId) : base;
    };
    // Jamais deux fois le même article : ceux déjà soumis (modele_ia_confiance posée) sont écartés, sinon un lot
    // sous le seuil de confiance serait resoumis à chaque clic sans jamais avancer.
    const { data: produits, error } = await perimetre(admin.from("majordhome_supplier_products")
      .select("id, reference, name, brand, gamme, specs, model_key_source")
      .eq("org_id", orgId).eq("is_active", true))
      .is("model_key", null).or("model_key_source.is.null,model_key_source.neq.manuel")
      .is("specs->canonical->modele_ia_confiance", null)
      .order("name").limit(limit);
    if (error) return jsonResponse({ error: error.message }, 500, req);
    const { count: restantsAvant } = await perimetre(admin.from("majordhome_supplier_products").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).eq("is_active", true)).is("model_key", null)
      .is("specs->canonical->modele_ia_confiance", null);
    const { count: dejaTentes } = await perimetre(admin.from("majordhome_supplier_products").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).eq("is_active", true)).is("model_key", null)
      .not("specs->canonical->modele_ia_confiance", "is", null);

    const liste = (produits || []) as Produit[];
    if (!liste.length) return jsonResponse({ ok: true, traites: 0, poses: 0, restants: 0, sans_cle_apres_ia: dejaTentes || 0 }, 200, req);

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    let traites = 0;
    let poses = 0;
    let tokens = 0;
    for (let i = 0; i < liste.length; i += TAILLE_LOT) {
      const lot = liste.slice(i, i + TAILLE_LOT);
      const parRef = new Map(lot.map((p) => [p.reference, p]));
      const response = await client.messages.create({
        model: MODEL, max_tokens: 4000,
        messages: [{ role: "user", content: construirePrompt(lot) }],
      });
      tokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      const texte = response.content.find((c) => c.type === "text");
      const trouves = parseNormalizeResponse(texte && "text" in texte ? texte.text : "");
      for (const t of trouves) {
        const p = parParRef(parRef, t.reference);
        if (!p) continue;
        const cle = t.model ? normaliserModele(t.model) : null;
        const poser = !!cle && t.confiance >= SEUIL_CONFIANCE;
        const canonical = { ...((p.specs?.canonical as Record<string, unknown>) || {}), modele_ia: t.model, modele_ia_confiance: t.confiance, ...(t.brand ? { marque_ia: t.brand } : {}) };
        const patch: Record<string, unknown> = { specs: { ...(p.specs || {}), canonical }, updated_at: new Date().toISOString() };
        if (poser) { patch.model_key = cle; patch.model_key_source = "ia"; }
        const { error: errUp } = await admin.from("majordhome_supplier_products_write").update(patch).eq("id", p.id).eq("org_id", orgId);
        if (errUp) { console.error("[catalog-normalize] update", p.id, errUp.message); continue; }
        traites += 1;
        if (poser) poses += 1;
      }
    }

    // Articles Majord'home : une clé posée par l'IA peut révéler un article commun → propositions de fusion
    const { data: matches, error: errM } = await admin.rpc("catalog_item_proposals_propose", { p_org_id: orgId });
    if (errM) console.error("[catalog-normalize] catalog_item_proposals_propose", errM.message);

    // restants = encore jamais soumis ; sans_cle_apres_ia = soumis mais restés sous le seuil (à saisir à la main)
    // la normalisation a réussi même si la relance des fusions échoue : on le dit (matches_error), on ne l'avale pas
    return jsonResponse({
      ok: true, traites, poses, restants: Math.max(0, (restantsAvant || 0) - traites),
      sans_cle_apres_ia: (dejaTentes || 0) + (traites - poses), tokens, matches: matches ?? null,
      matches_error: errM ? errM.message : null,
    }, 200, req);
  } catch (e) {
    console.error("[catalog-normalize]", e);
    return jsonResponse({ error: sanitizeError(e, "catalog-normalize failed") }, 500, req);
  }
});

function parParRef(parRef: Map<string, Produit>, reference: string): Produit | undefined {
  return parRef.get(reference) ?? parRef.get(reference.trim());
}
