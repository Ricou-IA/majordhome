// ============================================================================
// company-document-extract — lecture IA d'un document de l'entreprise
// ============================================================================
//
// Settings → Organisation → Identité → « Documents de l'entreprise » : à chaque
// dépôt d'un certificat de qualification, d'une attestation de capacité fluides
// ou d'une attestation d'assurance, le front appelle cette edge qui lit le
// fichier (PDF / JPG / PNG) avec Claude Haiku et renvoie les champs utiles.
//
// L'edge est STATELESS : elle ne persiste rien, le front range le résultat dans
// settings.company_documents (champs modifiables à l'écran — l'IA propose,
// l'humain valide). Échec de lecture ⇒ erreur explicite, jamais un champ inventé.
//
// Sécurité : verify_jwt:true + requireOrgMembership(org_admin). Le chemin doit
// appartenir au dossier documents de l'org ciblée (pas de lecture cross-org).
//
// Body : { org_id, kind, path }
// Réponse : { extracted: { intitule, numero, organisme, titulaire, valid_until, lisible } }
//
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (via _shared/auth),
//              ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import {
  requireOrgMembership,
  jsonResponse,
  buildCorsHeaders,
  sanitizeError,
} from "../_shared/auth.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-haiku-5-5";
const BUCKET = "product-documents";
const MAX_BYTES = 5 * 1024 * 1024;

const KIND_PROMPTS: Record<string, string> = {
  certifications:
    "Ce document est un certificat de qualification d'une entreprise du bâtiment (RGE : QualiBois, QualiPAC, QualiPV, QualiSol, Qualibat, Qualifelec…). " +
    "intitule = le nom de la qualification telle qu'écrite (ex. « QualiBois Air », « QualiPAC module chauffage et ECS »), sans l'organisme et sans mention de statut comme « probatoire ». " +
    "numero = le numéro de qualification ou de certificat (ex. « QB 84566 »). organisme = l'organisme qualificateur (ex. Qualit'EnR, Qualibat).",
  attestation_fluides:
    "Ce document est une attestation de capacité à manipuler les fluides frigorigènes. " +
    "intitule = « Attestation de capacité » suivi de la catégorie si elle figure. numero = le numéro d'attestation. organisme = l'organisme agréé qui l'a délivrée.",
  attestation_assurance:
    "Ce document est une attestation d'assurance professionnelle (décennale et/ou responsabilité civile). " +
    "intitule = la ou les garanties couvertes (ex. « Décennale et RC professionnelle »). numero = le numéro de police ou de contrat. organisme = l'assureur.",
};

const SCHEMA = {
  type: "object",
  properties: {
    lisible: { type: "boolean", description: "false si le document est illisible ou n'est pas du type attendu" },
    intitule: { type: ["string", "null"] },
    numero: { type: ["string", "null"] },
    organisme: { type: ["string", "null"] },
    titulaire: { type: ["string", "null"], description: "raison sociale de l'entreprise titulaire" },
    valid_until: { type: ["string", "null"], description: "date de fin de validité au format YYYY-MM-DD" },
  },
  required: ["lisible", "intitule", "numero", "organisme", "titulaire", "valid_until"],
  additionalProperties: false,
};

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, 120) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500, req);
  }

  let body: { org_id?: string; kind?: string; path?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, req);
  }

  const kind = (body.kind || "").trim();
  const path = (body.path || "").trim();
  if (!KIND_PROMPTS[kind]) {
    return jsonResponse({ error: "Invalid kind" }, 400, req);
  }

  const auth = await requireOrgMembership(req, { orgId: body.org_id, requiredRole: "org_admin" });
  if (!auth.ok) return auth.response;
  const { orgId, supabase } = auth;

  // Le fichier doit être dans le dossier documents de CETTE org et de CETTE nature.
  if (!path.startsWith(`${orgId}/branding/documents/${kind}/`) || path.includes("..")) {
    return jsonResponse({ error: "Invalid path" }, 403, req);
  }

  try {
    const { data: file, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
    if (dlErr || !file) {
      return jsonResponse({ error: "Document introuvable" }, 404, req);
    }
    if (file.size > MAX_BYTES) {
      return jsonResponse({ error: "Document trop lourd" }, 413, req);
    }
    const mime = file.type || (path.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    const data = toBase64(new Uint8Array(await file.arrayBuffer()));

    let source: Anthropic.ContentBlockParam;
    if (mime === "application/pdf") {
      source = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
    } else if (mime === "image/png" || mime === "image/jpeg") {
      source = { type: "image", source: { type: "base64", media_type: mime, data } };
    } else {
      return jsonResponse({ error: "Format non pris en charge" }, 415, req);
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system:
        "Tu extrais des informations d'un document administratif français. " +
        "Ne recopie que ce qui est écrit sur le document : si une information n'y figure pas, mets null, n'invente jamais. " +
        "Les dates sont converties au format YYYY-MM-DD.",
      messages: [
        {
          role: "user",
          content: [source, { type: "text", text: KIND_PROMPTS[kind] }],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return jsonResponse({ error: "Lecture refusée par le modèle" }, 422, req);
    }
    if (response.stop_reason === "max_tokens") {
      return jsonResponse({ error: "Lecture incomplète" }, 502, req);
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return jsonResponse({ error: "Réponse vide du modèle" }, 502, req);
    }
    const raw = JSON.parse(text.text) as Record<string, unknown>;
    const validUntil = clean(raw.valid_until);

    return jsonResponse({
      extracted: {
        lisible: raw.lisible === true,
        intitule: clean(raw.intitule),
        numero: clean(raw.numero),
        organisme: clean(raw.organisme),
        titulaire: clean(raw.titulaire),
        valid_until: validUntil && /^\d{4}-\d{2}-\d{2}$/.test(validUntil) ? validUntil : null,
      },
    }, 200, req);
  } catch (err) {
    return jsonResponse({ error: sanitizeError(err, "Lecture du document impossible") }, 500, req);
  }
});
