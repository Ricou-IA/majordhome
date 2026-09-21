// supabase/functions/create-user/index.ts
// ============================================================================
// Invitation d'un membre par un org_admin : compte auth + profil core.profiles +
// adhésion core.organization_members. La ressource planning (team_members) est
// posée ensuite par le front (RPC team_member_ensure_for_user, org_admin only).
//
// Réécrit le 2026-09-21 après un échec silencieux vécu : l'ancienne version
// écrivait via les vues publiques `profiles` (UPDATE d'une ligne qui n'existe pas —
// aucun trigger auth.users → profil) et `organization_members` (JOIN, non
// insérable : « cannot insert into view ») sans lire `{ error }`, puis renvoyait
// 201 « success ». Résultat : compte auth orphelin, membre invisible.
//
// Règles :
//  - écritures core via `.schema('core')` avec la clé service_role, `{ error }` lu
//    à chaque étape, réponse 500 explicite sinon ;
//  - idempotent : un email déjà inscrit (compte orphelin d'un essai raté) est
//    réutilisé et complété, jamais bloquant — le mot de passe existant est conservé ;
//  - l'adhésion est créée par le trigger core.sync_profile_org_membership à
//    l'insertion du profil, puis alignée ici sur le rôle demandé.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-app-name, apikey, content-type",
};

interface CreateUserRequest {
  email: string;
  password: string;
  fullName?: string;
  orgId?: string;
  appRole?: string;
  businessRole?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const errorResponse = (message: string, status = 400) => json({ error: message }, status);

/** Rôle d'adhésion (core.organization_members.role) dérivé du rôle applicatif. */
function membershipRoleFor(appRole: string): "org_admin" | "team_leader" | "member" {
  if (appRole === "org_admin") return "org_admin";
  if (appRole === "team_leader") return "team_leader";
  return "member";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !caller) return errorResponse("Unauthorized", 401);

    const { data: callerProfile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("app_role, org_id")
      .eq("id", caller.id)
      .single();
    if (profileError || !callerProfile) return errorResponse("Caller profile not found", 403);

    const body: CreateUserRequest = await req.json();
    const { email, password, fullName, orgId, appRole = "user", businessRole } = body;
    if (!email || !password) return errorResponse("Email and password are required", 400);

    const isSuperAdmin = callerProfile.app_role === "super_admin";
    const isOrgAdmin = callerProfile.app_role === "org_admin";
    if (!isSuperAdmin) {
      if (!isOrgAdmin) return errorResponse("User not allowed", 403);
      if (orgId && orgId !== callerProfile.org_id) {
        return errorResponse("Cannot create user in another organization", 403);
      }
      if (appRole === "super_admin" || appRole === "org_admin") {
        return errorResponse("Cannot assign this role", 403);
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName?.trim() || null;

    // 1. Compte auth — ou réutilisation d'un compte déjà inscrit (essai précédent raté)
    let newUserId: string;
    let reusedExistingAuthUser = false;
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: cleanName },
    });
    if (createError) {
      const alreadyExists = /already|exists|registered/i.test(createError.message);
      if (!alreadyExists) return errorResponse(createError.message, 400);
      const { data: listed, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) return errorResponse(`Compte existant introuvable : ${listError.message}`, 500);
      const existing = listed.users.find((u) => (u.email || "").toLowerCase() === cleanEmail);
      if (!existing) return errorResponse(createError.message, 400);
      // Un membre déjà rattaché à une org n'est pas « ré-invité » : on refuse plutôt que d'écraser.
      const { data: existingProfile } = await supabaseAdmin
        .schema("core").from("profiles").select("org_id").eq("id", existing.id).maybeSingle();
      if (existingProfile?.org_id && orgId && existingProfile.org_id !== orgId) {
        return errorResponse("Cet email appartient déjà à un membre d'une autre organisation", 409);
      }
      newUserId = existing.id;
      reusedExistingAuthUser = true;
    } else {
      newUserId = authData.user.id;
    }

    // 2. app_id de l'org (multi-app sur instance partagée)
    let orgAppId: string | null = null;
    if (orgId) {
      const { data: org, error: orgError } = await supabaseAdmin
        .schema("core").from("organizations").select("app_id").eq("id", orgId).single();
      if (orgError) return errorResponse(`Organisation introuvable : ${orgError.message}`, 400);
      orgAppId = org?.app_id ?? null;
    }

    // 3. Profil (INSERT — aucun trigger auth.users ne le crée). Le trigger
    //    core.sync_profile_org_membership pose l'adhésion à partir de org_id.
    const { error: upsertProfileError } = await supabaseAdmin
      .schema("core")
      .from("profiles")
      .upsert({
        id: newUserId,
        email: cleanEmail,
        full_name: cleanName,
        app_role: appRole,
        business_role: businessRole || null,
        org_id: orgId || null,
        app_id: orgAppId,
      }, { onConflict: "id" });
    if (upsertProfileError) {
      return errorResponse(`Profil non créé : ${upsertProfileError.message}`, 500);
    }

    // 4. Adhésion : alignée sur le rôle demandé (le trigger recopie app_role tel quel)
    if (orgId) {
      const role = membershipRoleFor(appRole);
      const { data: membership, error: readError } = await supabaseAdmin
        .schema("core").from("organization_members").select("id")
        .eq("org_id", orgId).eq("user_id", newUserId).maybeSingle();
      if (readError) return errorResponse(`Adhésion illisible : ${readError.message}`, 500);
      const write = membership
        ? supabaseAdmin.schema("core").from("organization_members")
            .update({ role, status: "active" }).eq("id", membership.id)
        : supabaseAdmin.schema("core").from("organization_members")
            .insert({ org_id: orgId, user_id: newUserId, role, status: "active", invited_by: caller.id, invited_at: new Date().toISOString() });
      const { error: membershipError } = await write;
      if (membershipError) return errorResponse(`Adhésion non créée : ${membershipError.message}`, 500);
    }

    return json({
      success: true,
      reusedExistingAuthUser,
      user: {
        id: newUserId,
        email: cleanEmail,
        fullName: cleanName,
        appRole,
        businessRole: businessRole || null,
        orgId: orgId || null,
      },
    }, 201);
  } catch (error) {
    console.error("[create-user] Error:", error);
    return errorResponse(error instanceof Error ? error.message : "Internal server error", 500);
  }
});
