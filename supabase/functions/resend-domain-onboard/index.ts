// ============================================================================
// resend-domain-onboard — Connecteur d'onboarding d'un domaine d'envoi Resend
// ============================================================================
//
// Permet à une org (entreprise cliente) de configurer SON propre domaine
// d'envoi dans le compte Resend partagé (app-level), sans passer par le
// dashboard Resend manuellement.
//
// Architecture (cf. discussion ORG=règles / APP=moteur) :
//   - Le moteur Resend (clé API) est app-level → 1 compte partagé, 1 secret.
//   - Le domaine d'envoi est org-level → dérivé de settings.from_email.
//
// L'edge est un PROXY MINCE et STATELESS vers l'API Domains de Resend :
// elle ne persiste rien elle-même. Le frontend persiste le résultat dans
// core.organizations.settings.resend via useOrgSettings().save().
//
// Sécurité :
//   - verify_jwt:true + requireOrgMembership(org_admin) → seul un admin de
//     l'org peut manipuler le domaine.
//   - Le domaine géré est TOUJOURS dérivé de settings.from_email de l'org
//     ciblée (pas un input libre) → un admin ne peut pas enregistrer un
//     domaine arbitraire dans le compte Resend partagé.
//
// Actions (body { action, org_id }) :
//   - "setup"  : crée le domaine dans Resend s'il n'existe pas (région EU),
//                renvoie l'id + le statut + les records DNS à publier.
//   - "status" : renvoie le statut + records courants (GET, idempotent).
//   - "verify" : déclenche la vérification Resend puis renvoie le statut frais.
//
// Réponse : { domain, id, status, region, records: [...] }
//
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (via _shared/auth),
//              RESEND_API_KEY.
// ============================================================================

import {
  requireOrgMembership,
  jsonResponse,
  buildCorsHeaders,
  sanitizeError,
} from "../_shared/auth.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_BASE = "https://api.resend.com";
// Région EU pour la résidence des données (RGPD — clients français).
const RESEND_REGION = "eu-west-1";

interface ResendRecord {
  record?: string;
  name?: string;
  type?: string;
  ttl?: string;
  status?: string;
  value?: string;
  priority?: number;
}

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  region?: string;
  records?: ResendRecord[];
}

async function resendFetch(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const resp = await fetch(`${RESEND_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = {};
  try {
    data = await resp.json();
  } catch {
    // réponse non-JSON (rare)
  }
  return { ok: resp.ok, status: resp.status, data };
}

// Trouve un domaine par nom dans le compte Resend (liste paginée simple).
async function findDomainByName(name: string): Promise<ResendDomain | null> {
  const { ok, data } = await resendFetch("/domains", "GET");
  if (!ok) return null;
  const list: ResendDomain[] = Array.isArray(data?.data) ? data.data : [];
  const lower = name.toLowerCase();
  return list.find((d) => (d.name || "").toLowerCase() === lower) || null;
}

// Récupère un domaine complet (avec records) par id.
async function getDomain(id: string): Promise<ResendDomain | null> {
  const { ok, data } = await resendFetch(`/domains/${id}`, "GET");
  if (!ok) return null;
  return data as ResendDomain;
}

function shape(d: ResendDomain | null, domain: string) {
  if (!d) {
    return { domain, id: null, status: "not_started", region: RESEND_REGION, records: [] };
  }
  return {
    domain: d.name || domain,
    id: d.id,
    status: d.status || "pending",
    region: d.region || RESEND_REGION,
    records: d.records || [],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }
  if (!RESEND_API_KEY) {
    return jsonResponse({ error: "RESEND_API_KEY not configured" }, 500, req);
  }

  let body: { action?: string; org_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, req);
  }

  const action = (body.action || "").trim();
  if (!["setup", "status", "verify"].includes(action)) {
    return jsonResponse({ error: "Invalid action (setup|status|verify)" }, 400, req);
  }

  // Auth : org_admin de l'org ciblée
  const auth = await requireOrgMembership(req, {
    orgId: body.org_id,
    requiredRole: "org_admin",
  });
  if (!auth.ok) return auth.response;
  const { orgId, supabase } = auth;

  try {
    // Dériver le domaine depuis settings.from_email de l'org (pas un input libre)
    const { data: org, error: orgErr } = await supabase
      .schema("core")
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .single();

    if (orgErr || !org) {
      return jsonResponse({ error: "Organisation introuvable" }, 404, req);
    }

    const settings = (org.settings as Record<string, string | null> | null) || {};
    const fromEmail = (settings.from_email || "").trim();
    const domain = fromEmail.includes("@") ? fromEmail.split("@")[1].toLowerCase() : "";

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return jsonResponse(
        {
          error:
            "Renseigne d'abord un email expéditeur valide (settings.from_email) avant de configurer le domaine.",
        },
        400,
        req,
      );
    }

    let result: ResendDomain | null;

    if (action === "setup") {
      const existing = await findDomainByName(domain);
      if (existing) {
        // Déjà présent dans le compte → renvoyer ses records frais
        result = (await getDomain(existing.id)) || existing;
      } else {
        const { ok, status, data } = await resendFetch("/domains", "POST", {
          name: domain,
          region: RESEND_REGION,
        });
        if (!ok) {
          return jsonResponse(
            { error: data?.message || data?.error || `Resend HTTP ${status}` },
            502,
            req,
          );
        }
        result = data as ResendDomain;
      }
    } else if (action === "status") {
      const existing = await findDomainByName(domain);
      result = existing ? (await getDomain(existing.id)) || existing : null;
    } else {
      // verify
      const existing = await findDomainByName(domain);
      if (!existing) {
        return jsonResponse(
          { error: "Domaine non encore configuré — lance 'setup' d'abord." },
          400,
          req,
        );
      }
      const { ok, status, data } = await resendFetch(
        `/domains/${existing.id}/verify`,
        "POST",
      );
      if (!ok) {
        return jsonResponse(
          { error: data?.message || data?.error || `Resend HTTP ${status}` },
          502,
          req,
        );
      }
      // La vérif est asynchrone → relire le domaine pour le statut + records frais
      result = (await getDomain(existing.id)) || existing;
    }

    return jsonResponse(shape(result, domain), 200, req);
  } catch (err) {
    return jsonResponse({ error: sanitizeError(err, "resend-domain-onboard failed") }, 500, req);
  }
});
