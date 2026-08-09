import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GCAL_API = "https://www.googleapis.com/calendar/v3";
const TIMEZONE = "Europe/Paris";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function normalizeTime(t: string): string {
  if (!t) return "00:00:00";
  const parts = t.split(":");
  if (parts.length === 2) return `${parts[0]}:${parts[1]}:00`;
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
}

async function resolveCoreOrgId(admin: ReturnType<typeof getAdminClient>, orgId: string): Promise<string> {
  const { data } = await admin.from("majordhome_google_calendar_tokens").select("id").eq("org_id", orgId).limit(1);
  if (data?.length) return orgId;
  const { data: resolved } = await admin.rpc('gcal_resolve_core_org', { p_org_id: orgId });
  return resolved || orgId;
}

async function resolveProfileIds(admin: ReturnType<typeof getAdminClient>, techIds: string[], commercialId: string | null, currentUserId: string | null): Promise<string[]> {
  const ids: Set<string> = new Set();
  if (currentUserId) ids.add(currentUserId);
  if (techIds?.length) {
    const { data } = await admin.from("majordhome_team_members").select("user_id").in("id", techIds);
    data?.forEach((m: { user_id: string }) => { if (m.user_id) ids.add(m.user_id); });
  }
  if (commercialId) {
    const { data } = await admin.from("majordhome_commercials").select("profile_id").eq("id", commercialId).maybeSingle();
    if (data?.profile_id) ids.add(data.profile_id);
  }
  return Array.from(ids);
}

interface TokenRecord {
  id: string; user_id: string; access_token: string; refresh_token: string;
  token_expires_at: string; calendar_id: string; google_email: string;
}

async function refreshTokenIfNeeded(admin: ReturnType<typeof getAdminClient>, token: TokenRecord): Promise<string | null> {
  if (new Date(token.token_expires_at).getTime() - Date.now() > 5 * 60 * 1000) return token.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: token.refresh_token, grant_type: "refresh_token",
    }),
  });
  if (!res.ok) { console.error(`[gcal-sync] Refresh failed:`, await res.text()); return null; }
  const data = await res.json();
  await admin.rpc('gcal_update_token', {
    p_token_id: token.id,
    p_access_token: data.access_token,
    p_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  });
  return data.access_token;
}

interface AppointmentData {
  id: string; subject?: string; appointment_type?: string;
  scheduled_date: string; scheduled_start: string; scheduled_end?: string;
  duration_minutes?: number; client_name?: string; client_first_name?: string;
  client_phone?: string; client_email?: string; address?: string;
  postal_code?: string; city?: string; description?: string; status?: string;
}

const TYPE_LABELS: Record<string, string> = {
  rdv_agency: "RDV Commercial", rdv_technical: "Visite Technique", installation: "Installation",
  maintenance: "Entretien", service: "Depannage", other: "Autre",
};

function buildGoogleEvent(a: AppointmentData) {
  const typeLabel = TYPE_LABELS[a.appointment_type || ""] || "RDV";
  const clientName = [a.client_first_name, a.client_name].filter(Boolean).join(" ");
  const summary = clientName ? `[${typeLabel}] ${clientName}` : `[${typeLabel}] ${a.subject || "Sans titre"}`;
  const desc: string[] = [];
  if (a.subject) desc.push(a.subject);
  if (a.description) desc.push(a.description);
  if (a.client_phone) desc.push(`Tel : ${a.client_phone}`);
  if (a.client_email) desc.push(`Email : ${a.client_email}`);
  const loc = [a.address, a.postal_code, a.city].filter(Boolean).join(", ");
  const startTime = normalizeTime(a.scheduled_start);
  const startDT = `${a.scheduled_date}T${startTime}`;
  let endDT: string;
  if (a.scheduled_end) {
    endDT = `${a.scheduled_date}T${normalizeTime(a.scheduled_end)}`;
  } else if (a.duration_minutes) {
    const [sh, sm] = a.scheduled_start.split(":").map(Number);
    const t = sh * 60 + sm + a.duration_minutes;
    endDT = `${a.scheduled_date}T${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}:00`;
  } else {
    const [sh, sm] = a.scheduled_start.split(":").map(Number);
    endDT = `${a.scheduled_date}T${String(sh+1).padStart(2,"0")}:${String(sm).padStart(2,"0")}:00`;
  }
  return { summary, description: desc.join("\n"), location: loc,
    start: { dateTime: startDT, timeZone: TIMEZONE }, end: { dateTime: endDT, timeZone: TIMEZONE },
    reminders: { useDefault: true } };
}

async function createGcalEvent(token: string, calId: string, ev: ReturnType<typeof buildGoogleEvent>) {
  const r = await fetch(`${GCAL_API}/calendars/${encodeURIComponent(calId)}/events`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(ev),
  });
  if (!r.ok) { console.error("[gcal-sync] Create failed:", r.status, await r.text()); return null; }
  return await r.json() as { id: string };
}

async function updateGcalEvent(token: string, calId: string, evId: string, ev: ReturnType<typeof buildGoogleEvent>) {
  const r = await fetch(`${GCAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evId)}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(ev),
  });
  return r.ok;
}

async function deleteGcalEvent(token: string, calId: string, evId: string) {
  const r = await fetch(`${GCAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evId)}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
  });
  return r.status === 204 || r.status === 410;
}

