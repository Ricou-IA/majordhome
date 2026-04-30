// ============================================================================
// gsc-sync — Synchronise les donnees Google Search Console
// ============================================================================
//
// Refresh l'access_token via le refresh_token stocke en DB, query l'API
// Search Analytics (dimensions: query/date/page), UPSERT idempotent dans
// majordhome.gsc_keyword_metrics.
//
// Interface :
//   POST /functions/v1/gsc-sync
//   Authorization: Bearer <supabase_jwt>
//   Body: { orgId: string, monthsBack?: number (1-16, default 1) }
//   -> Response: { ok, rowsImported, dateRange }
//
// Securite :
//   - verify_jwt: true (JWT Supabase requis)
//   - Valide membership user/org
//   - refresh_token jamais expose au client
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GSC_CLIENT_ID = Deno.env.get("GSC_CLIENT_ID") || "";
const GSC_CLIENT_SECRET = Deno.env.get("GSC_CLIENT_SECRET") || "";

const ROW_LIMIT = 25000;
const MAX_TOTAL_ROWS = 200000;
const UPSERT_BATCH = 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface SyncBody {
  orgId: string;
  monthsBack?: number;
}

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!GSC_CLIENT_ID || !GSC_CLIENT_SECRET) {
    return jsonResponse({ error: "GSC credentials not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "No auth header" }, 401);

  try {
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const body = (await req.json()) as SyncBody;
    if (!body.orgId) return jsonResponse({ error: "orgId required" }, 400);

    const monthsBack = Math.min(Math.max(body.monthsBack ?? 1, 1), 16);

    // Membership check
    const { data: membership, error: memErr } = await supa
      .schema("core")
      .from("organization_members")
      .select("org_id")
      .eq("org_id", body.orgId)
      .eq("user_id", userId)
      .maybeSingle();

    if (memErr) {
      return jsonResponse({ error: `DB error: ${memErr.message}` }, 500);
    }
    if (!membership) {
      return jsonResponse({ error: "Not a member of this org" }, 403);
    }

    // Lit les settings
    const { data: orgRow, error: readErr } = await supa
      .schema("core")
      .from("organizations")
      .select("settings")
      .eq("id", body.orgId)
      .maybeSingle();

    if (readErr || !orgRow) {
      return jsonResponse(
        { error: `Org introuvable: ${readErr?.message ?? "not found"}` },
        404
      );
    }

    const settings = (orgRow.settings as Record<string, unknown>) ?? {};
    const refreshToken = settings.gsc_refresh_token as string | undefined;
    const siteUrl = settings.gsc_site_url as string | undefined;

    if (!refreshToken || !siteUrl) {
      return jsonResponse(
        { error: "GSC non connecte pour cette org. Connectez-vous d'abord." },
        400
      );
    }

    // Refresh access_token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GSC_CLIENT_ID,
        client_secret: GSC_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      return jsonResponse(
        {
          error: `Refresh token echoue: ${
            tokenJson.error_description ?? tokenJson.error ?? "inconnu"
          }. Reconnectez-vous a GSC.`,
        },
        502
      );
    }
    const accessToken = tokenJson.access_token as string;

    // Date range (UTC). GSC retourne data avec ~2j de delai, mais on cap a aujourd'hui
    const today = new Date();
    const endDate = isoDate(today);
    const start = new Date(today);
    start.setUTCMonth(start.getUTCMonth() - monthsBack);
    const startDate = isoDate(start);

    // Pagination Search Analytics
    const allRows: GscRow[] = [];
    let startRow = 0;
    while (true) {
      const queryRes = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ["query", "date", "page"],
            rowLimit: ROW_LIMIT,
            startRow,
            type: "web",
          }),
        }
      );
      const queryJson = await queryRes.json();
      if (!queryRes.ok) {
        return jsonResponse(
          {
            error: `Query GSC echouee: ${queryJson.error?.message ?? "inconnu"}`,
            apiStatus: queryRes.status,
          },
          502
        );
      }
      const rows: GscRow[] = queryJson.rows ?? [];
      allRows.push(...rows);
      if (rows.length < ROW_LIMIT) break;
      startRow += ROW_LIMIT;
      if (allRows.length >= MAX_TOTAL_ROWS) {
        console.warn(
          `[gsc-sync] Cap atteint a ${MAX_TOTAL_ROWS} lignes pour org ${body.orgId}`
        );
        break;
      }
    }

    if (allRows.length === 0) {
      return jsonResponse({
        ok: true,
        rowsImported: 0,
        dateRange: { startDate, endDate },
        message: "Aucune donnee retournee par GSC pour cette periode.",
      });
    }

    // Map vers la structure DB
    const dbRows = allRows.map((r) => ({
      org_id: body.orgId,
      site_url: siteUrl,
      query: r.keys[0] ?? "",
      date: r.keys[1] ?? "",
      page: r.keys[2] ?? "",
      impressions: r.impressions ?? 0,
      clicks: r.clicks ?? 0,
      ctr: r.ctr ?? 0,
      avg_position: r.position ?? 0,
    }));

    // UPSERT par batch via RPC public.gsc_upsert_metrics (le schema majordhome
    // n'est pas expose directement par PostgREST, on passe par une RPC SECURITY DEFINER)
    let imported = 0;
    for (let i = 0; i < dbRows.length; i += UPSERT_BATCH) {
      const batch = dbRows.slice(i, i + UPSERT_BATCH);
      const { data: rpcCount, error: upErr } = await supa.rpc("gsc_upsert_metrics", {
        p_rows: batch,
      });
      if (upErr) {
        return jsonResponse(
          {
            error: `UPSERT echoue au batch ${i}: ${upErr.message}`,
            importedSoFar: imported,
          },
          500
        );
      }
      imported += typeof rpcCount === "number" ? rpcCount : batch.length;
    }

    // Marque la date de sync dans settings
    const updatedSettings = {
      ...settings,
      gsc_last_sync_at: new Date().toISOString(),
      gsc_last_sync_rows: imported,
    };
    await supa
      .schema("core")
      .from("organizations")
      .update({ settings: updatedSettings })
      .eq("id", body.orgId);

    return jsonResponse({
      ok: true,
      rowsImported: imported,
      dateRange: { startDate, endDate },
      siteUrl,
    });
  } catch (err) {
    console.error("[gsc-sync] Error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
