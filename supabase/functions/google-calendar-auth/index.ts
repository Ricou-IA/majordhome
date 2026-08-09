import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
const FRONTEND_ORIGINS = (Deno.env.get("FRONTEND_ORIGINS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-auth?action=callback`;
const SCOPES = "https://www.googleapis.com/auth/calendar.events email";
const GCAL_API = "https://www.googleapis.com/calendar/v3";
const TIMEZONE = "Europe/Paris";
const STATE_TTL_SECONDS = 600;

// ---------------------------------------------------------------------------
// State signe (HMAC-SHA256) — miroir exact de gsc-oauth-init / gsc-oauth-callback
//
// Avant (2026-08-09) le state etait un simple btoa(JSON) relu tel quel au
// retour : n'importe qui pouvait forger un state ("je suis l'utilisateur X"),
// passer le consentement avec son propre compte Google, et faire enregistrer
// SES jetons sous l'identite de X. Le meme champ alimentait ensuite un
// exec_sql interpole. La signature ferme les deux portes d'un coup.
// ---------------------------------------------------------------------------

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return base64Decode(b64 + pad);
}

function getHmacKeyBytes(): Uint8Array {
  // RESEND_WEBHOOK_SECRET est au format Svix `whsec_<base64>` — meme
  // convention que gsc-oauth-* / mailing-unsubscribe / resend-webhook.
  const secretPart = RESEND_WEBHOOK_SECRET.startsWith("whsec_")
    ? RESEND_WEBHOOK_SECRET.slice(6)
    : RESEND_WEBHOOK_SECRET;
  return base64Decode(secretPart);
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

// Comparaison a duree constante : ne pas laisser fuiter la signature attendue
// via le temps de reponse.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface SignedStatePayload {
  orgId: string;
  userId: string;
  returnTo: string;
  nonce: string;
  exp: number;
}

async function signState(payload: SignedStatePayload): Promise<string> {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sigBytes = await hmacSha256(getHmacKeyBytes(), payloadB64);
  return `${payloadB64}.${base64UrlEncode(sigBytes)}`;
}

async function verifySignedState(
  stateRaw: string,
): Promise<{ ok: true; payload: SignedStatePayload } | { ok: false; error: string }> {
  const parts = stateRaw.split(".");
  if (parts.length !== 2) return { ok: false, error: "invalid_format" };
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return { ok: false, error: "invalid_parts" };

  let expectedSig: string;
  try {
    expectedSig = base64UrlEncode(await hmacSha256(getHmacKeyBytes(), payloadB64));
  } catch {
    return { ok: false, error: "hmac_compute_failed" };
  }
  if (!safeEqual(sigB64, expectedSig)) return { ok: false, error: "signature_mismatch" };

  let payload: SignedStatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as SignedStatePayload;
  } catch {
    return { ok: false, error: "payload_decode_failed" };
  }

  if (
    typeof payload.orgId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.returnTo !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, error: "payload_shape_invalid" };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: "state_expired" };
  }
  return { ok: true, payload };
}

// Defense en profondeur : meme signe, on ne redirige que vers une origine
// connue. FRONTEND_ORIGINS vide (dev local) => on n'impose rien.
function isAllowedReturnTo(returnTo: string): boolean {
  if (!FRONTEND_ORIGINS.length) return true;
  try {
    return FRONTEND_ORIGINS.includes(new URL(returnTo).origin);
  } catch {
    return false;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function getUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user } } = await supabase.auth.getUser(token);
  return user;
}

async function requireUser(req: Request) {
  const user = await getUser(req);
  if (!user) return { user: null, errorResponse: jsonResponse({ error: "Unauthorized" }, 401) };
  return { user, errorResponse: null };
}

function normalizeTime(t: string): string {
  if (!t) return "00:00:00";
  const parts = t.split(":");
  if (parts.length === 2) return `${parts[0]}:${parts[1]}:00`;
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
}

