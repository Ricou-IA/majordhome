// supabase/functions/baikal-admin/index.ts
// ============================================================================
// baikal-admin — canal d'administration de Majord'home par Baikal (console d'admin)
// ============================================================================
// Contrat : docs/superpowers/specs/2026-09-26-baikal-admin-modules-majordhome-design.md § 4.
// verify_jwt:false : Baikal envoie l'anon key PUBLIQUE (gateway) ; l'autorisation réelle
// est le secret partagé `X-Baikal-Key` = MDH_BAIKAL_KEY (requireHeaderSecret, temps constant).
//
// Actions (POST { action, ... }) :
//   manifeste      → { app, version, actions }
//   catalogue      → { modules: [{ key, label, description, parDefaut }] } (registre _shared/modules.js)
//   organisations  → { organisations: [{ id, nom, modules }] } (état EFFECTIF, défauts appliqués)
//   modules        → { org_id, modules: { [key]: boolean }, auteur } ⇒ RPC org_set_modules
//                    (service_role only, journal majordhome.org_modules_journal)
// Les clés de modules sont validées contre le catalogue (validerModules) AVANT d'écrire.
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_BAIKAL_KEY.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  requireHeaderSecret,
  jsonResponse,
  buildCorsHeaders,
  getAdminClient,
  sanitizeError,
} from "../_shared/auth.ts";
import { CATALOGUE, modulesEffectifs, validerModules } from "../_shared/modules.js";

const MDH_BAIKAL_KEY = Deno.env.get("MDH_BAIKAL_KEY") || "";
const ACTIONS = ["manifeste", "catalogue", "organisations", "modules"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, req);

  const authError = requireHeaderSecret(req, "X-Baikal-Key", MDH_BAIKAL_KEY, "MDH_BAIKAL_KEY");
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_body", detail: "JSON attendu" }, 400, req);
  }
  const action = typeof body?.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "manifeste":
        return jsonResponse({ app: "majordhome", version: 1, actions: ACTIONS }, 200, req);

      case "catalogue":
        return jsonResponse({
          modules: CATALOGUE.map(({ key, label, description, parDefaut }) => ({ key, label, description, parDefaut })),
        }, 200, req);

      case "organisations": {
        const admin = getAdminClient();
        const { data, error } = await admin.schema("core").from("organizations")
          .select("id, name, settings").order("name");
        if (error) return jsonResponse({ error: sanitizeError(error, "organisations illisibles") }, 500, req);
        return jsonResponse({
          organisations: (data || []).map((o: { id: string; name: string | null; settings: Record<string, unknown> | null }) => ({
            id: o.id,
            nom: o.name,
            modules: modulesEffectifs(o.settings || {}),
          })),
        }, 200, req);
      }

      case "modules": {
        const orgId = typeof body.org_id === "string" ? body.org_id : "";
        if (!UUID.test(orgId)) return jsonResponse({ error: "invalid_body", detail: "org_id : uuid attendu" }, 400, req);
        const v = validerModules(body.modules);
        if (!v.ok) {
          return v.erreur === "unknown_module"
            ? jsonResponse({ error: "unknown_module", detail: v.inconnues }, 400, req)
            : jsonResponse({ error: "invalid_body", detail: "modules : objet non vide de booléens" }, 400, req);
        }
        const auteur = typeof body.auteur === "string" ? body.auteur.slice(0, 200) : null;

        const admin = getAdminClient();
        const { data, error } = await admin.rpc("org_set_modules", {
          p_org_id: orgId, p_modules: v.modules, p_auteur: auteur,
        });
        if (error) {
          if (error.code === "P0002") return jsonResponse({ error: "org_not_found" }, 404, req);
          if (error.code === "22023") return jsonResponse({ error: "invalid_body", detail: error.message }, 400, req);
          return jsonResponse({ error: sanitizeError(error, "écriture impossible") }, 500, req);
        }
        const res = data as { id: string; nom: string | null; modules: Record<string, boolean> };
        return jsonResponse({
          organisation: { id: res.id, nom: res.nom, modules: modulesEffectifs({ modules: res.modules }) },
        }, 200, req);
      }

      default:
        return jsonResponse({ error: "unknown_action", detail: ACTIONS }, 400, req);
    }
  } catch (err) {
    return jsonResponse({ error: sanitizeError(err, "baikal-admin failed") }, 500, req);
  }
});
