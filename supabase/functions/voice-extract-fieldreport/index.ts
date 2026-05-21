// ============================================================================
// voice-extract-fieldreport — Extraction structurée d'un mémo vocal CVC
// Phase 1 voice agent — Mayer Énergie
// ----------------------------------------------------------------------------
// Input : { transcript, memo_type: 'rdv_terrain'|'reunion'|'note_libre', context? }
// Output : { extraction, model, processing_time_ms }
//
// Réutilise OPENAI_API_KEY déjà en secret (transcribe-dictation, meeting-extract).
// Pas d'écriture DB ici — c'est la RPC `record_voice_memo_extraction` qui le fait
// dans le workflow N8N en aval.
//
// Sécurité (P0.6 — 2026-05-21, refactor helper P0.25 — 2026-05-21) :
//   - verify_jwt: false (appelé par workflow N8n machine-to-machine)
//   - requireSharedSecret(MDH_CRON_SECRET) — défense unique contre invocation
//     non autorisée. Sans ce secret, l'edge était publiquement appelable et
//     exploitable pour brûler le quota Anthropic/OpenAI.
//   - Quota daily user×org : enforced via RPC increment_voice_quota si le
//     workflow N8n passe user_id + org_id dans le body (transition douce :
//     skip check + warn si absents). Voir migration p0_6_voice_quotas.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  getAdminClient,
  jsonResponse,
  requireSharedSecret,
} from "../_shared/auth.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o";
const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";
const VOICE_DAILY_LIMIT = parseInt(
  Deno.env.get("VOICE_DAILY_LIMIT") || "20",
  10,
);

// ---------------------------------------------------------------------------
// EQUIPMENT TYPE CODES — liste fermée (source : majordhome.pricing_equipment_types)
// L'IA DOIT choisir une valeur dans cette liste, ou null si rien ne matche.
// ---------------------------------------------------------------------------

const EQUIPMENT_TYPE_CODES = `
- chaudiere_bois          : Chaudière bois bûches
- chaudiere_granules      : Chaudière à granulés (pellets)
- gainable                : Climatisation gainable
- pac_air_air             : PAC Air/Air (= climatisation classique)
- pac_air_eau             : PAC Air/Eau (chauffage central)
- ballon_thermo           : Ballon thermodynamique
- chauffe_eau_solaire     : Chauffe-eau solaire
- panneau_photovoltaique  : Panneau photovoltaïque
- prestation_diverses     : Prestation diverse / autre travaux
- TRAV_ELEC               : Travaux électricité
- poele_bois_insert       : Poêle à bois ou insert
- poele_granules_elec     : Poêle à granulés (électronique, pilotage)
- poele_granules_sans_elec: Poêle à granulés (sans électronique)
- poele_hydro             : Poêle hydro (raccordé chauffage central)
`;

// ---------------------------------------------------------------------------
// PROMPTS
// ---------------------------------------------------------------------------

function systemPromptRdvTerrain() {
  return `Tu es un assistant qui aide un responsable d'exploitation Mayer Énergie (artisan CVC à Gaillac, Tarn) à structurer ses comptes-rendus de RDV terrain.

Mayer Énergie installe :
- Chauffage : poêles bois/granulés, chaudières, PAC air/eau
- Climatisation : PAC air/air, gainables
- Eau chaude : ballons thermodynamiques, solaire
- Photovoltaïque
- Travaux électricité

Tu extrais d'un mémo vocal (1-3 min) les informations strictement présentes dans le verbatim. **Tu n'inventes JAMAIS d'information.** Si une info n'est pas dans le mémo, tu mets null et tu listes le champ dans champs_manquants.

Tu réponds uniquement en JSON valide.`;
}

