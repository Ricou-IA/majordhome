// supabase/functions/supplier-catalog-sync/index.ts
// ============================================================================
// supplier-catalog-sync — relevé du catalogue d'un fournisseur → supplier_catalog_upsert (+ enrichissement)
// ============================================================================
// verify_jwt:false. Deux portes :
//   - { mode: "cron" } sous MDH_CRON_SECRET (pg_cron, 20261024_3) : tous les fournisseurs actifs `auto_sync = true`
//     de toutes les orgs, chacun avec les identifiants Vault de son org et la plateforme de sa ligne ;
//   - { action, org_id, supplier_id (sauf matches), … } sous JWT user, org_admin de l’org (requireOrgMembership) :
//       sync      : connexion serveur au site (plateforme suitecommerce | woocommerce) + relevé + écriture ;
//       import    : { releve } fichier JSON produit par scripts/catalogue/dump-<plateforme>.browser.js ;
//       document  : { product_id } télécharge la fiche technique (specs.canonical.fiche_technique_fr) dans
//                   Storage `product-documents` et crée la ligne product_documents « Fiche technique » ;
//       matches   : relance catalog_item_proposals_propose(org) — fusions d’articles Majord’home (aussi après tout relevé réussi).
// Transformation relevé → lignes = adaptateur PUR _shared/catalogue/<plateforme>.js (copie de src/lib/catalogue,
// même code que le script Node), avec la correspondance des catégories `category_mapping` du fournisseur.
// Écrivain UNIQUE : la RPC public.supplier_catalog_upsert (service_role), qui pose catalog_sync_at /
// catalog_sync_result et efface catalog_sync_error. Un échec répond 200 { ok:false, code } et écrit
// `catalog_sync_error` { ok:false, code, detail, at } — jamais catalog_sync_result (le dernier relevé réussi reste).
// Codes : identifiants_absents | connexion_refusee | acces_bloque | releve_incomplet | releve_instable |
//         releve_invalide | connector_inconnu | site_absent | ecriture_refusee | erreur_inattendue |
//         document_absent | document_illisible | document_existant.
// On ne contourne JAMAIS une protection anti-robot (acces_bloque ⇒ relevé depuis le navigateur).
// Spec : docs/superpowers/specs/2026-10-24-catalogue-photovoltaique-connexion-generique-design.md § 5.
// ============================================================================

import { requireOrgMembership, requireSharedSecret, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { articlesDepuisReleveSuitecommerce } from "../_shared/catalogue/suitecommerce.js";
import { articlesDepuisReleveWoocommerce } from "../_shared/catalogue/woocommerce.js";
import { SuitecommerceError, configSuitecommerce, connecterSuitecommerce, releverCatalogueSuitecommerce } from "./suitecommerceClient.ts";
import { WooError, siteWoo, connecterWoocommerce, releverCatalogueWoocommerce } from "./woocommerceClient.ts";

const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";
const BUCKET_DOCS = "product-documents";
const TYPE_FICHE = "Fiche technique";

type Admin = ReturnType<typeof getAdminClient>;
type Connector = "suitecommerce" | "woocommerce";
type Resultat = { lignes: unknown[]; retenus: number; exclus: Record<string, number>; releve_at: string | null; categories_vues: unknown[] };
type Adaptateur = (releve: unknown, opts: { version: string; mapping: Record<string, string> | null }) => Resultat;

interface Supplier {
  id: string; org_id: string; name: string; connector: Connector | null; is_active: boolean;
  site_url: string | null; connector_config: Record<string, unknown> | null; category_mapping: Record<string, string> | null; auto_sync: boolean;
}

const ADAPTATEURS: Record<Connector, Adaptateur> = {
  suitecommerce: articlesDepuisReleveSuitecommerce as unknown as Adaptateur,
  woocommerce: articlesDepuisReleveWoocommerce as unknown as Adaptateur,
};
const COLONNES_SUPPLIER = "id, org_id, name, connector, is_active, site_url, connector_config, category_mapping, auto_sync";

class SyncError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) { super(code); this.code = code; this.detail = detail; }
}

function versionDe(connector: string, releveAt: string | null): string {
  return `${connector}_${(releveAt || new Date().toISOString()).slice(0, 10)}`;
}

/** Échec : écrit catalog_sync_error seulement (le dernier relevé réussi reste affiché). */
async function marquerEchec(admin: Admin, supplier: Supplier, code: string, detail?: string) {
  const { error } = await admin.from("majordhome_suppliers_write")
    .update({ catalog_sync_error: { ok: false, code, detail: detail ? String(detail).slice(0, 300) : undefined, at: new Date().toISOString() } })
    .eq("id", supplier.id).eq("org_id", supplier.org_id);
  if (error) console.error("[supplier-catalog-sync] marquerEchec", error.message);
}

/** Articles Majord'home : propositions de fusion de l'org (fusion d'office si la clé est franche). */
async function proposerMatches(admin: Admin, orgId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.rpc("catalog_item_proposals_propose", { p_org_id: orgId });
  if (error) { console.error("[supplier-catalog-sync] catalog_item_proposals_propose", error.message); return null; }
  return data as Record<string, unknown>;
}

