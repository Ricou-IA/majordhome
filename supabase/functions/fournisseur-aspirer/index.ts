// supabase/functions/fournisseur-aspirer/index.ts
// ============================================================================
// Aspirateur de sites fournisseurs — edge de l'écran (fiche fournisseur). verify_jwt = true + requireOrgMembership
// (org_admin : elle utilise les accès du compte fournisseur rangés au coffre). Actions fermées :
//   - lancer            { org_id, supplier_id, champs }   → apprentissage (site inconnu) ou aspiration (recette connue)
//   - suivre            { org_id, aspiration_id }         → état du travail
//   - confirmer_recette { org_id, aspiration_id }         → la recette en essai est bonne : aspiration complète
//   - rejeter_recette   { org_id, aspiration_id }         → la recette est écartée, rien n'est aspiré
//   - appliquer         { org_id, supplier_id, ids }      → propositions écrites par les écrivains existants
// Site, accès, numéro de compte client, nature des prix et marques sont RELUS EN BASE, jamais pris du corps.
// Les accès partent vers le service (MDH_ASPIRATEUR_URL, en-tête X-Aspirateur-Key) le temps du travail, jamais ailleurs.
// Spec 2026-11-28 aspirateur § 7. Réponses : HTTP 200 { data, error: code } (codes : src/lib/aspirateur/codes.js).
// Env : MDH_ASPIRATEUR_URL, MDH_ASPIRATEUR_KEY, ASPIRATEUR_LANCEMENTS_PAR_JOUR (3), ASPIRATEUR_PLAFOND_APPRENTISSAGE_USD (3),
//       ASPIRATEUR_PLAFOND_ASPIRATION_USD (20), SUPABASE_URL, SUPABASE_ANON_KEY.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, getAdminClient } from "../_shared/auth.ts";
import { champsPropres, telecharger, PHOTO_MAX, TYPES_IMAGE } from "../_shared/telechargement.ts";
import { normaliserDomaine } from "../_shared/aspirateur/domaine.js";
import { libelleDocument } from "../_shared/aspirateur/propositions.js";
import { champsSurs } from "../_shared/aspirateur/lecture.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NATURES_PRIX = ["public_ht", "public_ttc", "net_ht"];
const IDS_MAX = 100;
const nombreEnv = (nom: string, defaut: number) => { const n = Number(Deno.env.get(nom)); return Number.isFinite(n) && n > 0 ? n : defaut; };

