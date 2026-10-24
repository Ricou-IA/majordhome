// supabase/functions/supplier-catalog-sync/index.ts
// ============================================================================
// supplier-catalog-sync — relevé du catalogue d'un fournisseur → supplier_catalog_upsert
// ============================================================================
// verify_jwt:false. Deux portes :
//   - { mode: "cron" } sous MDH_CRON_SECRET (pg_cron, 20261024_3) : tous les fournisseurs actifs
//     `connector = 'baywa'` de toutes les orgs, chacun avec les identifiants Vault de son org ;
//   - { action: "sync" | "import", org_id, supplier_id, releve? } sous JWT user, org_admin de l'org
//     (requireOrgMembership) : bouton « Actualiser le catalogue » (sync, BayWa seul) ou « Importer un
//     relevé » (import : fichier JSON produit par scripts/catalogue/dump-<fournisseur>.browser.js).
// La transformation relevé → lignes est l'adaptateur PUR _shared/catalogue/<connector>.js (copie de
// src/lib/catalogue, même code que le script Node). L'écrivain est UNIQUE : la RPC
// public.supplier_catalog_upsert (service_role), qui pose aussi catalog_sync_at / catalog_sync_result.
// Un échec métier répond 200 { ok:false, code } et écrit { ok:false, code, at } sur le fournisseur :
//   identifiants_absents | connexion_refusee | acces_bloque | releve_incomplet | connector_inconnu | releve_invalide
// On ne contourne JAMAIS une protection anti-robot (acces_bloque ⇒ relevé depuis le navigateur).
// Spec : docs/superpowers/specs/2026-10-24-module-batterie-catalogue-baywa-design.md § 7.
// ============================================================================

import { requireOrgMembership, requireSharedSecret, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { articlesDepuisReleveBaywa } from "../_shared/catalogue/baywa.js";
import { articlesDepuisReleveDomos } from "../_shared/catalogue/domos.js";
import { BaywaError, connecterBaywa, releverCatalogueBaywa } from "./baywaClient.ts";

const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";

type Admin = ReturnType<typeof getAdminClient>;
type Connector = "baywa" | "domos";
type Adaptateur = (releve: unknown, opts: { version: string }) => { lignes: unknown[]; retenus: number; exclus: Record<string, number>; releve_at: string | null };

interface Supplier { id: string; org_id: string; name: string; connector: Connector | null; is_active: boolean }

const ADAPTATEURS: Record<Connector, Adaptateur> = {
  baywa: articlesDepuisReleveBaywa as unknown as Adaptateur,
  domos: articlesDepuisReleveDomos as unknown as Adaptateur,
};

class SyncError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) { super(code); this.code = code; this.detail = detail; }
}

function versionDe(connector: string, releveAt: string | null): string {
  return `${connector}_${(releveAt || new Date().toISOString()).slice(0, 10)}`;
}

async function marquerEchec(admin: Admin, supplier: Supplier, code: string, detail?: string) {
  const { error } = await admin.from("majordhome_suppliers_write")
    .update({ catalog_sync_at: new Date().toISOString(), catalog_sync_result: { ok: false, code, detail: detail ? String(detail).slice(0, 300) : undefined, at: new Date().toISOString() } })
    .eq("id", supplier.id).eq("org_id", supplier.org_id);
  if (error) console.error("[supplier-catalog-sync] marquerEchec", error.message);
}

