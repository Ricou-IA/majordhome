// hesiasun-identite — liaison Majord'home → HésiaSun : l'identité de l'entreprise, saisie une fois ici.
// Spec : docs/superpowers/specs/2026-11-21-identite-entreprise-saisie-unique-hesiasun-design.md (lot 3)
//
// verify_jwt:true + requireOrgMembership (org_admin de l'organisation demandée). Actions FERMÉES :
//
//   - relier   { cle }  vérifie la clé auprès de HésiaSun (GET /organization), refuse un SIRET différent ou une
//                       entreprise déjà tenue par une autre liaison, range la clé au coffre (au jeton de
//                       l'utilisateur : org_secret_set contrôle org_admin), note la liaison. Rend l'identité des
//                       deux côtés pour que l'administrateur choisisse laquelle garder. Rien n'est envoyé.
//   - comparer          relit l'identité côté HésiaSun (choix resté en suspens).
//   - pousser           envoie l'identité ENREGISTRÉE (relue en base) ; le premier envoi ouvre la liaison.
//   - delier            prévient HésiaSun (DELETE /organization/liaison), retire la clé du coffre et l'état.
//
// L'adresse de HésiaSun vient du secret MDH_HESIASUN_URL ; la clé ne figure dans aucune réponse ni journal.
// Réponses : HTTP 200 { data, error, champs? } où `error` est un CODE (src/lib/organisation/liaisonHesiasun.js,
// CODES_LIAISON), traduit côté écran. Les refus d'authentification gardent leurs 401/403.
//
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, MDH_HESIASUN_URL.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import { appelerHesiasun, baseHesiasun, lireCle, lireReglages, noter, pousserIdentite } from "../_shared/hesiasunIdentite.ts";
import { CLE_COFFRE, lireEtatLiaison, lireReponseHesiasun } from "../_shared/organisation/liaisonHesiasun.js";
import { identitePourEnvoi } from "../_shared/organisation/identite.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLE = /^bk_live_[0-9a-f]{24,96}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const orgId = typeof body.org_id === "string" && UUID.test(body.org_id) ? body.org_id : null;
  if (!orgId) return jsonResponse({ error: "org_id requis" }, 400, req);

  const auth = await requireOrgMembership(req, { orgId, requiredRole: "org_admin" });
  if (!auth.ok) return auth.response;
  const admin = auth.supabase;
  const repondre = (data: unknown, error: string | null = null, champs?: Record<string, string>) =>
    jsonResponse({ data, error, ...(champs && Object.keys(champs).length ? { champs } : {}) }, 200, req);

  try {
    if (!baseHesiasun()) return repondre(null, "non_configure");
    // Coffre : écritures au jeton de l'utilisateur (org_secret_set / _delete vérifient org_admin par auth.uid()).
    const utilisateur = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false },
    });

    const reglages = await lireReglages(admin, orgId);
    if (!reglages) return repondre(null, "ecriture_refusee");
    const etat = lireEtatLiaison(reglages);

    switch (body.action) {
      case "relier": {
        const cle = typeof body.cle === "string" ? body.cle.trim() : "";
        if (!CLE.test(cle)) return repondre(null, "cle_invalide");

        const lu = await appelerHesiasun("GET", "/organization", cle);
        const reponse = lireReponseHesiasun(lu.statut, lu.json);
        if (!reponse.ok) return repondre(null, reponse.code);
        const labas = reponse.data as { name?: string; identite?: Record<string, string>; siret_verifie?: string | null; geree_par?: { liaison_id?: string } | null };

        // Une entreprise HésiaSun n'est tenue que par une liaison : la nôtre si elle existe déjà, sinon personne.
        const tenuePar = labas.geree_par?.liaison_id || null;
        if (tenuePar && tenuePar !== etat?.liaison_id) return repondre(null, "deja_reliee");

        const siretIci = identitePourEnvoi(reglages).identite.siret;
        const siretLabas = (labas.identite?.siret || labas.siret_verifie || "").replace(/\s/g, "");
        if (siretIci && siretLabas && siretIci !== siretLabas) return repondre(null, "siret_different");

        const { error: coffre } = await utilisateur.rpc("org_secret_set", { p_org_id: orgId, p_key: CLE_COFFRE, p_value: cle });
        if (coffre) return repondre(null, "ecriture_refusee");

        const suite = {
          liaison_id: tenuePar || crypto.randomUUID(),
          relie_le: new Date().toISOString(),
          entreprise: typeof labas.name === "string" ? labas.name.slice(0, 160) : "",
          ouverte: !!tenuePar,
          dernier_envoi_le: tenuePar ? etat?.dernier_envoi_le ?? null : null,
          erreur: null,
          erreur_champs: null,
          en_attente: false,
          en_attente_depuis: null,
        };
        if (!(await noter(admin, orgId, suite))) {
          await utilisateur.rpc("org_secret_delete", { p_org_id: orgId, p_key: CLE_COFFRE });
          return repondre(null, "ecriture_refusee");
        }
        return repondre({ etat: suite, identite_hesiasun: labas.identite || {} });
      }

      case "comparer": {
        if (!etat) return repondre(null, "non_reliee");
        const cle = await lireCle(admin, orgId);
        if (!cle) return repondre(null, "non_reliee");
        const lu = await appelerHesiasun("GET", "/organization", cle);
        const reponse = lireReponseHesiasun(lu.statut, lu.json);
        if (!reponse.ok) return repondre(null, reponse.code);
        return repondre({ etat, identite_hesiasun: (reponse.data as { identite?: unknown }).identite || {} });
      }

      case "pousser": {
        const r = await pousserIdentite(admin, orgId);
        if (r.ok) return repondre({ etat: r.etat });
        // Liaison rompue depuis HésiaSun : la clé ne sert plus, elle quitte le coffre.
        if (r.code === "liaison_rompue") await utilisateur.rpc("org_secret_delete", { p_org_id: orgId, p_key: CLE_COFFRE });
        return repondre(r.etat ? { etat: r.etat } : null, r.code, r.champs);
      }

      case "delier": {
        let prevenu = false;
        if (etat) {
          const cle = await lireCle(admin, orgId);
          if (cle) {
            const lu = await appelerHesiasun("DELETE", `/organization/liaison?liaison_id=${encodeURIComponent(etat.liaison_id)}`, cle);
            prevenu = lireReponseHesiasun(lu.statut, lu.json).ok;
          }
        }
        const { error: coffre } = await utilisateur.rpc("org_secret_delete", { p_org_id: orgId, p_key: CLE_COFFRE });
        if (coffre || !(await noter(admin, orgId, null))) return repondre(null, "ecriture_refusee");
        // HésiaSun injoignable : la liaison est défaite ici, mais ses champs y restent en lecture seule
        // jusqu'à « Reprendre la gestion ici ». On le dit.
        return repondre({ delie: true, hesiasun_prevenu: prevenu });
      }

      default:
        return repondre(null, "action_inconnue");
    }
  } catch (err) {
    return jsonResponse({ error: sanitizeError(err, "liaison HésiaSun : erreur interne") }, 500, req);
  }
});