function userPromptRdvTerrain(transcript: string, durationSeconds?: number) {
  return `MÉMO VOCAL (${durationSeconds ?? "?"}s) :
"""
${transcript}
"""

Extrait un JSON strict suivant ce schéma :

{
  "voice_memo_meta": {
    "spoken_language": "fr-FR",
    "duration_seconds": ${durationSeconds ?? "null"},
    "confidence": "high|medium|low"  // ta confiance globale dans l'extraction
  },
  "client": {
    "first_name": "string ou null",
    "last_name": "string ou null",
    "display_name": "string ou null (souvent NOM Prénom en CVC)",
    "phone": "string ou null (format français normalisé)",
    "email": "string ou null",
    "address": "string ou null",
    "postal_code": "string ou null",
    "city": "string ou null",
    "client_category": "particulier|entreprise"  // par défaut particulier
  },
  "logement": {
    "housing_type": "maison|appartement|local_commercial|autre|null",
    "construction_year": "integer ou null",
    "surface_m2": "integer ou null",
    "energie_actuelle": "string libre ou null (ex: 'gaz', 'fioul', 'elec', 'bois')",
    "isolation_etat": "string libre ou null"
  },
  "projet": {
    "equipment_type_code": "valeur de la liste ci-dessous ou null",
    "type_travaux": ["installation", "remplacement", "depose", ...],  // liste libre
    "budget_evoque_eur": "integer ou null",
    "urgence": "faible|moyenne|forte|null",
    "eligibilite_mpr": "oui|non|inconnu",
    "eligibilite_cee": "oui|non|inconnu"
  },
  "engagements": {
    "documents_a_envoyer": ["devis", "fiche technique XYZ", ...],
    "delai_devis_jours": "integer ou null",
    "rappel_a_prevoir": "boolean",
    "prochaine_etape": "string libre ou null",
    "tasks": [
      {
        "title": "string court actionnable",
        "due_date": "YYYY-MM-DD ou null",
        "is_urgent": "boolean",
        "is_important": "boolean"
      }
    ]
  },
  "notes_libres": "string — ce qui n'entre dans aucune autre rubrique",
  "champs_manquants": ["liste des champs importants absents du mémo (ex: 'email', 'construction_year')"]
}

LISTE FERMÉE equipment_type_code (choisis EXACTEMENT une de ces valeurs ou null) :
${EQUIPMENT_TYPE_CODES}

RÈGLES :
- Réponds UNIQUEMENT avec le JSON, sans texte avant/après, sans markdown
- N'invente RIEN. Si l'info n'est pas dans le mémo → null + ajout dans champs_manquants
- equipment_type_code doit être STRICTEMENT une des valeurs listées (ou null)
- Pour les noms : si l'utilisateur dit "Monsieur Martin", first_name=null, last_name="Martin"
- Phone : normalise au format 0X XX XX XX XX si possible
- Dates relatives ("vendredi", "dans 5 jours") → calcule à partir d'aujourd'hui
- Tâches : extrait celles explicitement mentionnées dans le mémo, créé en plus 1-2 tâches "métier" évidentes (ex: "Envoyer le devis sous {delai_devis_jours} jours" si délai mentionné)
- confidence = "low" si transcript truncated/peu compréhensible, "medium" si plusieurs ambiguïtés, "high" si tout est clair`;
}

function systemPromptReunion() {
  return `Tu es un assistant qui aide Mayer Énergie à structurer ses comptes-rendus de réunion (interne, fournisseur, partenaire). Tu extrais des informations strictement présentes dans le verbatim. Tu n'inventes JAMAIS rien. Réponds uniquement en JSON valide.`;
}