// --- Generate OAuth URL ---
async function handleAuthUrl(req: Request) {
  const { user, errorResponse } = await requireUser(req);
  if (!user) return errorResponse!;
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org_id");
  const returnUrl = url.searchParams.get("return_url") || "";
  if (!orgId) return jsonResponse({ error: "org_id required" }, 400);
  if (!RESEND_WEBHOOK_SECRET) {
    return jsonResponse(
      { error: "RESEND_WEBHOOK_SECRET not configured (required for state signing)" },
      500,
    );
  }
  if (returnUrl && !isAllowedReturnTo(returnUrl)) {
    return jsonResponse({ error: "return_url not allowed" }, 400);
  }

  const state = await signState({
    orgId,
    userId: user.id,
    returnTo: returnUrl,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  });
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);
  return jsonResponse({ url: authUrl.toString() });
}

// --- OAuth callback ---
async function handleCallback(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Le state DOIT etre verifie avant d'etre cru — et avant meme de servir a
  // construire une redirection : un state invalide n'a pas de returnTo
  // exploitable, on repond en JSON plutot que de rediriger n'importe ou.
  if (!RESEND_WEBHOOK_SECRET) {
    return jsonResponse({ error: "RESEND_WEBHOOK_SECRET not configured" }, 500);
  }
  if (error && !stateParam) return jsonResponse({ error: `google:${error}` }, 400);
  if (!stateParam) return jsonResponse({ error: "missing_state" }, 400);

  const stateVerif = await verifySignedState(stateParam);
  if (!stateVerif.ok) {
    console.error(`[gcal-auth] State OAuth rejete : ${stateVerif.error}`);
    return jsonResponse({ error: `invalid_state:${stateVerif.error}` }, 400);
  }
  const state = {
    user_id: stateVerif.payload.userId,
    org_id: stateVerif.payload.orgId,
    return_url: stateVerif.payload.returnTo,
  };
  if (state.return_url && !isAllowedReturnTo(state.return_url)) {
    return jsonResponse({ error: "return_url not allowed" }, 400);
  }
  const returnUrl = state.return_url || "";

  function redirectError(msg: string) {
    if (returnUrl) return Response.redirect(`${returnUrl}?gcal=error&gcal_error=${encodeURIComponent(msg)}`, 302);
    return jsonResponse({ error: msg }, 400);
  }
  function redirectSuccess(email: string) {
    if (returnUrl) return Response.redirect(`${returnUrl}?gcal=success&gcal_email=${encodeURIComponent(email)}`, 302);
    return jsonResponse({ success: true, email });
  }

  // A ce stade le state est verifie, donc returnUrl est sur : on peut rediriger.
  if (error) return redirectError(`google:${error}`);
  if (!code) return redirectError("missing_code");

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.error("[gcal-auth] Token exchange failed:", await tokenRes.text());
    return redirectError(`token_exchange:${tokenRes.status}`);
  }
  const tokens = await tokenRes.json();
  if (!tokens.access_token) return redirectError("no_access_token");
  if (!tokens.refresh_token) return redirectError("no_refresh_token");

  // Get Google email
  const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userinfo = await userinfoRes.json();
  const googleEmail = userinfo.email || "unknown";

  // Store tokens via RPC
  const admin = getAdminClient();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { error: rpcError } = await admin.rpc('gcal_upsert_token', {
    p_user_id: state.user_id,
    p_org_id: state.org_id,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_token_expires_at: expiresAt,
    p_google_email: googleEmail,
  });
  if (rpcError) {
    console.error("[gcal-auth] RPC failed:", JSON.stringify(rpcError));
    return redirectError(`rpc:${rpcError.code}:${rpcError.message}`);
  }

  // --- INITIAL SYNC: push all future appointments assigned to this user ---
  try {
    await initialSyncForUser(admin, state.user_id, state.org_id, tokens.access_token);
  } catch (err) {
    console.error("[gcal-auth] Initial sync failed (non-blocking):", err);
    // Non-blocking — connection still succeeds
  }

  return redirectSuccess(googleEmail);
}

