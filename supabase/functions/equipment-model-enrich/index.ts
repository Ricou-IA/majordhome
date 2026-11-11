// supabase/functions/equipment-model-enrich/index.ts
// ============================================================================
// equipment-model-enrich — recherche web d'un APPAREIL INSTALLÉ saisi sur le terrain, puis création de la fiche
// validée sur place (référentiel des appareils, état « à contrôler » dans la file org_admin).
// Spec : docs/superpowers/specs/2026-11-11-referentiel-appareils-installes-saisie-terrain-design.md § 4-5.
// ============================================================================
// verify_jwt:true + requireOrgMembership + user_can(clients, edit) (le droit de saisir un équipement). Deux actions :
//   - chercher : plafond par utilisateur et par jour AVANT l'appel IA ; Claude + recherche web propose jusqu'à 3
//     appareils ; chaque photo / notice / fiche est vérifiée (image ou PDF réellement servi). RIEN n'est écrit.
//     Body { action:'chercher', org_id, brand, model, type_label?, champs:[{key,label,unit,type,options?}] }.
//   - creer : la fiche telle que validée par l'intervenant est relue (rien n'est cru sur parole), photo et documents
//     téléchargés vers product-documents/${org}/equipment-models/web/, puis RPC equipment_model_create_from_web
//     (service_role seul, tout ou rien, dédoublonnée par marque + référence). Un fichier refusé n'empêche pas la fiche
//     (avertissement) ; un échec de la RPC, ou une fiche qui existait déjà, retire les fichiers déposés.
//     Body { action:'creer', org_id, appareil, equipment_type_id?, champs }.
// Env : ANTHROPIC_API_KEY, ANTHROPIC_ENRICH_MODEL (défaut claude-sonnet-5-5), EQUIPMENT_ENRICH_DAILY_LIMIT (20),
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError, getAdminClient } from "../_shared/auth.ts";
import { estPdf, nomDeFichier } from "../_shared/catalogue/enrichissement.js";
import { construirePromptAppareil, lireAppareils } from "../_shared/catalogue/enrichissementAppareil.js";
import { PHOTO_MAX, PDF_MAX, TYPES_IMAGE, champsPropres, telecharger, verifierPhoto, verifierFiche } from "../_shared/telechargement.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("ANTHROPIC_ENRICH_MODEL") || "claude-sonnet-5-5";
const LIMITE_JOUR = Number(Deno.env.get("EQUIPMENT_ENRICH_DAILY_LIMIT") || 20) || 20;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const DUREE_IA_MS = 115_000;
const ECHEANCE_MS = 140_000;
const REPRISES_MAX = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "product-documents";

