import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-auth?action=callback`;
const SCOPES = "https://www.googleapis.com/auth/calendar.events email";
const GCAL_API = "https://www.googleapis.com/calendar/v3";
const TIMEZONE = "Europe/Paris";

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

  const state = btoa(JSON.stringify({ user_id: user.id, org_id: orgId, return_url: returnUrl }));
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

  let state: { user_id: string; org_id: string; return_url?: string } = { user_id: "", org_id: "" };
  try { if (stateParam) state = JSON.parse(atob(stateParam)); } catch { /* ignore */ }
  const returnUrl = state.return_url || "";

  function redirectError(msg: string) {
    if (returnUrl) return Response.redirect(`${returnUrl}?gcal=error&gcal_error=${encodeURIComponent(msg)}`, 302);
    return jsonResponse({ error: msg }, 400);
  }
  function redirectSuccess(email: string) {
    if (returnUrl) return Response.redirect(`${returnUrl}?gcal=success&gcal_email=${encodeURIComponent(email)}`, 302);
    return jsonResponse({ success: true, email });
  }

  if (error) return redirectError(`google:${error}`);
  if (!code || !stateParam) return redirectError("missing_params");

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

  // Resolve majordhome org_id for appointment queries
  const { data: mOrg } = await admin.rpc('exec_sql', {
    query_text: `SELECT id FROM majordhome.organizations WHERE core_org_id = '${orgId}' LIMIT 1`
  });
  const majordhomeOrgId = mOrg?.[0]?.id || orgId;

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
    .select("google_email, calendar_id, connected_at")
    .eq("user_id", user.id).eq("org_id", orgId).maybeSingle();

  if (dbError) return jsonResponse({ error: "Database error" }, 500);
  return jsonResponse({
    connected: !!data,
    google_email: data?.google_email || null,
    calendar_id: data?.calendar_id || null,
    connected_at: data?.connected_at || null,
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
