// ============================================================================
// client-change-password — Edge Function Portail Client
// ============================================================================
//
// Change le mot de passe d'un client via admin API.
// Utilisé pour le premier login (must_change_password) ET le reset password.
// Contourne la restriction GoTrue "Secure password change" qui bloque
// updateUser() côté client.
//
// Sécurité : verify_jwt: true, vérifie client_id dans metadata
// Payload POST : { "password": "nouveau_mot_de_passe" }
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, x-app-name, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Vérifier le JWT du client
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No auth header" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user)
      return jsonResponse({ error: "Unauthorized" }, 401);

    // 2. Vérifier que c'est bien un client
    const clientId = user.user_metadata?.client_id;
    if (!clientId) {
      return jsonResponse({ error: "Not a client user" }, 403);
    }

    // 3. Valider le nouveau mot de passe
    const { password } = await req.json();
    if (!password || typeof password !== "string" || password.length < 6) {
      return jsonResponse(
        { error: "Password must be at least 6 characters" },
        400
      );
    }

    // 4. Changer le mot de passe ET retirer le flag via admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      {
        password: password,
        user_metadata: {
          ...user.user_metadata,
          must_change_password: false,
        },
      }
    );

    if (updateError) {
      console.error("[client-change-password] updateUser error:", updateError);
      return jsonResponse({ error: updateError.message }, 500);
    }

    console.log("[client-change-password] password changed for", user.email);
    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[client-change-password] unexpected:", err);
    return jsonResponse(
      { error: "Erreur interne", detail: String(err) },
      500
    );
  }
});