// Standard sync for create/update
async function syncForUser(admin: ReturnType<typeof getAdminClient>, token: TokenRecord, action: string, appt: AppointmentData) {
  const accessToken = await refreshTokenIfNeeded(admin, token);
  if (!accessToken) return { success: false, error: "Token refresh failed" };

  const calId = token.calendar_id || "primary";
  const { data: syncRec } = await admin.from("majordhome_google_calendar_sync")
    .select("id, google_event_id").eq("appointment_id", appt.id).eq("user_id", token.user_id).maybeSingle();

  let ok = false, gEventId = syncRec?.google_event_id || null, errMsg: string | undefined;

  try {
    if (action === "create" || (action === "update" && !gEventId)) {
      const created = await createGcalEvent(accessToken, calId, buildGoogleEvent(appt));
      if (created) { gEventId = created.id; ok = true; } else errMsg = "Create failed";
    } else if (action === "update" && gEventId) {
      ok = await updateGcalEvent(accessToken, calId, gEventId, buildGoogleEvent(appt));
      if (!ok) errMsg = "Update failed";
    } else if ((action === "delete" || action === "cancel") && gEventId) {
      ok = await deleteGcalEvent(accessToken, calId, gEventId);
      if (!ok) errMsg = "Delete failed";
    } else { ok = true; }
  } catch (e) { errMsg = e instanceof Error ? e.message : String(e); }

  const syncStatus = (action === "delete" || action === "cancel") ? (ok ? "deleted" : "error") : (ok ? "synced" : "error");

  await admin.rpc('gcal_upsert_sync', {
    p_appointment_id: appt.id,
    p_user_id: token.user_id,
    p_google_event_id: gEventId,
    p_google_calendar_id: calId,
    p_sync_status: syncStatus,
    p_sync_action: action,
    p_error_message: errMsg || null,
    p_synced_at: ok ? new Date().toISOString() : null,
  });

  return { success: ok, error: errMsg };
}

// Delete using pre-loaded sync records (CASCADE already deleted them from DB)
async function deleteForUser(
  admin: ReturnType<typeof getAdminClient>,
  token: TokenRecord,
  googleEventId: string,
  calendarId: string
): Promise<{ success: boolean; error?: string }> {
  const accessToken = await refreshTokenIfNeeded(admin, token);
  if (!accessToken) return { success: false, error: "Token refresh failed" };

  const calId = calendarId || token.calendar_id || "primary";
  const ok = await deleteGcalEvent(accessToken, calId, googleEventId);
  return { success: ok, error: ok ? undefined : "Delete failed" };
}

// --- MAIN ---
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  let body: {
    action: string;
    appointment: AppointmentData;
    technician_ids?: string[];
    assigned_commercial_id?: string;
    current_user_id?: string;
    org_id: string;
    existing_sync_records?: Array<{ user_id: string; google_event_id: string; google_calendar_id: string }>;
  };
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

  const { action, appointment, technician_ids, assigned_commercial_id, current_user_id, org_id, existing_sync_records } = body;
  if (!action || !appointment?.id || !org_id) return jsonResponse({ error: "Missing required fields" }, 400);

  const admin = getAdminClient();

  // For deletes with pre-loaded sync records, use them directly
  if (action === "delete" && existing_sync_records?.length) {
    const coreOrgId = await resolveCoreOrgId(admin, org_id);
    const userIds = existing_sync_records.map(r => r.user_id);

    const { data: tokens } = await admin.from("majordhome_google_calendar_tokens")
      .select("*").eq("org_id", coreOrgId).in("user_id", userIds);

    if (!tokens?.length) return jsonResponse({ results: [], message: "No tokens" });

    const results = await Promise.allSettled(
      existing_sync_records
        .filter(sr => sr.google_event_id)
        .map(sr => {
          const token = tokens.find((t: TokenRecord) => t.user_id === sr.user_id);
          if (!token) return Promise.resolve({ success: false, error: "No token" });
          return deleteForUser(admin, token, sr.google_event_id, sr.google_calendar_id);
        })
    );

    const summary = results.map((r, i) => ({
      user_id: existing_sync_records[i].user_id,
      ...(r.status === "fulfilled" ? r.value : { success: false, error: r.reason?.message }),
    }));

    console.log(`[gcal-sync] delete ${appointment.id}: ${summary.filter((s:{success:boolean}) => s.success).length}/${summary.length} deleted`);
    return jsonResponse({ results: summary });
  }

  // Standard flow for create/update/cancel
  const coreOrgId = await resolveCoreOrgId(admin, org_id);
  const profileIds = await resolveProfileIds(admin, technician_ids || [], assigned_commercial_id || null, current_user_id || null);
  if (!profileIds.length) return jsonResponse({ results: [], message: "No users to sync" });

  const { data: tokens } = await admin.from("majordhome_google_calendar_tokens")
    .select("*").eq("org_id", coreOrgId).in("user_id", profileIds);
  if (!tokens?.length) return jsonResponse({ results: [], message: "No Google Calendar connected" });

  const results = await Promise.allSettled(tokens.map((t: TokenRecord) => syncForUser(admin, t, action, appointment)));
  const summary = results.map((r, i) => ({
    user_id: tokens[i].user_id, google_email: tokens[i].google_email,
    ...(r.status === "fulfilled" ? r.value : { success: false, error: r.reason?.message }),
  }));

  console.log(`[gcal-sync] ${action} ${appointment.id}: ${summary.filter((s:{success:boolean}) => s.success).length}/${summary.length} synced`);
  return jsonResponse({ results: summary });
});
