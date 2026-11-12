// assistant-pieces — l'assistant « Trouver une pièce » : recherche d'une pièce détachée sur le web par Hermes
// (agent externe, VPS), depuis la fiche d'un appareil ou d'une demande SAV.
// Spec : docs/superpowers/specs/2026-11-11-assistant-pieces-sav-hermes-design.md (§ 2 et § 4).
//
// verify_jwt:true + requireOrgMembership + module `assistant` actif + user_can(assistant_pieces, use). Actions
// FERMÉES, aucun relais générique vers Hermes :
//
//   - lancer { equipment_id, intervention_id?, demande }  → { id }
//       relit l'appareil EN BASE (équipement, type, fiche modèle) et le client (pour le seul contrôle de la demande),
//       refuse une demande qui contient une donnée du client, consomme le quota, ouvre la ligne, démarre le run.
//   - suivre { id }                                        → { id, statut, reponse, texte, erreur, created_at, finished_at }
//       relit la ligne (org de l'appelant), la fait avancer si elle est en cours, la relit.
//
// Règle qui tient tout : la consigne envoyée à Hermes ne porte QUE l'appareil et la demande. Le client est lu pour
// controlerDemande et jamais placé dans la consigne, dans un journal ni dans la ligne rangée.
//
// Réponses : HTTP 200 { data, error } où `error` est un CODE (assistantPieces.js::CODES), traduit côté écran. Les
// refus d'authentification gardent leurs 401/403 ; une panne inattendue répond 500 (sanitizeError).
//
// Secrets / env : MDH_HERMES_URL, MDH_HERMES_KEY, ASSISTANT_PIECES_DAILY_LIMIT (défaut 10),
// ASSISTANT_PIECES_PLAQUE (`on` = la photo de la plaque est envoyée par lien signé 15 min ; sinon jamais).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import { moduleActif } from "../_shared/modules.js";
import { appareilConnu, controlerDemande, construireConsigne } from "../_shared/assistantPieces.js";
import { demarrerRun, hermesConfigure, suivreRecherche } from "../_shared/assistantHermes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const LIMITE_JOUR = Number(Deno.env.get("ASSISTANT_PIECES_DAILY_LIMIT") || 10) || 10;
const PLAQUE_ACTIVE = Deno.env.get("ASSISTANT_PIECES_PLAQUE") === "on";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET_PLAQUE = "certificats";
const DUREE_LIEN_PLAQUE_S = 900;
const COLONNES_LIGNE = "id, statut, reponse, texte_brut, erreur, run_id, created_at, finished_at";

type Equipement = {
  id: string; project_id: string | null; brand: string | null; model: string | null; serial_number: string | null;
  nameplate_photo_path: string | null; equipment_type_id: string | null; equipment_model_id: string | null;
};
type Ligne = {
  id: string; statut: string; reponse: unknown; texte_brut: string | null; erreur: string | null;
  run_id: string | null; created_at: string; finished_at: string | null;
};

