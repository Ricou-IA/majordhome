// supabase/functions/_shared/pennylaneCustomerSync.ts
// Synchro bidirectionnelle de l'identité client MDH ⇄ Pennylane — partie RÉSEAU / BASE.
// Les règles (quoi pousser, quoi écrire, qui gagne un conflit) sont dans le module pur
// `./pennylaneIdentity.js` (testé). Migration : 20261011_1.
//
// Utilisé par :
//   - edge `pennylane-customer-push` (save de la fiche, utilisateur authentifié) → pushClientColumns
//   - edge `pennylane-sync-quote-status` (cron 15 min)                          → runCustomerIdentitySync
//
// Rien n'est avalé : chaque étape compte ses échecs dans le résultat renvoyé (journalisé par
// le cron dans pennylane_customer_delta_state.last_result).

import {
  buildPlUpdate,
  changedIdentityFields,
  identityFromPlCustomer,
  planPullUpdate,
  PUSHABLE_COLUMNS,
} from "./pennylaneIdentity.js";

// deno-lint-ignore no-explicit-any
type Supa = any;
// deno-lint-ignore no-explicit-any
type Json = any;

const PL_BASE = "https://app.pennylane.com/api/external/v2";
const CONCURRENCY = 5; // rate limit PL V2 = 25 req / 5 s

// Budgets d'appels Pennylane par passage du cron (plafond d'exécution 150 s en plan Free).
const DELTA_MAX_CUSTOMERS = 60;
const RETRY_MAX_CLIENTS = 20;
const BASELINE_MAX_CUSTOMERS = 60;
const CHANGELOG_MAX_PAGES = 5;
// Rétention du journal PL = 4 semaines : on ne demande jamais plus loin que 27 jours.
const CHANGELOG_MAX_AGE_MS = 27 * 24 * 3600 * 1000;
// Recouvrement volontaire : relire les 5 dernières minutes est sans effet (la diff contre la
// base est idempotente), en rater une entrée publiée en retard ne l'est pas.
const CHANGELOG_OVERLAP_MS = 5 * 60 * 1000;

