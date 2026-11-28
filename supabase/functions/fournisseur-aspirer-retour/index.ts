// supabase/functions/fournisseur-aspirer-retour/index.ts
// ============================================================================
// Retour du service de l'aspirateur (VPS) : c'est « l'upload ». Le service n'a aucune clé de la base ; il dépose ici
// ses résultats, rangés par les seules RPC aspiration_* (service_role). verify_jwt = false + requireSharedSecret.
// Actions fermées :
//   - lot    { aspiration_id, produits } : PDF (base64, « %PDF- » vérifié, 20 Mo au plus) rangés sous
//            product-documents/${org}/articles/aspires/${empreinte}.pdf (un objet par contenu, réutilisé), puis
//            propositions construites contre les lignes du fournisseur (construirePropositions) et rangées.
//   - recette { aspiration_id, recette, essai } : recette enregistrée (refusée si elle contient un accès du compte,
//            relus au coffre ici, ou le numéro de compte client), puis travail « en attente de confirmation ».
//   - fin    { aspiration_id, statut, code, compteurs, echecs } : travail clos ; recette promue après une aspiration réussie.
// L'organisation et le fournisseur sont TOUJOURS ceux du travail (relus en base), jamais ceux du corps.
// Spec 2026-11-28 aspirateur § 7.1, § 7.6. Réponses : { data, error: code }.
// ============================================================================

import { requireSharedSecret, jsonResponse, getAdminClient } from "../_shared/auth.ts";
import { construirePropositions, typeDocument } from "../_shared/aspirateur/propositions.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPREINTE = /^[0-9a-f]{64}$/;
const PDF_MAX = 20 * 1024 * 1024;
const PRODUITS_MAX = 50;
const TYPES = ["fiche_technique", "notice", "declaration_performance", "etiquette_energie"];

const ok = (data: unknown, req: Request) => jsonResponse({ data, error: null }, 200, req);
const erreur = (code: string, req: Request) => jsonResponse({ data: null, error: code }, 200, req);
// deno-lint-ignore no-explicit-any
const codeRpc = (e: any) => (["travail_inconnu", "recette_contient_secret", "requete_invalide"].find((c) => String(e?.message || "").includes(c)) || "service_indisponible");