const texte = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const erreur = (req: Request, status: number, message: string, code: string) => jsonResponse({ error: message, code }, status, req);

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  const echeance = Date.now() + ECHEANCE_MS;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const orgId = typeof body.org_id === "string" ? body.org_id : "";
  const action = body.action === "chercher" || body.action === "creer" ? body.action : "";
  if (!UUID.test(orgId) || !action) return erreur(req, 400, "org_id et action (chercher | creer) requis", "entree");

  const auth = await requireOrgMembership(req, { orgId });
  if (!auth.ok) return auth.response;

  // droit de saisir un équipement (grille des droits de l'org) ; garde positive
  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: autorise, error: errDroit } = await user.rpc("user_can", { p_org_id: orgId, p_resource: "clients", p_action: "edit" });
  if (errDroit || autorise !== true) return erreur(req, 403, "Droit de modifier les fiches client requis", "droit");

  const admin = getAdminClient();
  const champs = champsPropres(body.champs);

  try {
    if (action === "chercher") {
      const brand = texte(body.brand, 80);
      const model = texte(body.model, 120);
      if (!brand || !model) return erreur(req, 400, "Marque et modèle requis", "entree");
      if (!ANTHROPIC_API_KEY) return erreur(req, 500, "ANTHROPIC_API_KEY not configured", "config");

      const { error: errQuota } = await admin.rpc("increment_equipment_enrich_quota", { p_user_id: auth.userId, p_org_id: orgId, p_daily_limit: LIMITE_JOUR });
      if (errQuota) {
        if (errQuota.code === "P0001") return erreur(req, 429, `${LIMITE_JOUR} recherches web par jour atteintes`, "quota");
        throw errQuota;
      }

      const prompt = construirePromptAppareil({ brand, model, typeLabel: texte(body.type_label, 80) || null }, champs);
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
      const ctrl = new AbortController();
      const minuterie = setTimeout(() => ctrl.abort(), Math.min(DUREE_IA_MS, echeance - Date.now() - 15_000));
      // deno-lint-ignore no-explicit-any
      const messages: any[] = [{ role: "user", content: prompt }];
      // deno-lint-ignore no-explicit-any
      let final: any = null;
      const conso = { input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0, tours: 0 };
      try {
        for (let i = 0; i <= REPRISES_MAX; i++) {
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
          conso.web_search_requests += u.server_tool_use?.web_search_requests || 0;
          conso.web_fetch_requests += u.server_tool_use?.web_fetch_requests || 0;
          conso.tours += 1;
          if (final.stop_reason !== "pause_turn") break;
          messages.push({ role: "assistant", content: final.content });
        }
      } catch (e) {
        if (ctrl.signal.aborted) return erreur(req, 504, "La recherche a pris trop de temps : réessayez", "delai");
        throw e;
      } finally {
        clearTimeout(minuterie);
      }
      console.log("[equipment-model-enrich] conso", JSON.stringify({ org: orgId, modele: final?.model ?? MODEL, stop: final?.stop_reason, ...conso }));
      if (final?.stop_reason === "refusal") return erreur(req, 422, "Recherche refusée par les garde-fous du modèle", "refus");
      if (final?.stop_reason === "pause_turn") return erreur(req, 504, "Recherche inachevée : réessayez", "delai");
      // deno-lint-ignore no-explicit-any
      const reponse = (final?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      const lu = lireAppareils(reponse, champs);
      if (lu.erreur === "reponse_illisible") return erreur(req, 502, "Réponse de la recherche illisible : réessayez", "illisible");
      if (lu.erreur === "aucun_appareil") return jsonResponse({ ok: true, appareils: [] }, 200, req);

      const appareils = await Promise.all(lu.appareils.map(async (a) => {
        const [photo_refus, notice_refus, fiche_refus] = await Promise.all([
          a.photo_url ? verifierPhoto(a.photo_url, echeance) : Promise.resolve(null),
          a.notice_url ? verifierFiche(a.notice_url, echeance, "aucune notice trouvée") : Promise.resolve(null),
          a.fiche_url ? verifierFiche(a.fiche_url, echeance) : Promise.resolve(null),
        ]);
        return {
          ...a,
          photo_url: photo_refus ? null : a.photo_url, notice_url: notice_refus ? null : a.notice_url, fiche_url: fiche_refus ? null : a.fiche_url,
          photo_refus, notice_refus, fiche_refus,
        };
      }));
      return jsonResponse({ ok: true, appareils, modele: final?.model ?? MODEL }, 200, req);
    }

    // ---- creer ----
    const relu = lireAppareils(JSON.stringify({ appareils: [body.appareil] }), champs);
    if (relu.erreur || !relu.appareils.length) return erreur(req, 400, "Appareil incomplet : marque et modèle requis", "entree");
    const a = relu.appareils[0];
    const typeId = typeof body.equipment_type_id === "string" && UUID.test(body.equipment_type_id) ? body.equipment_type_id : null;
    const base = `${orgId}/equipment-models/web`;
    const deposes: string[] = [];
    const avertissements: string[] = [];
    let photoPath: string | null = null;
    const documents: Record<string, unknown>[] = [];

    if (a.photo_url) {
      try {
        const r = await telecharger(a.photo_url, PHOTO_MAX, echeance);
        const ext = TYPES_IMAGE[r.type];
        if (!ext) throw new Error(`le lien ne renvoie pas une image (${r.type || "type inconnu"})`);
        const chemin = `${base}/${crypto.randomUUID()}.${ext}`;
        const { error } = await admin.storage.from(BUCKET).upload(chemin, r.octets, { contentType: r.type, upsert: false });
        if (error) throw new Error(error.message);
        deposes.push(chemin);
        photoPath = chemin;
      } catch (e) { avertissements.push(`Photo : ${(e as Error).message}`); }
    }
    for (const [url, type, libelle] of [[a.notice_url, "notice", "Notice"], [a.fiche_url, "fiche_technique", "Fiche technique"]] as const) {
      if (!url) continue;
      try {
        const r = await telecharger(url, PDF_MAX, echeance);
        if (!estPdf(r.octets)) throw new Error("le lien ne renvoie pas un PDF");
        const chemin = `${base}/${crypto.randomUUID()}.pdf`;
        const { error } = await admin.storage.from(BUCKET).upload(chemin, r.octets, { contentType: "application/pdf", upsert: false });
        if (error) throw new Error(error.message);
        deposes.push(chemin);
        documents.push({
          storage_path: chemin, document_type: type, label: `${libelle} ${a.model_name}`.slice(0, 120),
          file_name: nomDeFichier(r.url, `${libelle} ${a.model_name}`.slice(0, 100)), file_size: r.octets.length, url,
        });
      } catch (e) { avertissements.push(`${libelle} : ${(e as Error).message}`); }
    }

    const retirerDeposes = async () => { if (deposes.length) await admin.storage.from(BUCKET).remove(deposes); };
    const { data: res, error: errRpc } = await admin.rpc("equipment_model_create_from_web", {
      p_org_id: orgId, p_user_id: auth.userId,
      p_fiche: {
        brand: a.brand, model_name: a.model_name, reference: a.reference, category: a.category, en_vente: a.en_vente,
        equipment_type_id: typeId, specs: a.specs, source_urls: a.source_urls,
      },
      p_files: { photo_path: photoPath, documents },
    });
    if (errRpc) {
      await retirerDeposes();
      return erreur(req, 500, `La fiche n'a pas pu être créée : ${errRpc.message}`, "creation");
    }
    if (res?.existante) await retirerDeposes();
    return jsonResponse({
      ok: true, model_id: res?.model_id, created: !!res?.created, existante: !!res?.existante,
      avertissements: res?.existante ? [] : avertissements,
    }, 200, req);
  } catch (e) {
    console.error("[equipment-model-enrich]", e);
    return jsonResponse({ error: sanitizeError(e, "equipment-model-enrich failed"), code: "interne" }, 500, req);
  }
});