const ok = (data: unknown, req: Request) => jsonResponse({ data, error: null }, 200, req);
const erreur = (code: string, req: Request) => jsonResponse({ data: null, error: code }, 200, req);
// deno-lint-ignore no-explicit-any
const codeRpc = (e: any, connus: string[]) => connus.find((c) => String(e?.message || "").includes(c)) || "service_indisponible";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  // deno-lint-ignore no-explicit-any
  let corps: any = {};
  try { corps = await req.json(); } catch { corps = {}; }
  const orgId = typeof corps.org_id === "string" && UUID.test(corps.org_id) ? corps.org_id : "";
  if (!orgId) return erreur("requete_invalide", req);

  const auth = await requireOrgMembership(req, { orgId, requiredRole: "org_admin" });
  if (!auth.ok) return auth.response;
  const userId = auth.userId;
  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = getAdminClient();

  /** Ouvre un travail et l'envoie au service ; le travail est clos en échec si l'envoi échoue. */
  // deno-lint-ignore no-explicit-any
  async function demarrer(fournisseur: any, domaine: string, genre: "apprentissage" | "aspiration", champs: unknown[], recetteId: string | null) {
    const plafond = genre === "apprentissage" ? nombreEnv("ASPIRATEUR_PLAFOND_APPRENTISSAGE_USD", 3) : nombreEnv("ASPIRATEUR_PLAFOND_ASPIRATION_USD", 20);
    const { data: id, error: errO } = await admin.rpc("aspiration_ouvrir", {
      p_org_id: orgId, p_supplier_id: fournisseur.id, p_domaine: domaine, p_genre: genre, p_lance_par: userId, p_plafond_usd: plafond, p_recette_id: recetteId,
    });
    if (errO) return { code: codeRpc(errO, ["deja_en_cours", "non_autorise", "site_absent"]) };
    const clore = (code: string) => admin.rpc("aspiration_clore", { p_aspiration_id: id, p_statut: "echec", p_code: code, p_compteurs: null, p_echecs: null });

    let recette = null;
    if (genre === "aspiration") {
      const { data: r, error: errR } = await admin.rpc("aspiration_recette_a_utiliser", { p_aspiration_id: id });
      if (errR || !r?.contenu) { await clore("recette_obsolete"); return { code: "recette_obsolete" }; }
      recette = r.contenu;
    }
    const { data: secret } = await admin.rpc("org_secret_read", { p_org_id: orgId, p_key: `supplier:${fournisseur.id}:credentials` });
    let acces = null;
    try {
      const v = typeof secret === "string" ? JSON.parse(secret) : null;
      if (v?.email && v?.password) acces = { identifiant: String(v.email), mot_de_passe: String(v.password) };
    } catch { acces = null; }
    if (recette?.connexion && !acces) { await clore("acces_absents"); return { code: "acces_absents" }; }

    const url = Deno.env.get("MDH_ASPIRATEUR_URL") || "";
    const cle = Deno.env.get("MDH_ASPIRATEUR_KEY") || "";
    if (!url || !cle) { await clore("service_indisponible"); return { code: "service_indisponible" }; }
    const cfg = fournisseur.connector_config || {};
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-aspirateur-key": cle },
        body: JSON.stringify({
          aspiration_id: id, genre, hote_site: domaine, url_depart: fournisseur.site_url, acces, compte_client: fournisseur.customer_account || null,
          champs, recette, marques: Array.isArray(cfg.aspirateur?.marques) ? cfg.aspirateur.marques.filter((m: unknown) => typeof m === "string") : [],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.status !== 202) throw new Error(`service ${r.status}`);
    } catch (e) {
      console.error("[fournisseur-aspirer] service injoignable", id, (e as Error)?.message || "");
      await clore("service_indisponible");
      return { code: "service_indisponible" };
    }
    return { id };
  }

  // deno-lint-ignore no-explicit-any
  const lireFournisseur = async (supplierId: string): Promise<any> => {
    if (!UUID.test(supplierId)) return null;
    const { data } = await user.from("majordhome_suppliers").select("id, site_url, connector_config, customer_account")
      .eq("id", supplierId).eq("org_id", orgId).maybeSingle();
    return data;
  };

  try {
    // ---------------------------------------------------------------- lancer
    if (corps.action === "lancer") {
      const fournisseur = await lireFournisseur(String(corps.supplier_id || ""));
      if (!fournisseur) return erreur("non_autorise", req);
      const domaine = normaliserDomaine(fournisseur.site_url);
      if (!domaine) return erreur("site_absent", req);
      if (!NATURES_PRIX.includes(fournisseur.connector_config?.aspirateur?.nature_prix)) return erreur("nature_prix_absente", req);
      const champs = champsSurs(champsPropres(corps.champs)); // nettoyés : ils entrent dans la consigne de l’agent
      const { data: quota } = await admin.rpc("aspiration_quota", { p_org_id: orgId, p_limite: nombreEnv("ASPIRATEUR_LANCEMENTS_PAR_JOUR", 3) });
      if (quota !== true) return erreur("quota_atteint", req);
      const { data: etat, error: errE } = await user.rpc("aspiration_recette_etat", { p_org_id: orgId, p_domaine: domaine });
      if (errE) return erreur("service_indisponible", req);
      const genre = etat?.connue === true ? "aspiration" : "apprentissage";
      const r = await demarrer(fournisseur, domaine, genre, champs, null);
      return r.code ? erreur(r.code, req) : ok({ aspiration_id: r.id, genre }, req);
    }

    // ---------------------------------------------------------------- suivre
    if (corps.action === "suivre") {
      const id = String(corps.aspiration_id || "");
      if (!UUID.test(id)) return erreur("requete_invalide", req);
      const { data } = await user.from("majordhome_aspirations").select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
      return data ? ok(data, req) : erreur("travail_inconnu", req);
    }

    // ---------------------------------------------------------------- confirmer / rejeter
    if (corps.action === "confirmer_recette" || corps.action === "rejeter_recette") {
      const id = String(corps.aspiration_id || "");
      if (!UUID.test(id)) return erreur("requete_invalide", req);
      const { data: travail } = await user.from("majordhome_aspirations").select("id, supplier_id, domaine, statut")
        .eq("id", id).eq("org_id", orgId).maybeSingle();
      if (!travail || travail.statut !== "attente_confirmation") return erreur("travail_inconnu", req);
      if (corps.action === "rejeter_recette") {
        const { error } = await admin.rpc("aspiration_clore", { p_aspiration_id: id, p_statut: "echec", p_code: "recette_refusee", p_compteurs: null, p_echecs: null });
        return error ? erreur("service_indisponible", req) : ok({ rejetee: true }, req);
      }
      const fournisseur = await lireFournisseur(travail.supplier_id);
      if (!fournisseur) return erreur("non_autorise", req);
      const { data: r } = await admin.rpc("aspiration_recette_a_utiliser", { p_aspiration_id: id });
      if (!r?.recette_id) return erreur("recette_obsolete", req);
      const champs = champsSurs(champsPropres(corps.champs)); // nettoyés : ils entrent dans la consigne de l’agent
      const lance = await demarrer(fournisseur, travail.domaine, "aspiration", champs, r.recette_id);
      if (lance.code) return erreur(lance.code, req);
      await admin.rpc("aspiration_clore", { p_aspiration_id: id, p_statut: "termine", p_code: null, p_compteurs: null, p_echecs: null });
      return ok({ aspiration_id: lance.id }, req);
    }

    // ---------------------------------------------------------------- appliquer
    if (corps.action === "appliquer") {
      const supplierId = String(corps.supplier_id || "");
      const ids = (Array.isArray(corps.ids) ? corps.ids : []).filter((x: unknown) => typeof x === "string" && UUID.test(x)).slice(0, IDS_MAX);
      if (!UUID.test(supplierId) || !ids.length) return erreur("requete_invalide", req);
      const { data: peut } = await user.rpc("user_can", { p_org_id: orgId, p_resource: "articles", p_action: "edit" });
      if (peut !== true) return erreur("non_autorise", req);

      const { data: props, error: errP } = await user.from("majordhome_catalogue_propositions").select("*")
        .eq("org_id", orgId).eq("supplier_id", supplierId).eq("statut", "a_valider").in("id", ids);
      if (errP) return erreur("service_indisponible", req);
      if (!props?.length) return erreur("propositions_absentes", req);

      // deno-lint-ignore no-explicit-any
      const parRef = new Map<string, any[]>();
      for (const p of props) parRef.set(p.reference, [...(parRef.get(p.reference) || []), p]);
      const references = [...parRef.keys()];
      const echecs: Array<{ id: string; code: string }> = [];
      const appliquees: string[] = [];

      // 1. Lignes du fournisseur : nouveaux articles et prix d'achat, par l'écrivain unique (rien n'est désactivé).
      const { data: avant } = await user.from("majordhome_supplier_products").select("id, reference, name")
        .eq("org_id", orgId).eq("supplier_id", supplierId).in("reference", references);
      const version = `aspirateur_${new Date().toISOString().slice(0, 10)}`;
      const rows = [];
      for (const [reference, liste] of parRef) {
        const nouvel = liste.find((p) => p.genre === "nouvel_article");
        const prix = liste.find((p) => p.genre === "prix_achat");
        if (!nouvel && !prix) continue;
        const existant = (avant || []).find((l) => l.reference === reference);
        if (!nouvel && !existant) continue;
        rows.push({
          reference, name: nouvel?.valeur?.nom || existant?.name || reference, brand: nouvel?.valeur?.marque || null,
          category: liste.some((p) => p.genre === "caracteristique") ? "poele" : null, product_kind: "main",
          purchase_price_ht: prix?.valeur?.achat_ht ?? 0, purchase_price_at: new Date().toISOString(),
          tarif_public: prix?.valeur?.public_ht ?? null, selling_price_ht_defaut: 0,
          specs: { source_version: version, canonical: {} },
        });
      }
      if (rows.length) {
        const { error } = await admin.rpc("supplier_catalog_upsert", {
          p_org_id: orgId, p_supplier_id: supplierId, p_source_version: version, p_rows: rows,
          p_meta: { desactiver_absents: false, source: "aspirateur" },
        });
        if (error) {
          console.error("[fournisseur-aspirer] écriture du catalogue refusée", error.message);
          for (const p of props) if (p.genre === "nouvel_article" || p.genre === "prix_achat") echecs.push({ id: p.id, code: "service_indisponible" });
        } else {
          for (const p of props) if ((p.genre === "nouvel_article" || p.genre === "prix_achat") && rows.some((r) => r.reference === p.reference)) appliquees.push(p.id);
        }
      }

      // 2. Article Majord'home de chaque référence (créé s'il manque : ligne sans prix, que l'écrivain ne rattache pas).
      const { data: lignes } = await user.from("majordhome_supplier_products").select("id, reference, catalog_item_id")
        .eq("org_id", orgId).eq("supplier_id", supplierId).in("reference", references);
      const article = new Map<string, string>();
      for (const l of lignes || []) {
        let item = l.catalog_item_id;
        if (!item && parRef.get(l.reference)?.some((p) => ["caracteristique", "document", "photo"].includes(p.genre))) {
          const { data: cree } = await user.rpc("catalog_item_create_for_product", { p_product_id: l.id });
          item = cree || null;
        }
        if (item) article.set(l.reference, item);
      }

      // 3. Caractéristiques, documents, photo : au jeton de l'utilisateur (droits par colonne, règles de stockage).
      for (const [reference, liste] of parRef) {
        const itemId = article.get(reference);
        const autres = liste.filter((p) => ["caracteristique", "document", "photo"].includes(p.genre));
        if (!autres.length) continue;
        if (!itemId) { for (const p of autres) echecs.push({ id: p.id, code: "service_indisponible" }); continue; }
        const { data: item } = await user.from("majordhome_catalog_items").select("id, specs, image_url").eq("id", itemId).eq("org_id", orgId).maybeSingle();
        // deno-lint-ignore no-explicit-any
        const patch: Record<string, any> = {};
        const caracs = autres.filter((p) => p.genre === "caracteristique" && p.cle);
        if (caracs.length) {
          const specs = item?.specs && typeof item.specs === "object" ? item.specs : {};
          patch.specs = { ...specs, canonical: { ...(specs.canonical || {}), ...Object.fromEntries(caracs.map((p) => [p.cle, p.valeur])) } };
        }
        for (const p of autres.filter((x) => x.genre === "document")) {
          try {
            const source = String(p.valeur?.storage_path || "");
            if (!source.startsWith(`${orgId}/articles/aspires/`)) throw new Error("document hors du dossier");
            const { data: blob, error: errD } = await admin.storage.from("product-documents").download(source);
            if (errD || !blob) throw new Error("document introuvable");
            const octets = new Uint8Array(await blob.arrayBuffer());
            const chemin = `${orgId}/articles/${itemId}/${crypto.randomUUID()}.pdf`;
            const { error: errU } = await user.storage.from("product-documents").upload(chemin, octets, { contentType: "application/pdf", upsert: false });
            if (errU) throw new Error(errU.message);
            const libelle = libelleDocument(String(p.cle));
            const { error: errI } = await user.from("majordhome_product_documents_write").insert({
              catalog_item_id: itemId, org_id: orgId, document_type: libelle, file_name: `${libelle} ${reference}.pdf`.slice(0, 120),
              storage_path: chemin, file_size: octets.length, mime_type: "application/pdf", uploaded_by: userId,
            });
            if (errI) { await user.storage.from("product-documents").remove([chemin]); throw new Error(errI.message); }
            appliquees.push(p.id);
          } catch (e) {
            console.error("[fournisseur-aspirer] document non joint", p.id, (e as Error)?.message || "");
            echecs.push({ id: p.id, code: "service_indisponible" });
          }
        }
        const photo = autres.find((x) => x.genre === "photo");
        if (photo && !item?.image_url && typeof photo.valeur === "string") {
          try {
            const r = await telecharger(photo.valeur, PHOTO_MAX, Date.now() + 30_000);
            const ext = TYPES_IMAGE[r.type];
            if (!ext) throw new Error("pas une image");
            const chemin = `${orgId}/articles/${itemId}/${crypto.randomUUID()}.${ext}`;
            const { error: errU } = await user.storage.from("product-images").upload(chemin, r.octets, { contentType: r.type, upsert: false });
            if (errU) throw new Error(errU.message);
            patch.image_url = user.storage.from("product-images").getPublicUrl(chemin).data.publicUrl;
          } catch (e) {
            console.error("[fournisseur-aspirer] photo non copiée", photo.id, (e as Error)?.message || "");
            echecs.push({ id: photo.id, code: "service_indisponible" });
          }
        }
        if (Object.keys(patch).length) {
          patch.updated_at = new Date().toISOString();
          const { data: maj, error: errM } = await user.from("majordhome_catalog_items").update(patch).eq("id", itemId).eq("org_id", orgId).select("id").maybeSingle();
          const touchees = caracs.concat(patch.image_url && photo ? [photo] : []);
          if (errM || !maj) for (const p of touchees) echecs.push({ id: p.id, code: "service_indisponible" });
          else for (const p of touchees) appliquees.push(p.id);
        }
      }

      if (appliquees.length) await user.rpc("catalogue_propositions_decider", { p_org_id: orgId, p_ids: appliquees, p_statut: "appliquee" });
      return ok({ appliquees: appliquees.length, echecs }, req);
    }

    return erreur("requete_invalide", req);
  } catch (e) {
    console.error("[fournisseur-aspirer]", corps.action, (e as Error)?.message || "erreur");
    return erreur("service_indisponible", req);
  }
});