function base64VersOctets(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256(octets: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", octets as unknown as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);
  const refus = requireSharedSecret(req, Deno.env.get("MDH_ASPIRATEUR_KEY") || "", "MDH_ASPIRATEUR_KEY");
  if (refus) return refus;

  // deno-lint-ignore no-explicit-any
  let corps: any = {};
  try { corps = await req.json(); } catch { corps = {}; }
  const id = typeof corps.aspiration_id === "string" ? corps.aspiration_id : "";
  if (!UUID.test(id)) return erreur("requete_invalide", req);
  const admin = getAdminClient();

  // Travail relu en base : organisation, fournisseur, genre.
  const { data: travail, error: errT } = await admin.from("majordhome_aspirations")
    .select("id, org_id, supplier_id, genre, statut").eq("id", id).maybeSingle();
  if (errT) return erreur("service_indisponible", req);
  if (!travail) return erreur("travail_inconnu", req);
  const orgId: string = travail.org_id;
  const supplierId: string = travail.supplier_id;

  try {
    if (corps.action === "lot") {
      if (travail.statut !== "en_cours") return erreur("travail_inconnu", req);
      const produits = Array.isArray(corps.produits) ? corps.produits.slice(0, PRODUITS_MAX) : [];
      if (!produits.length) return erreur("requete_invalide", req);

      const { data: fournisseur, error: errF } = await admin.from("majordhome_suppliers")
        .select("connector_config").eq("id", supplierId).eq("org_id", orgId).maybeSingle();
      if (errF || !fournisseur) return erreur("service_indisponible", req);
      const cfg = fournisseur.connector_config || {};
      const naturePrix = cfg.aspirateur?.nature_prix ?? null;
      const remise = Number.isFinite(cfg.aspirateur?.remise_pct) ? cfg.aspirateur.remise_pct : (Number.isFinite(cfg.pieces?.remise_pct) ? cfg.pieces.remise_pct : null);

      // Documents : rangés par contenu (un objet par empreinte), le contenu ne repart jamais dans les propositions.
      for (const p of produits) {
        const docs = [];
        for (const d of Array.isArray(p.documents) ? p.documents : []) {
          if (!TYPES.includes(d?.type) || typeof d?.contenu_base64 !== "string") continue;
          const octets = base64VersOctets(d.contenu_base64);
          if (octets.length > PDF_MAX || new TextDecoder().decode(octets.subarray(0, 5)) !== "%PDF-") continue;
          const empreinte = await sha256(octets);
          if (d.empreinte && (!EMPREINTE.test(d.empreinte) || d.empreinte !== empreinte)) continue;
          const chemin = `${orgId}/articles/aspires/${empreinte}.pdf`;
          const { error: errUp } = await admin.storage.from("product-documents").upload(chemin, octets, { contentType: "application/pdf", upsert: false });
          if (errUp && !/exist|duplicate/i.test(errUp.message)) continue;
          docs.push({ type: d.type, storage_path: chemin, empreinte });
        }
        p.documents = docs;
      }

      // Lignes existantes du fournisseur pour ces références (prix, article, caractéristiques, documents, photo).
      const references = [...new Set(produits.map((p: { reference_fabricant?: string }) => p.reference_fabricant).filter(Boolean))] as string[];
      // deno-lint-ignore no-explicit-any
      let lignes: any[] = [];
      if (references.length) {
        const { data, error } = await admin.from("majordhome_supplier_products")
          .select("reference, catalog_item_id, purchase_price_ht, purchase_price_at")
          .eq("org_id", orgId).eq("supplier_id", supplierId).in("reference", references);
        if (error) return erreur("service_indisponible", req);
        lignes = data || [];
      }
      const itemIds = [...new Set(lignes.map((l) => l.catalog_item_id).filter(Boolean))];
      // deno-lint-ignore no-explicit-any
      let articles: any[] = [];
      // deno-lint-ignore no-explicit-any
      let documents: any[] = [];
      if (itemIds.length) {
        const [a, d] = await Promise.all([
          admin.from("majordhome_catalog_items").select("id, specs, image_url").eq("org_id", orgId).in("id", itemIds),
          admin.from("majordhome_product_documents").select("catalog_item_id, document_type").eq("org_id", orgId).in("catalog_item_id", itemIds),
        ]);
        if (a.error || d.error) return erreur("service_indisponible", req);
        articles = a.data || [];
        documents = d.data || [];
      }
      const existants = lignes.map((l) => {
        const art = articles.find((x) => x.id === l.catalog_item_id);
        return {
          reference: l.reference, catalog_item_id: l.catalog_item_id, specs_canonical: art?.specs?.canonical || {},
          purchase_price_ht: l.purchase_price_ht, purchase_price_at: l.purchase_price_at, a_photo: !!art?.image_url,
          documents_types: documents.filter((x) => x.catalog_item_id === l.catalog_item_id).map((x) => typeDocument(x.document_type)).filter((t): t is string => !!t),
        };
      });

      const { propositions, echecs } = construirePropositions({ produits, existants, naturePrix, remisePct: remise });
      let rangees = 0;
      if (propositions.length) {
        const { data: n, error } = await admin.rpc("aspiration_propositions_ajouter", { p_aspiration_id: id, p_lignes: propositions });
        if (error) return erreur(codeRpc(error), req);
        rangees = n ?? 0;
      }
      return ok({ propositions: rangees, echecs }, req);
    }

    if (corps.action === "recette") {
      if (!corps.recette || typeof corps.recette !== "object") return erreur("requete_invalide", req);
      // Secrets interdits relus ici (jamais reçus du service) : accès du compte et numéro de compte client.
      const interdits: string[] = [];
      const { data: secret } = await admin.rpc("org_secret_read", { p_org_id: orgId, p_key: `supplier:${supplierId}:credentials` });
      try {
        const v = typeof secret === "string" ? JSON.parse(secret) : null;
        if (v?.email) interdits.push(String(v.email));
        if (v?.password) interdits.push(String(v.password));
      } catch { /* accès illisibles : la recette est contrôlée sur le reste */ }
      const { data: f } = await admin.from("majordhome_suppliers").select("customer_account").eq("id", supplierId).eq("org_id", orgId).maybeSingle();
      if (f?.customer_account) interdits.push(String(f.customer_account));

      const { error: errR } = await admin.rpc("aspiration_recette_enregistrer", { p_aspiration_id: id, p_contenu: corps.recette, p_interdits: interdits });
      if (errR) {
        const code = codeRpc(errR);
        await admin.rpc("aspiration_clore", { p_aspiration_id: id, p_statut: "echec", p_code: code === "recette_contient_secret" ? code : "recette_refusee", p_compteurs: null, p_echecs: null });
        return erreur(code, req);
      }
      const essai = Array.isArray(corps.essai) ? corps.essai.slice(0, 5) : [];
      const { error: errE } = await admin.rpc("aspiration_essai", { p_aspiration_id: id, p_essai: essai });
      if (errE) return erreur(codeRpc(errE), req);
      return ok({ attente_confirmation: true }, req);
    }

    if (corps.action === "fin") {
      const statut = corps.statut === "termine" ? "termine" : "echec";
      const code = typeof corps.code === "string" && /^[a-z_]{1,40}$/.test(corps.code) ? corps.code : (statut === "echec" ? "service_indisponible" : null);
      const { error: errC } = await admin.rpc("aspiration_clore", {
        p_aspiration_id: id, p_statut: statut, p_code: code,
        p_compteurs: corps.compteurs && typeof corps.compteurs === "object" ? corps.compteurs : null,
        p_echecs: Array.isArray(corps.echecs) ? corps.echecs.slice(0, 500) : null,
      });
      if (errC) return erreur(codeRpc(errC), req);
      let promue = false;
      if (statut === "termine" && travail.genre === "aspiration") {
        const { data } = await admin.rpc("aspiration_recette_promouvoir", { p_aspiration_id: id });
        promue = data === true;
      }
      return ok({ clos: true, promue }, req);
    }

    return erreur("requete_invalide", req);
  } catch (e) {
    console.error("[fournisseur-aspirer-retour]", id, (e as Error)?.message || "erreur");
    return erreur("service_indisponible", req);
  }
});