/** Relevé déjà en main (fichier ou API) → adaptateur (mapping du fournisseur) → RPC → rapprochements. */
async function ecrireReleve(admin: Admin, supplier: Supplier, connector: Connector, releve: unknown) {
  const adaptateur = ADAPTATEURS[connector];
  let res: Resultat;
  try {
    res = adaptateur(releve, { version: versionDe(connector, (releve as { fetched_at?: string })?.fetched_at ?? null), mapping: supplier.category_mapping || null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.startsWith("releve_incomplet") ? "releve_incomplet"
      : msg.startsWith("reference_en_double") ? "releve_instable"
      : "releve_invalide";
    throw new SyncError(code, msg);
  }
  if (!res.retenus) throw new SyncError("releve_invalide", "aucun article retenu (tout exclu par la correspondance ?)");
  const { data, error } = await admin.rpc("supplier_catalog_upsert", {
    p_org_id: supplier.org_id, p_supplier_id: supplier.id,
    p_source_version: versionDe(connector, res.releve_at), p_rows: res.lignes,
    p_meta: { categories_vues: res.categories_vues },
  });
  if (error) throw new SyncError("ecriture_refusee", error.message);
  const matches = await proposerMatches(admin, supplier.org_id);
  return { ...(data as Record<string, unknown>), retenus: res.retenus, exclus: res.exclus, matches };
}

async function lireIdentifiants(admin: Admin, supplier: Supplier): Promise<{ email: string; password: string }> {
  const { data: secret, error } = await admin.rpc("org_secret_read", { p_org_id: supplier.org_id, p_key: `supplier:${supplier.id}:credentials` });
  if (error) throw new SyncError("ecriture_refusee", error.message);
  if (!secret) throw new SyncError("identifiants_absents");
  let creds: { email?: string; password?: string } = {};
  try { creds = JSON.parse(String(secret)); } catch { creds = {}; }
  if (!creds.email || !creds.password) throw new SyncError("identifiants_absents", "format");
  return { email: creds.email, password: creds.password };
}

/** Connexion au site avec les identifiants Vault de l'org, relevé, écriture. */
async function synchroniser(admin: Admin, supplier: Supplier, connector: Connector) {
  const creds = await lireIdentifiants(admin, supplier);
  try {
    if (connector === "suitecommerce") {
      const cfg = configSuitecommerce(supplier);
      const jar = await connecterSuitecommerce(cfg, creds);
      const releve = await releverCatalogueSuitecommerce(cfg, jar);
      return await ecrireReleve(admin, supplier, connector, releve);
    }
    const site = siteWoo(supplier);
    const jar = await connecterWoocommerce(site, creds);
    const releve = await releverCatalogueWoocommerce(site, jar);
    return await ecrireReleve(admin, supplier, connector, releve);
  } catch (e) {
    if (e instanceof SuitecommerceError || e instanceof WooError) throw new SyncError(e.code, e.detail);
    throw e;
  }
}

/** Fiche technique relevée → Storage + ligne product_documents (si aucune « Fiche technique » n'existe déjà). */
async function rangerDocument(admin: Admin, supplier: Supplier, productId: string) {
  const { data: produit, error } = await admin.from("majordhome_supplier_products").select("id, org_id, supplier_id, reference, name, specs")
    .eq("id", productId).eq("org_id", supplier.org_id).eq("supplier_id", supplier.id).maybeSingle();
  if (error) throw new SyncError("ecriture_refusee", error.message);
  if (!produit) throw new SyncError("document_absent", "produit introuvable");
  const url = (produit.specs as { canonical?: { fiche_technique_fr?: string } })?.canonical?.fiche_technique_fr;
  if (!url || !/^https?:\/\//.test(url)) throw new SyncError("document_absent", "aucun lien de fiche technique relevé");

  const { data: existants, error: errDocs } = await admin.from("majordhome_product_documents").select("id")
    .eq("supplier_product_id", productId).eq("org_id", supplier.org_id).eq("document_type", TYPE_FICHE).limit(1);
  if (errDocs) throw new SyncError("ecriture_refusee", errDocs.message);
  if (existants && existants.length) throw new SyncError("document_existant");

  const res = await fetch(url, { headers: { "User-Agent": "Majordhome-catalogue/1.0", Accept: "application/pdf" } });
  if (!res.ok) throw new SyncError("document_illisible", `HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 100 || String.fromCharCode(...buf.slice(0, 4)) !== "%PDF") throw new SyncError("document_illisible", "pas un PDF");
  if (buf.byteLength > 35 * 1024 * 1024) throw new SyncError("document_illisible", "fichier trop lourd");

  const nomFichier = `fiche-technique-${String(produit.reference || produit.id).replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
  const storagePath = `${supplier.org_id}/${productId}/${crypto.randomUUID()}.pdf`;
  const { error: errUp } = await admin.storage.from(BUCKET_DOCS).upload(storagePath, buf, { contentType: "application/pdf", upsert: false });
  if (errUp) throw new SyncError("ecriture_refusee", errUp.message);
  const { data: doc, error: errIns } = await admin.from("majordhome_product_documents_write").insert({
    supplier_product_id: productId, org_id: supplier.org_id, document_type: TYPE_FICHE, file_name: nomFichier,
    storage_path: storagePath, file_size: buf.byteLength, mime_type: "application/pdf", uploaded_by: null,
  }).select("id").single();
  if (errIns) throw new SyncError("ecriture_refusee", errIns.message);
  return { document_id: (doc as { id: string }).id, file_name: nomFichier, taille: buf.byteLength };
}

async function traiter(admin: Admin, supplier: Supplier, action: "sync" | "import" | "document" | "matches", body: Record<string, unknown>) {
  try {
    if (action === "matches") return { ok: true, resultat: await proposerMatches(admin, supplier.org_id) };
    if (action === "document") {
      const productId = typeof body.product_id === "string" ? body.product_id : "";
      if (!productId) throw new SyncError("document_absent", "product_id requis");
      return { ok: true, resultat: await rangerDocument(admin, supplier, productId) };
    }
    if (!supplier.connector || !(supplier.connector in ADAPTATEURS)) throw new SyncError("connector_inconnu", String(supplier.connector));
    if (action === "import") {
      const releve = body.releve;
      if (!releve || typeof releve !== "object" || !Array.isArray((releve as { items?: unknown }).items)) throw new SyncError("releve_invalide", "items manquants");
      return { ok: true, resultat: await ecrireReleve(admin, supplier, supplier.connector, releve) };
    }
    return { ok: true, resultat: await synchroniser(admin, supplier, supplier.connector) };
  } catch (e) {
    if (e instanceof SyncError) {
      if (action === "sync" || action === "import") await marquerEchec(admin, supplier, e.code, e.detail);
      return { ok: false, code: e.code, detail: e.detail };
    }
    // Erreur non métier (réseau, TLS, bug) : le fournisseur porte l'échec et, en mode cron, les suivants
    // sont quand même traités. Rien n'a été écrit dans le catalogue (l'écriture est atomique dans la RPC).
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[supplier-catalog-sync] erreur inattendue", supplier.id, msg);
    if (action === "sync" || action === "import") await marquerEchec(admin, supplier, "erreur_inattendue", msg);
    return { ok: false, code: "erreur_inattendue", detail: msg.slice(0, 300) };
  }
}

async function chargerSupplier(admin: Admin, orgId: string, supplierId: string): Promise<Supplier | null> {
  const { data, error } = await admin.from("majordhome_suppliers").select(COLONNES_SUPPLIER)
    .eq("id", supplierId).eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Supplier | null) ?? null;
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }

  try {
    const admin = getAdminClient();

    if (body.mode === "cron") {
      const authError = requireSharedSecret(req, MDH_CRON_SECRET, "MDH_CRON_SECRET");
      if (authError) return authError;
      const { data, error } = await admin.from("majordhome_suppliers").select(COLONNES_SUPPLIER)
        .eq("auto_sync", true).eq("is_active", true).not("connector", "is", null);
      if (error) return jsonResponse({ error: error.message }, 500, req);
      const rapports = [];
      for (const s of (data as Supplier[]) || []) {
        const r = await traiter(admin, s, "sync", {});
        rapports.push({ supplier_id: s.id, org_id: s.org_id, name: s.name, connector: s.connector, ...r });
      }
      return jsonResponse({ ok: true, fournisseurs: rapports.length, rapports }, 200, req);
    }

    const orgId = typeof body.org_id === "string" ? body.org_id : "";
    const supplierId = typeof body.supplier_id === "string" ? body.supplier_id : "";
    const action = (["sync", "import", "document", "matches"] as const).find((a) => a === body.action) ?? null;
    if (!orgId || !action) return jsonResponse({ error: "org_id et action (sync | import | document | matches) requis" }, 400, req);
    if (action !== "matches" && !supplierId) return jsonResponse({ error: "supplier_id requis" }, 400, req);

    const auth = await requireOrgMembership(req, { orgId, requiredRole: "org_admin" });
    if (!auth.ok) return auth.response;

    // `matches` est un geste de l'org (page Harmoniser les bases), pas d'un fournisseur — un échec de la RPC est un échec
    if (action === "matches") {
      const resultat = await proposerMatches(admin, orgId);
      if (!resultat) return jsonResponse({ error: "propose_failed" }, 500, req);
      return jsonResponse({ ok: true, resultat }, 200, req);
    }

    const supplier = await chargerSupplier(admin, orgId, supplierId);
    if (!supplier) return jsonResponse({ error: "supplier_not_found" }, 404, req);

    const r = await traiter(admin, supplier, action, body);
    return jsonResponse(r, 200, req);
  } catch (e) {
    console.error("[supplier-catalog-sync]", e);
    return jsonResponse({ error: sanitizeError(e, "supplier-catalog-sync failed") }, 500, req);
  }
});