const uuidOuVide = (v: unknown): string => (typeof v === "string" && UUID.test(v) ? v : "");

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const orgId = typeof body.org_id === "string" ? body.org_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!UUID.test(orgId)) return jsonResponse({ error: "org_id requis" }, 400, req);

  const auth = await requireOrgMembership(req, { orgId });
  if (!auth.ok) return auth.response;
  const admin = auth.supabase; // service_role : chaque lecture ci-dessous filtre l'org validée (org CORE)

  const ok = (data: unknown) => jsonResponse({ data, error: null }, 200, req);
  const refus = (code: string) => jsonResponse({ data: null, error: code }, 200, req);

  try {
    // Module de l'offre, ouvert par organisation (Baikal) : fermé par défaut.
    const { data: org, error: errOrg } = await admin.schema("core").from("organizations")
      .select("settings").eq("id", orgId).maybeSingle();
    if (errOrg) throw errOrg;
    if (!moduleActif((org?.settings as Record<string, unknown> | null) ?? {}, "assistant")) return refus("module_ferme");

    // Droit au jeton de l'utilisateur (grille des droits de l'org) ; garde positive.
    const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: autorise, error: errDroit } = await user.rpc("user_can", {
      p_org_id: orgId, p_resource: "assistant_pieces", p_action: "use",
    });
    if (errDroit || autorise !== true) return refus("droit_requis");

    // ------------------------------------------------------------------ lancer
    if (action === "lancer") {
      const equipmentId = uuidOuVide(body.equipment_id);
      if (!equipmentId) return refus("equipement_introuvable");
      const interventionBrute = body.intervention_id;
      const interventionId = interventionBrute == null || interventionBrute === "" ? null : uuidOuVide(interventionBrute);
      if (interventionId === "") return refus("equipement_introuvable");
      // Rognée une fois : le texte contrôlé, rangé et envoyé est le même.
      const demande = typeof body.demande === "string" ? body.demande.trim() : "";

      // L'équipement, relu en base. La vue n'a pas d'org_id : l'org est celle de son projet (core.projects.org_id,
      // org CORE — la même dérivation que majordhome.project_org_id, utilisée par la RPC d'ouverture).
      const { data: eq, error: errEq } = await admin.from("majordhome_equipments")
        .select("id, project_id, brand, model, serial_number, nameplate_photo_path, equipment_type_id, equipment_model_id")
        .eq("id", equipmentId).maybeSingle();
      if (errEq) throw errEq;
      const equipement = eq as Equipement | null;
      if (!equipement?.project_id) return refus("equipement_introuvable");
      const { data: projet, error: errProjet } = await admin.schema("core").from("projects")
        .select("id").eq("id", equipement.project_id).eq("org_id", orgId).maybeSingle();
      if (errProjet) throw errProjet;
      if (!projet) return refus("equipement_introuvable");

      // Type, fiche modèle (org_id CORE sur les deux tables) et client du projet (clients.org_id CORE).
      const [typeLu, fiche, proprietaire] = await Promise.all([
        equipement.equipment_type_id
          ? admin.from("majordhome_pricing_equipment_types").select("label")
            .eq("id", equipement.equipment_type_id).eq("org_id", orgId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        equipement.equipment_model_id
          ? admin.from("majordhome_equipment_models").select("brand, reference, name")
            .eq("id", equipement.equipment_model_id).eq("org_id", orgId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        admin.from("majordhome_clients").select("first_name, last_name, company_name, phone, phone_secondary, email")
          .eq("project_id", equipement.project_id).eq("org_id", orgId).maybeSingle(),
      ]);
      if (typeLu.error) throw typeLu.error;
      if (fiche.error) throw fiche.error;
      if (proprietaire.error) throw proprietaire.error;

      const modele = fiche.data as { brand: string | null; reference: string | null; name: string | null } | null;
      const appareil = {
        type: (typeLu.data as { label: string | null } | null)?.label ?? undefined,
        marque: equipement.brand ?? undefined,
        modele: equipement.model ?? undefined,
        numero_serie: equipement.serial_number ?? undefined,
        fiche: modele ? { marque: modele.brand, reference: modele.reference, nom: modele.name } : null,
        a_plaque: Boolean(equipement.nameplate_photo_path),
      };
      if (!appareilConnu(appareil)) return refus("appareil_inconnu");

      // Le client ne sert qu'ici : il n'entre ni dans la consigne, ni dans un journal, ni dans la ligne.
      const c = proprietaire.data as {
        first_name: string | null; last_name: string | null; company_name: string | null;
        phone: string | null; phone_secondary: string | null; email: string | null;
      } | null;
      const ecart = controlerDemande(demande, c ? {
        nom: c.last_name, prenom: c.first_name, societe: c.company_name,
        telephone: c.phone, telephone2: c.phone_secondary, email: c.email,
      } : null);
      if (ecart) return refus(ecart);

      if (!hermesConfigure()) {
        console.error("[assistant-pieces] MDH_HERMES_URL ou MDH_HERMES_KEY absent");
        return refus("assistant_indisponible");
      }

      // Tous les contrôles gratuits sont passés : le quota est consommé maintenant, puis la ligne est ouverte.
      const { error: errQuota } = await admin.rpc("increment_assistant_quota", {
        p_user_id: auth.userId, p_org_id: orgId, p_daily_limit: LIMITE_JOUR,
      });
      if (errQuota) {
        if (errQuota.code === "P0001") return refus("quota_atteint");
        throw errQuota;
      }

      const { data: idRecherche, error: errOuvrir } = await admin.rpc("assistant_recherche_ouvrir", {
        p_org_id: orgId, p_equipment_id: equipmentId, p_intervention_id: interventionId,
        p_demande: demande, p_user_id: auth.userId,
      });
      if (errOuvrir) {
        if (errOuvrir.code === "P0002") return refus("equipement_introuvable"); // équipement ou intervention
        if (errOuvrir.code === "22023") return refus("demande_vide");
        if (errOuvrir.code === "42501") return refus("droit_requis");
        throw errOuvrir;
      }
      if (typeof idRecherche !== "string" || !UUID.test(idRecherche)) throw new Error("assistant_recherche_ouvrir sans id");

      // Photo de la plaque : seulement si la lecture en a été prouvée (ASSISTANT_PIECES_PLAQUE=on) et si le chemin
      // est bien rangé sous l'org. Lien signé 15 min ; un échec n'empêche pas la recherche.
      let plaqueUrl: string | null = null;
      const chemin = equipement.nameplate_photo_path;
      if (PLAQUE_ACTIVE && chemin && chemin.startsWith(`${orgId}/`)) {
        const { data: signe, error: errSigne } = await admin.storage.from(BUCKET_PLAQUE).createSignedUrl(chemin, DUREE_LIEN_PLAQUE_S);
        if (errSigne) console.error(`[assistant-pieces] lien de la plaque impossible : ${sanitizeError(errSigne, "erreur storage")}`);
        plaqueUrl = signe?.signedUrl ?? null;
      }

      const consigne = construireConsigne({ appareil, demande, plaqueUrl });
      const run = await demarrerRun(consigne, idRecherche);
      if ("indisponible" in run) {
        // Le quota reste consommé : la ligne en échec garde la trace de la tentative.
        const { error: errClore } = await admin.rpc("assistant_recherche_clore", {
          p_id: idRecherche, p_statut: "echec", p_reponse: null, p_texte: null, p_usage: null,
          p_erreur: "assistant_indisponible",
        });
        if (errClore) throw errClore;
        return refus("assistant_indisponible");
      }

      const { error: errAttacher } = await admin.rpc("assistant_recherche_attacher_run", {
        p_id: idRecherche, p_run_id: run.runId,
      });
      if (errAttacher) throw errAttacher; // la ligne sans run_id sera close en delai_depasse par `suivre`
      return ok({ id: idRecherche });
    }

    // ------------------------------------------------------------------ suivre
    if (action === "suivre") {
      const id = uuidOuVide(body.id);
      if (!id) return refus("recherche_introuvable");
      // Relue dans l'org de l'appelant AVANT toute RPC : clore / attacher n'en contrôlent pas l'org.
      const lire = async (): Promise<Ligne | null> => {
        const { data, error } = await admin.from("majordhome_assistant_recherches")
          .select(COLONNES_LIGNE).eq("id", id).eq("org_id", orgId).maybeSingle();
        if (error) throw error;
        return data as Ligne | null;
      };
      let ligne = await lire();
      if (!ligne) return refus("recherche_introuvable");
      if (ligne.statut === "en_cours") {
        await suivreRecherche(admin, { id: ligne.id, run_id: ligne.run_id, created_at: ligne.created_at });
        ligne = await lire();
        if (!ligne) return refus("recherche_introuvable");
      }
      return ok({
        id: ligne.id, statut: ligne.statut, reponse: ligne.reponse ?? null, texte: ligne.texte_brut ?? null,
        erreur: ligne.erreur ?? null, created_at: ligne.created_at, finished_at: ligne.finished_at ?? null,
      });
    }

    return refus("action_inconnue");
  } catch (e) {
    console.error(`[assistant-pieces] ${action || "?"} : ${sanitizeError(e, "erreur interne")}`);
    return jsonResponse({ error: sanitizeError(e, "erreur interne") }, 500, req);
  }
});