function userPromptReunion(transcript: string, durationSeconds?: number) {
  return `MÉMO RÉUNION (${durationSeconds ?? "?"}s) :
"""
${transcript}
"""

Extrait un JSON strict suivant ce schéma :

{
  "voice_memo_meta": {
    "spoken_language": "fr-FR",
    "duration_seconds": ${durationSeconds ?? "null"},
    "confidence": "high|medium|low"
  },
  "summary": "résumé en 3-5 phrases",
  "participants": [
    { "name": "string", "role": "string ou null" }
  ],
  "topics": [
    { "subject": "string court", "details": "string" }
  ],
  "decisions": [
    { "subject": "string", "content": "string" }
  ],
  "actions": [
    {
      "title": "string court actionnable",
      "responsible": "string ou null (nom)",
      "due_date": "YYYY-MM-DD ou null",
      "is_urgent": "boolean"
    }
  ],
  "issues": [
    { "subject": "string", "content": "string" }
  ],
  "notes_libres": "string verbatim non structuré"
}

RÈGLES :
- Réponds UNIQUEMENT avec le JSON, sans markdown
- N'invente RIEN ; si rien n'est mentionné, mets [] ou null
- Distingue DÉCISION (engagement pris) vs ACTION (tâche à faire)
- Les actions doivent être assignables (un nom de responsable si possible)`;
}

function systemPromptNoteLibre() {
  return `Tu es un assistant qui structure une note vocale libre Mayer Énergie. Tu extrais ce qui est dit, sans inventer. Réponds uniquement en JSON valide.`;
}

function userPromptNoteLibre(transcript: string, durationSeconds?: number) {
  return `NOTE VOCALE (${durationSeconds ?? "?"}s) :
"""
${transcript}
"""

Extrait un JSON strict suivant ce schéma :

{
  "voice_memo_meta": {
    "spoken_language": "fr-FR",
    "duration_seconds": ${durationSeconds ?? "null"},
    "confidence": "high|medium|low"
  },
  "summary": "résumé en 1-2 phrases",
  "topic_tags": ["tags en français lowercase"],
  "tasks": [
    {
      "title": "string court actionnable",
      "due_date": "YYYY-MM-DD ou null",
      "is_urgent": "boolean",
      "is_important": "boolean"
    }
  ],
  "notes_libres": "verbatim non structuré"
}

RÈGLES :
- Réponds UNIQUEMENT avec le JSON, sans markdown
- N'invente rien ; si pas de tâche identifiable → tasks: []`;
}

// ---------------------------------------------------------------------------
// LLM dispatcher : préfère Claude Sonnet 4.6 (meilleur en français), fallback GPT-4o
// ---------------------------------------------------------------------------

interface LLMResult {
  json: unknown;
  model_used: string;
  tokens_in?: number;
  tokens_out?: number;
}