// --- Initial sync: push all future assigned appointments to Google Calendar ---
async function initialSyncForUser(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  orgId: string,
  accessToken: string
) {
  // Find this user's team_member ID
  const { data: teamMember } = await admin
    .from("majordhome_team_members")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!teamMember) {
    console.log("[gcal-auth] No team_member for user, skipping initial sync");
    return;
  }

  // Resolve majordhome org_id for appointment queries.
  // RPC typee (2026-08-09) : l'ancienne version collait `orgId` dans une chaine
  // SQL envoyee a exec_sql en service_role. Ici le parametre reste une donnee.
  const { data: resolvedOrg, error: resolveError } = await admin.rpc(
    'gcal_resolve_majordhome_org',
    { p_core_org_id: orgId },
  );
  if (resolveError) {
    console.error("[gcal-auth] gcal_resolve_majordhome_org failed:", JSON.stringify(resolveError));
  }
  const majordhomeOrgId = resolvedOrg || orgId;

  // Get all future appointments assigned to this team_member
  const today = new Date().toISOString().split('T')[0];

  // Appointments via appointment_technicians
  const { data: techAppointments } = await admin
    .from("majordhome_appointment_technicians")
    .select("appointment_id")
    .eq("technician_id", teamMember.id);

  // Appointments via assigned_commercial_id (check commercials table for this user)
  const { data: commercial } = await admin
    .from("majordhome_commercials")
    .select("id")
    .eq("profile_id", userId)
    .maybeSingle();

  // Collect all appointment IDs
  const appointmentIds = new Set<string>();
  techAppointments?.forEach((t: { appointment_id: string }) => appointmentIds.add(t.appointment_id));

  if (commercial) {
    const { data: comAppts } = await admin
      .from("majordhome_appointments")
      .select("id")
      .eq("assigned_commercial_id", commercial.id)
      .eq("org_id", majordhomeOrgId)
      .gte("scheduled_date", today);
    comAppts?.forEach((a: { id: string }) => appointmentIds.add(a.id));
  }

  if (appointmentIds.size === 0) {
    console.log("[gcal-auth] No future appointments to sync");
    return;
  }

  // Fetch full appointment data for future ones
  const { data: appointments } = await admin
    .from("majordhome_appointments")
    .select("*")
    .in("id", Array.from(appointmentIds))
    .gte("scheduled_date", today)
    .neq("status", "cancelled");

  if (!appointments?.length) {
    console.log("[gcal-auth] No future non-cancelled appointments");
    return;
  }

  console.log(`[gcal-auth] Initial sync: ${appointments.length} appointments for user ${userId}`);

  const TYPE_LABELS: Record<string, string> = {
    rdv_agency: "RDV Commercial", rdv_technical: "Visite Technique", installation: "Installation",
    maintenance: "Entretien", service: "Depannage", other: "Autre",
  };

  let synced = 0;
  for (const appt of appointments) {
    try {
      // Check if already synced
      const { data: existing } = await admin
        .from("majordhome_google_calendar_sync")
        .select("id")
        .eq("appointment_id", appt.id)
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) continue; // Already synced

      // Build Google event
      const typeLabel = TYPE_LABELS[appt.appointment_type || ""] || "RDV";
      const clientName = [appt.client_first_name, appt.client_name].filter(Boolean).join(" ");
      const summary = clientName ? `[${typeLabel}] ${clientName}` : `[${typeLabel}] ${appt.subject || "Sans titre"}`;
      const desc: string[] = [];
      if (appt.subject) desc.push(appt.subject);
      if (appt.description) desc.push(appt.description);
      if (appt.client_phone) desc.push(`Tel : ${appt.client_phone}`);
      const loc = [appt.address, appt.postal_code, appt.city].filter(Boolean).join(", ");

      const startDT = `${appt.scheduled_date}T${normalizeTime(appt.scheduled_start)}`;
      let endDT: string;
      if (appt.scheduled_end) {
        endDT = `${appt.scheduled_date}T${normalizeTime(appt.scheduled_end)}`;
      } else {
        const [sh, sm] = appt.scheduled_start.split(":").map(Number);
        const t = sh * 60 + sm + (appt.duration_minutes || 60);
        endDT = `${appt.scheduled_date}T${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}:00`;
      }

      const event = {
        summary, description: desc.join("\n"), location: loc,
        start: { dateTime: startDT, timeZone: TIMEZONE },
        end: { dateTime: endDT, timeZone: TIMEZONE },
        reminders: { useDefault: true },
      };

      // Create Google event
      const res = await fetch(`${GCAL_API}/calendars/primary/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });

      if (res.ok) {
        const created = await res.json();
        await admin.rpc('gcal_upsert_sync', {
          p_appointment_id: appt.id,
          p_user_id: userId,
          p_google_event_id: created.id,
          p_google_calendar_id: "primary",
          p_sync_status: "synced",
          p_sync_action: "create",
          p_error_message: null,
          p_synced_at: new Date().toISOString(),
        });
        synced++;
      } else {
        console.error(`[gcal-auth] Initial sync failed for appt ${appt.id}:`, await res.text());
      }
    } catch (err) {
      console.error(`[gcal-auth] Initial sync error for appt ${appt.id}:`, err);
    }
  }

  console.log(`[gcal-auth] Initial sync done: ${synced}/${appointments.length} synced`);
}

// --- Le refresh token est-il encore accepte par Google ? ---
// Google invalide un refresh token quand l'utilisateur revoque l'acces, change
// son mot de passe, ou quand l'app OAuth est restee en statut « Testing »
// (expiration au bout de 7 jours). Aucun de ces cas ne produit d'evenement
// cote app : sans cette sonde, la panne reste muette.
async function refreshTokenWorks(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      console.warn(`[gcal-auth] refresh token invalide (${res.status})`);
      return false;
    }
    return true;
  } catch (err) {
    // Panne reseau ponctuelle : on ne crie pas « reconnecte-toi » a tort.
    console.error("[gcal-auth] probe refresh token failed:", err);
    return true;
  }
}

// --- Check connection status ---
async function handleStatus(req: Request) {
  const { user, errorResponse } = await requireUser(req);
  if (!user) return errorResponse!;
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org_id");
  if (!orgId) return jsonResponse({ error: "org_id required" }, 400);

  const admin = getAdminClient();
  const { data, error: dbError } = await admin
    .from("majordhome_google_calendar_tokens")
    .select("google_email, calendar_id, connected_at, refresh_token")
    .eq("user_id", user.id).eq("org_id", orgId).maybeSingle();

  if (dbError) return jsonResponse({ error: "Database error" }, 500);

  // « Connecte » ne veut rien dire si le refresh token est mort : c'est
  // exactement ce qui a fait passer 98 RDV a la trappe entre avril et aout
  // 2026 sans qu'aucun ecran ne le signale. On teste le jeton pour de vrai.
  let needsReconnect = false;
  if (data?.refresh_token) {
    needsReconnect = !(await refreshTokenWorks(data.refresh_token));
  }

  return jsonResponse({
    connected: !!data,
    google_email: data?.google_email || null,
    calendar_id: data?.calendar_id || null,
    connected_at: data?.connected_at || null,
    needs_reconnect: needsReconnect,
  });
}

// --- Disconnect ---
async function handleDisconnect(req: Request) {
  const { user, errorResponse } = await requireUser(req);
  if (!user) return errorResponse!;
  const body = await req.json();
  const orgId = body.org_id;
  if (!orgId) return jsonResponse({ error: "org_id required" }, 400);

  const admin = getAdminClient();
  const { data: tokenData } = await admin
    .from("majordhome_google_calendar_tokens")
    .select("access_token").eq("user_id", user.id).eq("org_id", orgId).maybeSingle();

  if (tokenData?.access_token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${tokenData.access_token}`, { method: "POST" }).catch(() => {});
  }
  await admin.rpc('gcal_disconnect', { p_user_id: user.id, p_org_id: orgId });
  return jsonResponse({ success: true });
}

// --- ROUTER ---
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  try {
    switch (action) {
      case "auth-url": return await handleAuthUrl(req);
      case "callback": return await handleCallback(req);
      case "status": return await handleStatus(req);
      case "disconnect": return await handleDisconnect(req);
      default: return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("[gcal-auth] Unhandled:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
