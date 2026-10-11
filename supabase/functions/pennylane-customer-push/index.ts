// supabase/functions/pennylane-customer-push/index.ts
// Push MDH → Pennylane des colonnes modifiées d'une fiche client, au save (useClient).
// Règles : _shared/pennylaneIdentity.js ; réseau/base : _shared/pennylaneCustomerSync.ts ;
// migration 20261011_1. Décision Eric 2026-10-11 : synchro bidirectionnelle par deltas.
//
// Auth : verify_jwt + requireOrgMembership (org Pennylane activée). Le corps ne porte AUCUNE
// valeur : seules les colonnes modifiées sont nommées, les valeurs sont relues dans la fiche
// MDH (filtrée org) — un appelant ne peut pas écrire dans Pennylane autre chose que la fiche.
//
// Réponses : 200 { status: pushed | nothing | not_mapped } ; 502 { status: failed, error }
// (fiche MDH enregistrée, saisie gardée « en attente » et rejouée par le cron 15 min).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import { pushClientColumns } from "../_shared/pennylaneCustomerSync.ts";

const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";

interface Body { org_id?: string; client_id?: string; columns?: unknown; edited_at?: string }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Body;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Corps JSON invalide" }, 400, req); }
  const columns = Array.isArray(body.columns) ? body.columns.filter((c): c is string => typeof c === "string") : [];
  if (!body.org_id || !body.client_id || columns.length === 0) {
    return jsonResponse({ error: "org_id, client_id et columns sont requis" }, 400, req);
  }

  const auth = await requireOrgMembership(req, {
    orgId: body.org_id,
    orgSettingsFilter: (s) => (s.pennylane as { enabled?: boolean } | undefined)?.enabled === true,
  });
  if (!auth.ok) return auth.response;
  if (!PENNYLANE_API_TOKEN) return jsonResponse({ error: "PENNYLANE_API_TOKEN manquant" }, 500, req);

  const editedAt = body.edited_at && !Number.isNaN(Date.parse(body.edited_at))
    ? new Date(Math.min(Date.parse(body.edited_at), Date.now())).toISOString()
    : new Date().toISOString();

  try {
    const r = await pushClientColumns(auth.supabase, PENNYLANE_API_TOKEN, auth.orgId, body.client_id, columns, editedAt);
    if (r.status === "failed") {
      console.warn(`[pennylane-customer-push] client ${body.client_id} : ${r.error}`);
      return jsonResponse(r, 502, req);
    }
    return jsonResponse(r, 200, req);
  } catch (e) {
    // Échec AVANT d'avoir pu enregistrer l'attente (mapping illisible…) : bruyant.
    return jsonResponse({ status: "failed", error: sanitizeError(e, "push failed") }, 500, req);
  }
});