/** Relevé déjà en main (fichier ou API) → adaptateur → RPC. */
async function ecrireReleve(admin: Admin, supplier: Supplier, connector: Connector, releve: unknown) {
  const adaptateur = ADAPTATEURS[connector];
  let res;
  try {
    res = adaptateur(releve, { version: versionDe(connector, (releve as { fetched_at?: string })?.fetched_at ?? null) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.startsWith("releve_incomplet") ? "releve_incomplet"
      : msg.startsWith("reference_en_double") ? "releve_instable"
      : "releve_invalide";
    throw new SyncError(code, msg);
  }
  if (!res.retenus) throw new SyncError("releve_invalide", "aucun article retenu");
  const { data, error } = await admin.rpc("supplier_catalog_upsert", {
    p_org_id: supplier.org_id, p_supplier_id: supplier.id,
    p_source_version: versionDe(connector, res.releve_at), p_rows: res.lignes,
  });
  if (error) throw new SyncError("ecriture_refusee", error.message);
  return { ...(data as Record<string, unknown>), retenus: res.retenus, exclus: res.exclus };
}

/** Connexion BayWa avec les identifiants Vault de l'org, relevé, écriture. */
async function synchroniserBaywa(admin: Admin, supplier: Supplier) {
  const { data: secret, error } = await admin.rpc("org_secret_read", { p_org_id: supplier.org_id, p_key: `supplier:${supplier.id}:credentials` });
  if (error) throw new SyncError("ecriture_refusee", error.message);
  if (!secret) throw new SyncError("identifiants_absents");
  let creds: { email?: string; password?: string } = {};
  try { creds = JSON.parse(String(secret)); } catch { creds = {}; }
  if (!creds.email || !creds.password) throw new SyncError("identifiants_absents", "format");
  try {
    const jar = await connecterBaywa({ email: creds.email, password: creds.password });
    const releve = await releverCatalogueBaywa(jar);
    return await ecrireReleve(admin, supplier, "baywa", releve);
  } catch (e) {
    if (e instanceof BaywaError) throw new SyncError(e.code, e.detail);
    throw e;
  }
}

async function traiter(admin: Admin, supplier: Supplier, action: "sync" | "import", releve?: unknown) {
  try {
    if (!supplier.connector || !(supplier.connector in ADAPTATEURS)) throw new SyncError("connector_inconnu", String(supplier.connector));
    if (action === "import") {
      if (!releve || typeof releve !== "object" || !Array.isArray((releve as { items?: unknown }).items)) throw new SyncError("releve_invalide", "items manquants");
      return { ok: true, resultat: await ecrireReleve(admin, supplier, supplier.connector, releve) };
    }
    if (supplier.connector !== "baywa") throw new SyncError("connector_inconnu", `${supplier.connector} : relevé manuel uniquement`);
    return { ok: true, resultat: await synchroniserBaywa(admin, supplier) };
  } catch (e) {
    if (e instanceof SyncError) {
      await marquerEchec(admin, supplier, e.code, e.detail);
      return { ok: false, code: e.code, detail: e.detail };
    }
    // Erreur non métier (réseau, TLS, bug) : le fournisseur porte l'échec et, en mode cron, les suivants
    // sont quand même traités. Rien n'a été écrit dans le catalogue (l'écriture est atomique dans la RPC).
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[supplier-catalog-sync] erreur inattendue", supplier.id, msg);
    await marquerEchec(admin, supplier, "erreur_inattendue", msg);
    return { ok: false, code: "erreur_inattendue", detail: msg.slice(0, 300) };
  }
}

async function chargerSupplier(admin: Admin, orgId: string, supplierId: string): Promise<Supplier | null> {
  const { data, error } = await admin.from("majordhome_suppliers").select("id, org_id, name, connector, is_active")
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
      const { data, error } = await admin.from("majordhome_suppliers").select("id, org_id, name, connector, is_active")
        .eq("connector", "baywa").eq("is_active", true);
      if (error) return jsonResponse({ error: error.message }, 500, req);
      const rapports = [];
      for (const s of (data as Supplier[]) || []) {
        const r = await traiter(admin, s, "sync");
        rapports.push({ supplier_id: s.id, org_id: s.org_id, name: s.name, ...r });
      }
      return jsonResponse({ ok: true, fournisseurs: rapports.length, rapports }, 200, req);
    }

    const orgId = typeof body.org_id === "string" ? body.org_id : "";
    const supplierId = typeof body.supplier_id === "string" ? body.supplier_id : "";
    const action = body.action === "import" ? "import" : body.action === "sync" ? "sync" : null;
    if (!orgId || !supplierId || !action) return jsonResponse({ error: "org_id, supplier_id et action (sync | import) requis" }, 400, req);

    const auth = await requireOrgMembership(req, { orgId, requiredRole: "org_admin" });
    if (!auth.ok) return auth.response;

    const supplier = await chargerSupplier(admin, orgId, supplierId);
    if (!supplier) return jsonResponse({ error: "supplier_not_found" }, 404, req);

    const r = await traiter(admin, supplier, action, body.releve);
    return jsonResponse(r, 200, req);
  } catch (e) {
    console.error("[supplier-catalog-sync]", e);
    return jsonResponse({ error: sanitizeError(e, "supplier-catalog-sync failed") }, 500, req);
  }
});
