// supabase/functions/member-reset-password/index.ts
// ============================================================================
// member-reset-password — mot de passe provisoire posé par un org_admin sur un
// membre de SA propre organisation (Settings → Équipe → fiche membre).
//
// Pourquoi : les membres Mayer ont souvent un e-mail factice, le lien « Mot de
// passe oublié » ne leur sert à rien ; jusqu'au 2026-10-26 il fallait un script
// hors de l'app avec la clé service_role.
//
// Règles :
//  - verify_jwt:true + requireOrgMembership(org_id, org_admin) : l'org_id du corps
//    est RECOUPÉ avec la membership de l'appelant, jamais pris pour argent comptant ;
//  - la cible doit être membre de la MÊME org (core.organization_members), sinon 404 —
//    on ne révèle pas si l'utilisateur existe ailleurs sur l'instance partagée ;
//  - auth.admin.updateUserById (service_role), `{ error }` lu → 500 explicite ;
//  - le mot de passe n'est ni stocké ni journalisé (aucun console.log du corps).
// Gotcha vérifié le 2026-10-26 : le changement révoque toutes les sessions serveur
// du membre ; le client retombe proprement sur l'écran de connexion (c71a9983).
//
// Body : { org_id, user_id, password }  →  { success: true }
// ============================================================================
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";

const PASSWORD_MIN_LENGTH = 8;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const orgId = typeof body.org_id === "string" ? body.org_id : "";
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!orgId || !userId) return jsonResponse({ error: "org_id et user_id requis" }, 400, req);
  if (password.length < PASSWORD_MIN_LENGTH) {
    return jsonResponse({ error: `Mot de passe trop court (${PASSWORD_MIN_LENGTH} caractères minimum)` }, 400, req);
  }

  const auth = await requireOrgMembership(req, { orgId, requiredRole: "org_admin" });
  if (!auth.ok) return auth.response;
  const admin = auth.supabase;

  try {
    // Cible = membre de la même org que l'appelant (org validée par la membership, pas par le corps).
    const { data: target, error: targetError } = await admin
      .schema("core")
      .from("organization_members")
      .select("user_id")
      .eq("org_id", auth.orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (targetError) return jsonResponse({ error: `Adhésion illisible : ${targetError.message}` }, 500, req);
    if (!target) return jsonResponse({ error: "Ce membre n'appartient pas à votre organisation" }, 404, req);

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
    if (updateError) {
      console.error("[member-reset-password] updateUserById:", updateError.message);
      return jsonResponse({ error: `Mot de passe non modifié : ${updateError.message}` }, 500, req);
    }

    console.log(`[member-reset-password] org=${auth.orgId} by=${auth.userId} target=${userId}`);
    return jsonResponse({ success: true }, 200, req);
  } catch (err) {
    console.error("[member-reset-password] unexpected:", err);
    return jsonResponse({ error: sanitizeError(err, "Erreur interne") }, 500, req);
  }
});