export async function plFetch(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: Json }> {
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(`${PL_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body && method !== "GET" ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 3) {
      const wait = parseInt(res.headers.get("retry-after") || "2", 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    let data: Json = null;
    try { data = await res.json(); } catch { /* corps vide */ }
    return { status: res.status, data };
  }
  return { status: 429, data: { error: "rate limit après 3 essais" } };
}

async function inBatches<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...await Promise.all(items.slice(i, i + CONCURRENCY).map(fn)));
  }
  return out;
}

function plErrorMessage(status: number, data: Json): string {
  const e = data?.error ?? data?.message ?? data?.errors ?? data;
  return `Pennylane ${status} : ${typeof e === "string" ? e : JSON.stringify(e)}`.slice(0, 500);
}

/** Ligne de cache (base de diff) depuis une fiche PL. */
function cacheRow(c: Json, typeFallback: string | null) {
  const id = identityFromPlCustomer(c);
  return {
    pennylane_id: Number(c.id),
    name: id.name,
    first_name: id.first_name,
    last_name: id.last_name,
    customer_type: id.customer_type ?? typeFallback,
    email: id.email,
    phone: id.phone,
    address: id.address,
    postal_code: id.postal_code,
    city: id.city,
    external_reference: c.reference || c.external_reference || null,
    raw_payload: c,
  };
}

async function writeBaseline(supabase: Supa, orgId: string, rows: Json[]) {
  if (rows.length === 0) return;
  const { error } = await supabase.rpc("pennylane_customer_identity_upsert", {
    p_org_id: orgId,
    p_rows: rows,
  });
  if (error) throw new Error(`cache PL : ${error.message}`);
}

async function getMapping(supabase: Supa, orgId: string, clientId: string) {
  const { data, error } = await supabase
    .from("majordhome_pennylane_sync")
    .select("pennylane_id, metadata")
    .eq("org_id", orgId)
    .eq("entity_type", "client")
    .eq("local_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`mapping : ${error.message}`);
  return data as { pennylane_id: number; metadata: Json } | null;
}

async function setPushState(
  supabase: Supa,
  orgId: string,
  clientId: string,
  pending: Record<string, string>,
  error: string | null,
) {
  const { error: rpcErr } = await supabase.rpc("pennylane_client_set_push_state", {
    p_org_id: orgId,
    p_client_id: clientId,
    p_pending: pending,
    p_error: error,
  });
  if (rpcErr) throw new Error(`état du push : ${rpcErr.message}`);
}

const CLIENT_COLUMNS =
  "id, org_id, first_name, last_name, company_name, display_name, email, phone, address, address_complement, postal_code, city";

// ---------------------------------------------------------------------------
// MDH → PL
// ---------------------------------------------------------------------------

export type PushResult =
  | { status: "pushed"; fields: string[] }
  | { status: "nothing" }
  | { status: "not_mapped" }
  | { status: "failed"; error: string; pending: string[] };

/**
 * Pousse dans Pennylane les colonnes MDH modifiées d'un client ponté.
 * Les colonnes déjà en attente (push précédent raté) repartent avec.
 * Échec ⇒ colonnes enregistrées « en attente » (rejouées par le cron), jamais avalé.
 *
 * @param editedAt date de la saisie MDH (horodatage du conflit éventuel avec PL)
 */
export async function pushClientColumns(
  supabase: Supa,
  token: string,
  orgId: string,
  clientId: string,
  columns: string[],
  editedAt: string,
): Promise<PushResult> {
  const mapping = await getMapping(supabase, orgId, clientId);
  if (!mapping) return { status: "not_mapped" };

  const previous: Record<string, string> = mapping.metadata?.pending_push ?? {};
  const pending: Record<string, string> = { ...previous };
  for (const c of columns) if (PUSHABLE_COLUMNS.includes(c)) pending[c] = editedAt;
  const cols = Object.keys(pending);
  if (cols.length === 0) return { status: "nothing" };

  const fail = async (error: string): Promise<PushResult> => {
    await setPushState(supabase, orgId, clientId, pending, error);
    return { status: "failed", error, pending: cols };
  };

  try {
    const { data: client, error: cErr } = await supabase
      .from("majordhome_clients")
      .select(CLIENT_COLUMNS)
      .eq("org_id", orgId)
      .eq("id", clientId)
      .maybeSingle();
    if (cErr) return await fail(`fiche client : ${cErr.message}`);
    if (!client) return await fail("fiche client introuvable");

    const g = await plFetch(token, "GET", `/customers/${mapping.pennylane_id}`);
    if (g.status !== 200 || !g.data?.id) return await fail(plErrorMessage(g.status, g.data));

    const update = buildPlUpdate({ client, columns: cols, plCustomer: g.data });
    if (!update) {
      // Rien d'envoyable (valeurs MDH vides, type PL inconnu) : on ne garde pas une attente
      // qui ne partira jamais, mais on le dit.
      await setPushState(supabase, orgId, clientId, {}, null);
      return { status: "nothing" };
    }

    const p = await plFetch(token, "PUT", update.path, update.body);
    if (p.status < 200 || p.status >= 300 || !p.data?.id) {
      return await fail(plErrorMessage(p.status, p.data));
    }

    // Anti-écho : la base de diff prend la fiche telle que Pennylane l'a enregistrée. Le
    // passage suivant du journal verra cette modification sans aucun changement à appliquer.
    // (La réponse du PUT ne porte pas customer_type : on garde celui du GET.)
    await writeBaseline(supabase, orgId, [cacheRow(p.data, g.data.customer_type ?? null)]);
    await setPushState(supabase, orgId, clientId, {}, null);
    return { status: "pushed", fields: update.fields };
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// PL → MDH (cron)
// ---------------------------------------------------------------------------

export interface IdentitySyncResult {
  changelog_entries: number;
  customers_checked: number;
  clients_updated: number;
  fields_written: number;
  conflicts_kept_mdh: number;
  baselines_initialised: number;
  deleted_in_pl: number;
  pushes_retried: number;
  pushes_failed: number;
  baseline_pass: number;
  truncated: boolean;
  errors: string[];
}

export async function runCustomerIdentitySync(
  supabase: Supa,
  token: string,
  orgId: string,
): Promise<IdentitySyncResult> {
  const res: IdentitySyncResult = {
    changelog_entries: 0, customers_checked: 0, clients_updated: 0, fields_written: 0,
    conflicts_kept_mdh: 0, baselines_initialised: 0, deleted_in_pl: 0,
    pushes_retried: 0, pushes_failed: 0, baseline_pass: 0, truncated: false, errors: [],
  };
  const runStart = Date.now();

  // 1. Journal : quels customers ont changé depuis le dernier passage ?
  const { data: last, error: stErr } = await supabase.rpc("pennylane_customer_delta_get_state", { p_org_id: orgId });
  if (stErr) throw new Error(`curseur : ${stErr.message}`);
  let since = last ? Date.parse(last) : runStart - 20 * 60 * 1000;
  if (runStart - since > CHANGELOG_MAX_AGE_MS) {
    res.errors.push(`curseur au-delà de la rétention PL (${new Date(since).toISOString()}) : borné à 27 jours`);
    since = runStart - CHANGELOG_MAX_AGE_MS;
  }

  type Entry = { id: number; operation: string; processed_at: string; updated_at: string };
  const entries: Entry[] = [];
  let cursor: string | null = null;
  let drained = false;
  for (let page = 0; page < CHANGELOG_MAX_PAGES; page++) {
    const qs = cursor
      ? `cursor=${encodeURIComponent(cursor)}&limit=1000`
      : `start_date=${encodeURIComponent(new Date(since).toISOString())}&limit=1000`;
    const r = await plFetch(token, "GET", `/changelogs/customers?${qs}`);
    if (r.status !== 200) throw new Error(`journal PL : ${plErrorMessage(r.status, r.data)}`);
    entries.push(...(r.data?.items ?? []));
    cursor = r.data?.next_cursor ?? null;
    if (!r.data?.has_more || !cursor) { drained = true; break; }
  }
  res.changelog_entries = entries.length;

  // Dernier événement par customer, dans l'ordre du journal ; plafond d'appels.
  const lastById = new Map<number, Entry>();
  for (const e of entries) lastById.set(Number(e.id), e);
  const deleted = [...lastById.values()].filter((e) => e.operation === "delete");
  res.deleted_in_pl = deleted.length; // une suppression PL ne supprime rien dans MDH
  let candidates = [...lastById.values()].filter((e) => e.operation !== "delete");
  candidates.sort((a, b) => a.processed_at.localeCompare(b.processed_at));
  let nextSince: number;
  if (candidates.length > DELTA_MAX_CUSTOMERS) {
    candidates = candidates.slice(0, DELTA_MAX_CUSTOMERS);
    res.truncated = true;
    // Reprise au dernier événement traité (relu au passage suivant : sans effet).
    nextSince = Date.parse(candidates[candidates.length - 1].processed_at);
  } else if (drained) {
    nextSince = runStart - CHANGELOG_OVERLAP_MS;
  } else {
    res.truncated = true;
    nextSince = entries.length ? Date.parse(entries[entries.length - 1].processed_at) : since;
  }

  // 2. Ne garder que les customers qui comptent pour MDH : pontés à un client, ou déjà en cache
  //    (leads rattachés). Les créations PL restent l'affaire de pennylane-sync-cron.
  const ids = candidates.map((e) => Number(e.id));
  if (ids.length > 0) {
    const [{ data: maps, error: mErr }, { data: bases, error: bErr }] = await Promise.all([
      supabase.from("majordhome_pennylane_sync")
        .select("local_id, pennylane_id, metadata")
        .eq("org_id", orgId).eq("entity_type", "client").in("pennylane_id", ids),
      supabase.rpc("pennylane_customer_identity_get", { p_org_id: orgId, p_ids: ids }),
    ]);
    if (mErr) throw new Error(`mappings : ${mErr.message}`);
    if (bErr) throw new Error(`bases : ${bErr.message}`);

    const mapsById = new Map<number, Json[]>();
    for (const m of maps ?? []) {
      const k = Number(m.pennylane_id);
      mapsById.set(k, [...(mapsById.get(k) ?? []), m]);
    }
    const baseById = new Map<number, Json>((bases ?? []).map((b: Json) => [Number(b.pennylane_id), b]));
    const { data: lookupRows, error: lErr } = await supabase
      .from("majordhome_pennylane_customer_lookup")
      .select("pennylane_id").eq("org_id", orgId).in("pennylane_id", ids);
    if (lErr) throw new Error(`cache : ${lErr.message}`);
    const inCache = new Set((lookupRows ?? []).map((r: Json) => Number(r.pennylane_id)));

    const relevant = ids.filter((id) => mapsById.has(id) || inCache.has(id));
    const clientIds = relevant.flatMap((id) => (mapsById.get(id) ?? []).map((m) => m.local_id));
    const clientsById = new Map<string, Json>();
    if (clientIds.length > 0) {
      const { data: clients, error: cErr } = await supabase
        .from("majordhome_clients").select(CLIENT_COLUMNS)
        .eq("org_id", orgId).in("id", clientIds);
      if (cErr) throw new Error(`fiches client : ${cErr.message}`);
      for (const c of clients ?? []) clientsById.set(c.id, c);
    }

    const fetched = await inBatches(relevant, async (id) => {
      const r = await plFetch(token, "GET", `/customers/${id}`);
      return { id, ok: r.status === 200 && r.data?.id, data: r.data, status: r.status };
    });
    res.customers_checked = fetched.length;

    const newBaselines: Json[] = [];
    for (const f of fetched) {
      if (!f.ok) { res.errors.push(`customer ${f.id} : ${plErrorMessage(f.status, f.data)}`); continue; }
      const fresh = identityFromPlCustomer(f.data);
      newBaselines.push(cacheRow(f.data, null));
      const base = baseById.get(f.id);
      if (!base) { res.baselines_initialised++; continue; } // 1ʳᵉ photo fiable : rien à comparer
      const changed = changedIdentityFields(base, fresh);
      if (changed.length === 0) continue;

      for (const m of mapsById.get(f.id) ?? []) {
        const client = clientsById.get(m.local_id);
        if (!client) continue;
        const pending: Record<string, string> | null = m.metadata?.pending_push ?? null;
        const plan = planPullUpdate({ changed, plIdentity: fresh, plUpdatedAt: f.data.updated_at ?? null, client, pending });
        res.conflicts_kept_mdh += plan.conflictsKeptMdh.length;
        if (Object.keys(plan.apply).length > 0) {
          const { error: uErr } = await supabase.rpc("pennylane_sync_update_client_fields", {
            p_client_id: m.local_id, p_org_id: orgId, p_fields: plan.apply,
          });
          if (uErr) { res.errors.push(`client ${m.local_id} : ${uErr.message}`); continue; }
          res.clients_updated++;
          res.fields_written += Object.keys(plan.apply).length;
        }
        if (plan.dropPending.length > 0 && pending) {
          const rest = { ...pending };
          for (const c of plan.dropPending) delete rest[c];
          await setPushState(supabase, orgId, m.local_id, rest, Object.keys(rest).length ? "en attente" : null);
          m.metadata = { ...(m.metadata ?? {}), pending_push: rest };
        }
      }
    }
    // La base de diff n'avance qu'APRÈS application : un échec d'écriture MDH ci-dessus est
    // compté en erreur, et la fiche PL sert quand même de nouvelle référence (sinon la même
    // diff se réappliquerait indéfiniment).
    await writeBaseline(supabase, orgId, newBaselines);
  }

  // 3. Rejeu des pushes MDH → PL en attente (après le journal : une modification PL plus
  //    récente a déjà fait tomber la saisie MDH correspondante).
  const { data: pendingRows, error: pErr } = await supabase
    .from("majordhome_pennylane_sync")
    .select("local_id, metadata")
    .eq("org_id", orgId).eq("entity_type", "client").eq("sync_status", "error")
    .not("metadata->pending_push", "is", null)
    .limit(RETRY_MAX_CLIENTS);
  if (pErr) {
    res.errors.push(`saisies en attente : ${pErr.message}`);
  } else {
    for (const row of pendingRows ?? []) {
      const pending = row.metadata?.pending_push ?? {};
      if (Object.keys(pending).length === 0) continue;
      // Les dates de saisie d'origine sont conservées (repassées telles quelles).
      const latest = Object.values(pending).sort().pop() as string;
      const r = await pushClientColumns(supabase, token, orgId, row.local_id, [], latest);
      res.pushes_retried++;
      if (r.status === "failed") { res.pushes_failed++; res.errors.push(`push ${row.local_id} : ${r.error}`); }
    }
  }

  // 4. Passe « base » : photographier les customers pontés qui n'ont pas encore de base fiable.
  //    AUCUNE écriture MDH ici — on ne sait pas ce qui a changé avant la première photo.
  const { data: unbased, error: uErr } = await supabase.rpc("pennylane_customer_unbaselined", {
    p_org_id: orgId, p_limit: BASELINE_MAX_CUSTOMERS,
  });
  if (uErr) {
    res.errors.push(`passe base : ${uErr.message}`);
  } else {
    const list = (unbased ?? []).map((x: Json) => Number(typeof x === "object" ? Object.values(x)[0] : x));
    const got = await inBatches(list, async (id: number) => {
      const r = await plFetch(token, "GET", `/customers/${id}`);
      return r.status === 200 && r.data?.id ? cacheRow(r.data, null) : null;
    });
    const rows = got.filter(Boolean);
    try {
      await writeBaseline(supabase, orgId, rows);
      res.baseline_pass = rows.length;
    } catch (e) {
      res.errors.push(e instanceof Error ? e.message : String(e));
    }
    if (rows.length < list.length) res.errors.push(`passe base : ${list.length - rows.length} customer(s) illisible(s)`);
  }

  const { error: setErr } = await supabase.rpc("pennylane_customer_delta_set_state", {
    p_org_id: orgId,
    p_last_processed_at: new Date(nextSince).toISOString(),
    p_result: res,
  });
  if (setErr) res.errors.push(`curseur non enregistré : ${setErr.message}`);
  return res;
}
