// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  TRANSCRIBE-DICTATION - Transcription audio rapide via Whisper              ║
// ║  Edge Function Supabase                                                      ║
// ╠══════════════════════════════════════════════════════════════════════════════╣
// ║  Version: 1.0.0                                                              ║
// ║  - Transcription simple sans analyse GPT                                     ║
// ║  - Optimisé pour les dictées rapides (< 2 min)                              ║
// ║  - Pas de sauvegarde en BDD (géré côté frontend)                            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Gestion du "Pre-flight" CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    console.log("🎤 START TRANSCRIBE-DICTATION [v1.0.0]");

    // 1. Initialisation & Vérification des Clés
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

    if (!openaiApiKey) {
      throw new Error('Clé API OpenAI manquante (OPENAI_API_KEY)');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const openai = new OpenAI({ apiKey: openaiApiKey });

    // 2. Vérification de l'Authentification
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Token d\'authentification manquant');
    }

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Utilisateur invalide ou session expirée');
    }

    console.log(`👤 User: ${user.id}`);

    // 3. Récupération du fichier Audio
    const formData = await req.formData();
    const audioFile = formData.get('audio');

    // Vérification stricte
    if (!audioFile || !(audioFile instanceof File) || audioFile.size === 0) {
      console.error("❌ Fichier manquant. Clés reçues:", Array.from(formData.keys()));
      throw new Error('Fichier audio manquant ou vide');
    }

    const fileSizeMB = (audioFile.size / 1024 / 1024).toFixed(2);
    console.log(`🎤 Audio reçu: ${audioFile.name} (${fileSizeMB} MB, ${audioFile.type})`);

    // Vérifier la taille (max 25 MB pour Whisper)
    if (audioFile.size > 25 * 1024 * 1024) {
      throw new Error('Fichier audio trop volumineux (max 25 MB)');
    }

    // 4. Transcription avec OpenAI Whisper
    console.log("👂 Envoi à Whisper...");

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "fr",
      response_format: "verbose_json", // Pour avoir la durée
    });

    const transcript = transcription.text;
    const durationSeconds = transcription.duration || 0;

    console.log(`✅ Transcription OK (${durationSeconds.toFixed(1)}s, ${transcript.length} chars)`);

    // 5. Calcul du temps de traitement
    const processingTime = Date.now() - startTime;
    console.log(`⏱️ Temps total: ${processingTime}ms`);

    // 6. Réponse
    return new Response(
      JSON.stringify({
        success: true,
        transcript: transcript,
        duration_seconds: Math.round(durationSeconds),
        processing_time_ms: processingTime,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue';
    console.error('❌ Erreur:', errorMessage);

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
