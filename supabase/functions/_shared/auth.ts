// ============================================================================
// _shared/auth.ts — Helper d'auth standard pour les edge functions Majord'home
// ============================================================================
//
// Pose la convention multi-tenant pour toute edge function `verify_jwt:true`
// (ou `verify_jwt:false` mais qui veut quand meme valider un JWT user passe en
// header) :
//
//   1. Extract JWT du header Authorization: Bearer <jwt>
//   2. Valide via supabase.auth.getUser(token)
//   3. Check membership user × org dans core.organization_members
//   4. (optionnel) filtre les settings de l'org (ex: settings.pennylane.enabled)
//   5. (optionnel) verifie le role minimum requis (member < team_leader < org_admin)
//
// Usage typique :
//
//   import { requireOrgMembership } from "../_shared/auth.ts";
//
//   const auth = await requireOrgMembership(req, { orgId });
//   if (!auth.ok) return auth.response;
//   const { userId, orgId: validatedOrgId, supabase } = auth;
//
// Pour les webhooks publics (Resend, Pennylane callbacks, etc.) qui n'ont PAS
// de JWT user mais une signature HMAC ou un secret partage : utiliser
// `requireSharedSecret(req, secret)` (cron) ou validation Svix custom.
// ============================================================================

import {
  createClient,
  type SupabaseClient,
} from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, x-app-name, apikey, content-type",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// requireOrgMembership
// ---------------------------------------------------------------------------

export type MembershipRole = "org_admin" | "team_leader" | "member";

export interface AuthSuccess {
  ok: true;
  userId: string;
  orgId: string;
  membershipRole: MembershipRole | null;
  supabase: SupabaseClient;
}

export interface AuthFailure {
  ok: false;
  response: Response;
}

export type AuthResult = AuthSuccess | AuthFailure;

export interface RequireOrgMembershipOpts {
  /**
   * ID de l'org cible. Si fourni, on verifie que le user est membre de cette
   * org precise. Si omis, on accepte n'importe quelle org du user (utile pour
   * les edges qui resolvent l'org dynamiquement, comme pennylane-proxy).
   */
  orgId?: string;
  /**
   * Filtre additionnel sur les settings de l'org. Retourne true si l'org
   * satisfait la condition (ex: settings.pennylane.enabled === true).
   * Si fourni, on cherche la premiere membership dont l'org passe le filtre.
   */
  orgSettingsFilter?: (settings: Record<string, unknown>) => boolean;
  /**
   * Role minimum requis. Hierarchie : member < team_leader < org_admin.
   * Default : member (toute membership valide passe).
   */
  requiredRole?: MembershipRole;
  /** Override du client Supabase (utile pour tests). */
  supabase?: SupabaseClient;
}

const ROLE_HIERARCHY: Record<MembershipRole, number> = {
  member: 0,
  team_leader: 1,
  org_admin: 2,
};

function roleSatisfies(
  actual: MembershipRole | null,
  required: MembershipRole,
): boolean {
  const a = ROLE_HIERARCHY[actual ?? "member"];
  const r = ROLE_HIERARCHY[required];
  return a >= r;
}

interface MembershipRow {
  org_id: string;
  role: MembershipRole | null;
  organizations?: {
    id: string;
    settings: Record<string, unknown> | null;
  } | null;
}

/**
 * Valide le JWT user du header Authorization + check membership user × org.
 *
 * Retourne soit { ok: true, userId, orgId, membershipRole, supabase }
 * soit { ok: false, response } avec une Response 401/403/500 prete a renvoyer.
 *
 * Pattern d'utilisation :
 *
 *   const auth = await requireOrgMembership(req, { orgId: targetOrgId });
 *   if (!auth.ok) return auth.response;
 *   // Continuer avec auth.userId, auth.orgId, auth.supabase
 */
export async function requireOrgMembership(
  req: Request,
  opts: RequireOrgMembershipOpts = {},
): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return {
      ok: false,
      response: jsonResponse({ error: "No auth header" }, 401),
    };
  }

  const supabase = opts.supabase ?? getAdminClient();
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  const { data: userData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !userData?.user) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Unauthorized", detail: authErr?.message },
        401,
      ),
    };
  }
  const userId = userData.user.id;

  // Lookup memberships du user (+ settings de l'org si filtre fourni)
  const needsSettings = !!opts.orgSettingsFilter;
  const selectClause = needsSettings
    ? "org_id, role, organizations:org_id (id, settings)"
    : "org_id, role";

  let query = supabase
    .schema("core")
    .from("organization_members")
    .select(selectClause)
    .eq("user_id", userId);

  if (opts.orgId) query = query.eq("org_id", opts.orgId);

  const { data: memberships, error: memErr } = await query;
  if (memErr) {
    return {
      ok: false,
      response: jsonResponse({ error: `DB error: ${memErr.message}` }, 500),
    };
  }

  const rows = (memberships ?? []) as unknown as MembershipRow[];

  if (rows.length === 0) {
    return {
      ok: false,
      response: jsonResponse(
        { error: opts.orgId ? "Not a member of this org" : "No org membership" },
        403,
      ),
    };
  }

  // Trouver la premiere membership qui satisfait toutes les contraintes
  let chosen: MembershipRow | null = null;
  for (const m of rows) {
    if (opts.orgSettingsFilter) {
      const settings = (m.organizations?.settings ?? {}) as Record<string, unknown>;
      if (!opts.orgSettingsFilter(settings)) continue;
    }
    if (opts.requiredRole && !roleSatisfies(m.role, opts.requiredRole)) continue;
    chosen = m;
    break;
  }

  if (!chosen) {
    const detail = opts.requiredRole
      ? `Forbidden: requires role ${opts.requiredRole} (or higher)`
      : "Forbidden: no org matches required criteria";
    return {
      ok: false,
      response: jsonResponse({ error: detail }, 403),
    };
  }

  return {
    ok: true,
    userId,
    orgId: chosen.org_id,
    membershipRole: chosen.role,
    supabase,
  };
}

// ---------------------------------------------------------------------------
// requireSharedSecret — pour crons et webhooks proteges par secret partage
// ---------------------------------------------------------------------------

/**
 * Comparaison timing-safe pour eviter les timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifie un secret partage passe en header Authorization: Bearer <secret>.
 * Pour les edges `verify_jwt:false` qui doivent quand meme bloquer les
 * invocations non autorisees (ex: crons N8n, jobs one-shot).
 *
 * Retourne null si OK, une Response 401/500 sinon.
 *
 * Usage :
 *   const authError = requireSharedSecret(req, Deno.env.get("MDH_CRON_SECRET") || "");
 *   if (authError) return authError;
 */
export function requireSharedSecret(
  req: Request,
  expectedSecret: string,
  secretName = "shared secret",
): Response | null {
  if (!expectedSecret) {
    return jsonResponse(
      { error: `${secretName} not configured` },
      500,
    );
  }
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || !timingSafeEqual(token, expectedSecret)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return null;
}