function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    let cleaned = String(content).trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    return JSON.parse(cleaned.trim());
  }
}

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
): Promise<LLMResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const fullSystem = `${systemPrompt}\n\nIMPORTANT: Tu réponds UNIQUEMENT avec un JSON valide, sans markdown, sans texte avant/après.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      temperature: 0.2,
      system: fullSystem,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error("Empty response from Anthropic");

  return {
    json: tryParseJson(content),
    model_used: ANTHROPIC_MODEL,
    tokens_in: data.usage?.input_tokens,
    tokens_out: data.usage?.output_tokens,
  };
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
): Promise<LLMResult> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  return {
    json: tryParseJson(content),
    model_used: OPENAI_MODEL,
    tokens_in: data.usage?.prompt_tokens,
    tokens_out: data.usage?.completion_tokens,
  };
}

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
): Promise<LLMResult> {
  // Préfère Claude (meilleur extraction française) si la clé est dispo
  if (ANTHROPIC_API_KEY) {
    try {
      return await callClaude(systemPrompt, userPrompt);
    } catch (err) {
      console.warn(`[voice-extract] Claude failed, fallback OpenAI: ${err instanceof Error ? err.message : err}`);
      if (!OPENAI_API_KEY) throw err;
    }
  }
  return callOpenAI(systemPrompt, userPrompt);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // P0.6 — Auth shared secret (même convention que crons Pennylane).
  const authError = requireSharedSecret(req, MDH_CRON_SECRET, "MDH_CRON_SECRET");
  if (authError) return authError;

  const startTime = Date.now();

  try {
    const body = await req.json();
    const {
      transcript,
      memo_type,
      duration_seconds,
      user_id,
      org_id,
    } = body || {};

    // Validation transcript AVANT quota (un input invalide ne consomme pas
    // un slot quota du user).
    if (!transcript || typeof transcript !== "string") {
      return jsonResponse({ error: "Missing required field: transcript (string)" }, 400);
    }
    if (transcript.length < 10) {
      return jsonResponse({ error: "Transcript too short (< 10 chars)" }, 400);
    }
    if (transcript.length > 50000) {
      return jsonResponse({ error: "Transcript too long (> 50k chars)" }, 400);
    }

    const type = memo_type || "rdv_terrain";
    if (!["rdv_terrain", "reunion", "note_libre"].includes(type)) {
      return jsonResponse({ error: `Invalid memo_type: ${type}` }, 400);
    }

    // P0.6 follow-up — Quota daily user×org. Enforced si user_id + org_id
    // fournis par N8n. Transition douce : warn + skip si absents (le temps
    // de mettre à jour le workflow N8n pour passer les 2 champs).
    if (user_id && org_id) {
      const supabase = getAdminClient();
      const { data: quotaResult, error: quotaError } = await supabase.rpc(
        "increment_voice_quota",
        {
          p_user_id: user_id,
          p_org_id: org_id,
          p_daily_limit: VOICE_DAILY_LIMIT,
        },
      );
      if (quotaError) {
        // Code Postgres P0001 = RAISE EXCEPTION dans la RPC → quota dépassé
        if (
          quotaError.code === "P0001" ||
          /voice_quota_exceeded/i.test(quotaError.message)
        ) {
          console.warn(
            `[voice-extract] quota exceeded user=${user_id} org=${org_id} limit=${VOICE_DAILY_LIMIT}`,
          );
          return jsonResponse(
            {
              success: false,
              error: "Voice quota exceeded",
              quota: { limit: VOICE_DAILY_LIMIT },
            },
            429,
          );
        }
        // Autre erreur DB : on log mais on continue (ne pas casser le flow
        // pour une panne de compteur).
        console.error(
          `[voice-extract] quota RPC error (non-blocking): ${quotaError.message}`,
        );
      } else {
        console.log(
          `[voice-extract] quota ok user=${user_id} org=${org_id} → ${JSON.stringify(quotaResult)}`,
        );
      }
    } else {
      console.warn(
        "[voice-extract] no user_id/org_id in body — quota check skipped (update N8n workflow to enforce)",
      );
    }

    let systemPrompt: string;
    let userPrompt: string;

    if (type === "reunion") {
      systemPrompt = systemPromptReunion();
      userPrompt = userPromptReunion(transcript, duration_seconds);
    } else if (type === "note_libre") {
      systemPrompt = systemPromptNoteLibre();
      userPrompt = userPromptNoteLibre(transcript, duration_seconds);
    } else {
      systemPrompt = systemPromptRdvTerrain();
      userPrompt = userPromptRdvTerrain(transcript, duration_seconds);
    }

    console.log(
      `[voice-extract] type=${type} transcript=${transcript.length}chars duration=${duration_seconds ?? "?"}s`,
    );

    const { json: extraction, model_used, tokens_in, tokens_out } = await callLLM(
      systemPrompt,
      userPrompt,
    );

    const totalMs = Date.now() - startTime;
    console.log(
      `[voice-extract] done in ${totalMs}ms model=${model_used} (in=${tokens_in} out=${tokens_out})`,
    );

    return jsonResponse({
      success: true,
      memo_type: type,
      extraction,
      model: model_used,
      processing_time_ms: totalMs,
      tokens: { input: tokens_in, output: tokens_out },
    });
  } catch (err) {
    console.error("[voice-extract] error:", err);
    return jsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal error",
      },
      500,
    );
  }
});
