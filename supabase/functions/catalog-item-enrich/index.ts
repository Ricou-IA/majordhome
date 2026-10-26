// supabase/functions/catalog-item-enrich/index.ts
// ============================================================================
// catalog-item-enrich — enrichissement web d'un article Majord'home (décision d'Eric, 2026-10-25 : « l'enrichissement
// IA WEB doit se faire sur l'article pour pouvoir récupérer les photos etc »)
// ============================================================================
// verify_jwt:true + requireOrgMembership + user_can(articles, edit). Deux actions, rien n'est écrit sans validation humaine :
//   - propose : Claude + recherche web cherche photo, fiche technique PDF, page source et les caractéristiques du
//     schéma de la catégorie (champs envoyés par l'écran). Lecture tolérante (module pur _shared/catalogue/
//     enrichissement.js) ; la photo et la fiche sont vérifiées (image / PDF réellement servis) avant d'être proposées.
//     Body { action:'propose', org_id, item_id, champs:[{key,label,unit,type,options?}] }.
//   - apply : télécharge ce que l'admin a coché — photo ⇒ bucket product-images, fiche (PDF vérifié) ⇒ document de
//     l'article dans product-documents/${org}/articles/${item}/ — et fusionne les caractéristiques acceptées.
//     Body { action:'apply', org_id, item_id, photo_url?, fiche_url?, specs? }.
// Toutes les écritures passent par le JETON DE L'UTILISATEUR (RLS articles.edit des articles, policies storage par org) :
// le rôle serveur n'a d'ailleurs pas le droit de modifier majordhome.catalog_items. Téléchargements bornés : URL
// publiques seulement (pas d'IP, pas de nom local), redirections revérifiées, taille plafonnée.
// Env : ANTHROPIC_API_KEY, ANTHROPIC_ENRICH_MODEL (défaut claude-sonnet-5-5 : ~0,29 $ par recherche mesuré en Opus 5.5, décision Eric 2026-10-25), SUPABASE_URL, SUPABASE_ANON_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import {
  urlPublique, adresseIpPrivee, construirePromptEnrichissement, lireProposition, estPdf, nomDeFichier, fusionnerSpecs,
} from "../_shared/catalogue/enrichissement.js";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("ANTHROPIC_ENRICH_MODEL") || "claude-sonnet-5-5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const DUREE_IA_MS = 115_000; // recherche IA ; le reste de l'échéance sert aux vérifications
const ECHEANCE_MS = 140_000; // échéance GLOBALE d'une requête, sous le plafond d'exécution d'une edge (150 s)
const REPRISES_MAX = 4; // pause_turn : la recherche serveur rend la main, on relance
const PHOTO_MAX = 5 * 1024 * 1024; // limite du bucket product-images
const PDF_MAX = 20 * 1024 * 1024;
const TYPES_IMAGE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLE = /^[a-z0-9_]{1,60}$/;
const TYPES_CHAMP = new Set(["number", "text", "boolean", "enum"]);

interface Champ { key: string; label: string; unit: string | null; type: string; options?: string[] }

/** Champs envoyés par l'écran, nettoyés (le prompt ne reçoit rien d'autre). */
function champsPropres(brut: unknown): Champ[] {
  if (!Array.isArray(brut)) return [];
  const out: Champ[] = [];
  for (const c of brut.slice(0, 40)) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o.key !== "string" || !CLE.test(o.key)) continue;
    const type = typeof o.type === "string" && TYPES_CHAMP.has(o.type) ? o.type : "text";
    const champ: Champ = {
      key: o.key, label: String(o.label || o.key).slice(0, 80), unit: o.unit ? String(o.unit).slice(0, 20) : null, type,
    };
    if (Array.isArray(o.options)) champ.options = o.options.slice(0, 30).map((x) => String(x).slice(0, 40));
    out.push(champ);
  }
  return out;
}

/** Caractéristiques acceptées : clés du format attendu, valeurs scalaires bornées. */
function specsPropres(brut: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return out;
  for (const [k, v] of Object.entries(brut as Record<string, unknown>).slice(0, 60)) {
    if (!CLE.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}

/**
 * Le nom doit résoudre, et UNIQUEMENT vers des adresses publiques (A et AAAA) : un nom quelconque peut pointer vers
 * 127.0.0.1 ou les métadonnées cloud. Refus si la résolution DNS n'est pas disponible (on ne télécharge pas à l'aveugle).
 * Limite assumée : fetch résout à nouveau (rebinding DNS non couvert), réduit par la rareté du cas et le type vérifié.
 */
async function verifierDns(url: string): Promise<void> {
  const hote = new URL(url).hostname;
  // deno-lint-ignore no-explicit-any
  const resoudre = (Deno as any).resolveDns as ((h: string, t: string) => Promise<string[]>) | undefined;
  if (typeof resoudre !== "function") throw new Error("vérification DNS indisponible");
  const adresses: string[] = [];
  for (const type of ["A", "AAAA"]) {
    try { adresses.push(...await resoudre(hote, type)); } catch { /* pas d'enregistrement de ce type */ }
  }
  if (!adresses.length) throw new Error("nom de domaine introuvable");
  if (adresses.some((ip) => adresseIpPrivee(ip))) throw new Error("adresse refusée (réseau privé)");
}

/**
 * GET d'une URL publique : redirections suivies à la main (chaque saut revérifié : forme ET DNS), corps lu jusqu'à
 * `max` octets, jamais au-delà de l'`echeance` globale de la requête. `apercu` : lit le début (signature) puis coupe.
 */
async function telecharger(url: string, max: number, echeance: number, apercu = false): Promise<{ octets: Uint8Array; type: string; url: string }> {
  let courante = url;
  for (let saut = 0; saut < 5; saut++) {
    if (!urlPublique(courante)) throw new Error("adresse refusée (non publique)");
    const reste = echeance - Date.now();
    if (reste < 1_500) throw new Error("temps écoulé, vérification non faite");
    await verifierDns(courante);
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), Math.min(20_000, echeance - Date.now()));
    try {
      const rep = await fetch(courante, {
        redirect: "manual", signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Majordhome/1.0; +https://majordhome.vercel.app)", Accept: "*/*" },
      });
      if (rep.status >= 300 && rep.status < 400) {
        const loc = rep.headers.get("location");
        await rep.body?.cancel();
        if (!loc) throw new Error(`redirection ${rep.status} sans destination`);
        courante = new URL(loc, courante).toString();
        continue;
      }
      if (!rep.ok) { await rep.body?.cancel(); throw new Error(`le site a répondu ${rep.status}`); }
      const annonce = Number(rep.headers.get("content-length") || 0);
      if (annonce > max) { await rep.body?.cancel(); throw new Error(`fichier trop lourd (${Math.round(annonce / 1048576)} Mo)`); }
      const lecteur = rep.body?.getReader();
      const morceaux: Uint8Array[] = [];
      let total = 0;
      if (lecteur) {
        while (true) {
          const { done, value } = await lecteur.read();
          if (done) break;
          total += value.length;
          if (total > max) { await lecteur.cancel(); throw new Error(`fichier trop lourd (plus de ${Math.round(max / 1048576)} Mo)`); }
          morceaux.push(value);
          if (apercu && total >= 1024) { await lecteur.cancel(); break; }
        }
      }
      const octets = new Uint8Array(total);
      let pos = 0;
      for (const m of morceaux) { octets.set(m.subarray(0, Math.min(m.length, total - pos)), pos); pos += m.length; }
      return { octets, type: (rep.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(), url: courante };
    } finally {
      clearTimeout(minuterie);
    }
  }
  throw new Error("trop de redirections");
}

async function verifierPhoto(url: string | null, echeance: number): Promise<string | null> {
  if (!url) return "aucune photo trouvée";
  try {
    const r = await telecharger(url, PHOTO_MAX, echeance, true);
    return TYPES_IMAGE[r.type] ? null : `le lien ne renvoie pas une image (${r.type || "type inconnu"})`;
  } catch (e) { return (e as Error).message; }
}

async function verifierFiche(url: string | null, echeance: number): Promise<string | null> {
  if (!url) return "aucune fiche technique trouvée";
  try {
    const r = await telecharger(url, PDF_MAX, echeance, true);
    return estPdf(r.octets) ? null : "le lien ne renvoie pas un PDF";
  } catch (e) { return (e as Error).message; }
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  const echeance = Date.now() + ECHEANCE_MS;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const orgId = typeof body.org_id === "string" ? body.org_id : "";
  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  const action = body.action === "apply" ? "apply" : body.action === "propose" ? "propose" : "";
  if (!orgId || !UUID.test(itemId) || !action) return jsonResponse({ error: "org_id, item_id et action (propose | apply) requis" }, 400, req);

  const auth = await requireOrgMembership(req, { orgId });
  if (!auth.ok) return auth.response;

  // client au jeton de l'utilisateur : la RLS (articles.edit) protège toutes les lectures et écritures
  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // droit articles.edit (registre de permissions, surcharges de l'org comprises) pour propose ET apply ; garde positive
  const { data: autorise, error: errDroit } = await user.rpc("user_can", { p_org_id: orgId, p_resource: "articles", p_action: "edit" });
  if (errDroit || autorise !== true) return jsonResponse({ error: "Forbidden: articles.edit" }, 403, req);

  try {
    const { data: item, error: errItem } = await user.from("majordhome_catalog_items")
      .select("id, org_id, name, brand, gamme, model_key, category, image_url, specs")
      .eq("id", itemId).eq("org_id", orgId).maybeSingle();
    if (errItem) return jsonResponse({ error: errItem.message }, 500, req);
    if (!item) return jsonResponse({ error: "article introuvable" }, 404, req);

    if (action === "propose") {
      if (!ANTHROPIC_API_KEY) return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500, req);
      const champs = champsPropres(body.champs);
      const { data: lignes, error: errL } = await user.from("majordhome_supplier_products")
        .select("reference").eq("org_id", orgId).eq("catalog_item_id", itemId).limit(20);
      if (errL) return jsonResponse({ error: errL.message }, 500, req);
      const references = [...new Set((lignes || []).map((l: { reference: string | null }) => l.reference).filter(Boolean))] as string[];
      const prompt = construirePromptEnrichissement({ ...item, references }, champs);

      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
      const ctrl = new AbortController();
      const minuterie = setTimeout(() => ctrl.abort(), Math.min(DUREE_IA_MS, echeance - Date.now() - 15_000));
      // deno-lint-ignore no-explicit-any
      const messages: any[] = [{ role: "user", content: prompt }];
      // deno-lint-ignore no-explicit-any
      let final: any = null;
      // consommation détaillée, journalisée à chaque appel (coût = tokens + recherches web, facturées à part)
      const conso = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0, web_fetch_requests: 0, tours: 0 };
      try {
        for (let i = 0; i <= REPRISES_MAX; i++) {
          // fallbacks "default" : un refus des garde-fous est rejoué côté serveur sur le modèle recommandé
          // deno-lint-ignore no-explicit-any
          const params: any = {
            model: MODEL, max_tokens: 16000,
            thinking: { type: "adaptive" }, output_config: { effort: "medium" },
            tools: [
              { type: "web_search_20260209", name: "web_search", max_uses: 6 },
              { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
            ],
            messages, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
          };
          final = await client.beta.messages.stream(params, { signal: ctrl.signal }).finalMessage();
          const u = final.usage || {};
          conso.input_tokens += u.input_tokens || 0;
          conso.output_tokens += u.output_tokens || 0;
          conso.cache_read_input_tokens += u.cache_read_input_tokens || 0;
          conso.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
          conso.web_search_requests += u.server_tool_use?.web_search_requests || 0;
          conso.web_fetch_requests += u.server_tool_use?.web_fetch_requests || 0;
          conso.tours += 1;
          if (final.stop_reason !== "pause_turn") break;
          messages.push({ role: "assistant", content: final.content });
        }
      } catch (e) {
        if (ctrl.signal.aborted) return jsonResponse({ error: "recherche trop longue : réessayez" }, 504, req);
        throw e;
      } finally {
        clearTimeout(minuterie);
      }
      const tokens = conso.input_tokens + conso.output_tokens;
      console.log("[catalog-item-enrich] conso", JSON.stringify({ org: orgId, item: itemId, modele: final?.model ?? MODEL, stop: final?.stop_reason, ...conso }));
      if (final?.stop_reason === "refusal") return jsonResponse({ error: "recherche refusée par les garde-fous du modèle" }, 422, req);
      if (final?.stop_reason === "pause_turn") return jsonResponse({ error: "recherche inachevée : réessayez" }, 504, req);
      // deno-lint-ignore no-explicit-any
      const texte = (final?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      const proposition = lireProposition(texte, champs);
      if (proposition.erreur) return jsonResponse({ error: "réponse de l'IA illisible : réessayez", tokens }, 502, req);

      const [photoRefus, ficheRefus] = await Promise.all([verifierPhoto(proposition.photo_url, echeance), verifierFiche(proposition.fiche_url, echeance)]);
      return jsonResponse({
        ok: true, ...proposition, photo_refus: photoRefus, fiche_refus: ficheRefus, modele: final?.model ?? MODEL, tokens, conso,
      }, 200, req);
    }

    // ---- apply ----
    const erreurs: string[] = [];
    // deno-lint-ignore no-explicit-any
    const patch: Record<string, any> = {};
    let photo: string | null = null;
    // deno-lint-ignore no-explicit-any
    let document: any = null;
    const base = `${orgId}/articles/${itemId}`;

    if (typeof body.photo_url === "string" && body.photo_url) {
      try {
        const r = await telecharger(body.photo_url, PHOTO_MAX, echeance);
        const ext = TYPES_IMAGE[r.type];
        if (!ext) throw new Error(`le lien ne renvoie pas une image (${r.type || "type inconnu"})`);
        const chemin = `${base}/${crypto.randomUUID()}.${ext}`;
        const { error } = await user.storage.from("product-images").upload(chemin, r.octets, { contentType: r.type, upsert: false });
        if (error) throw new Error(error.message);
        photo = user.storage.from("product-images").getPublicUrl(chemin).data.publicUrl;
        patch.image_url = photo;
      } catch (e) { erreurs.push(`Photo : ${(e as Error).message}`); }
    }

    if (typeof body.fiche_url === "string" && body.fiche_url) {
      try {
        const r = await telecharger(body.fiche_url, PDF_MAX, echeance);
        if (!estPdf(r.octets)) throw new Error("le lien ne renvoie pas un PDF");
        const chemin = `${base}/${crypto.randomUUID()}.pdf`;
        const { error: errUp } = await user.storage.from("product-documents").upload(chemin, r.octets, { contentType: "application/pdf", upsert: false });
        if (errUp) throw new Error(errUp.message);
        const { data: doc, error: errDoc } = await user.from("majordhome_product_documents_write").insert({
          catalog_item_id: itemId, org_id: orgId, document_type: "Fiche technique",
          file_name: nomDeFichier(r.url, `Fiche technique ${item.name}`.slice(0, 100)), storage_path: chemin,
          file_size: r.octets.length, mime_type: "application/pdf", uploaded_by: auth.userId,
        }).select("id, file_name").single();
        if (errDoc) {
          await user.storage.from("product-documents").remove([chemin]);
          throw new Error(errDoc.message);
        }
        document = doc;
      } catch (e) { erreurs.push(`Fiche technique : ${(e as Error).message}`); }
    }

    const acceptees = specsPropres(body.specs);
    const nbSpecs = Object.keys(acceptees).length;
    if (nbSpecs) {
      const specs = (item.specs && typeof item.specs === "object") ? item.specs : {};
      patch.specs = { ...specs, canonical: fusionnerSpecs(specs.canonical || {}, acceptees) };
    }

    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      const { data: maj, error: errMaj } = await user.from("majordhome_catalog_items").update(patch)
        .eq("id", itemId).eq("org_id", orgId).select("id").maybeSingle();
      if (errMaj || !maj) {
        erreurs.push(`Article : ${errMaj?.message || "modification refusée"}`);
        photo = null;
      }
    }

    return jsonResponse({
      ok: erreurs.length === 0, photo, document, specs_appliquees: erreurs.some((e) => e.startsWith("Article")) ? 0 : nbSpecs, erreurs,
    }, 200, req);
  } catch (e) {
    console.error("[catalog-item-enrich]", e);
    return jsonResponse({ error: sanitizeError(e, "catalog-item-enrich failed") }, 500, req);
  }
});
