// ============================================================================
// invite-client — Edge Function Portail Client
// ============================================================================
//
// Crée un compte client avec mot de passe temporaire et envoie un email
// d'invitation brandé Mayer Energie via Resend.
//
// Flow :
//   1. Vérifie le JWT artisan + membership org
//   2. Crée le user auth avec mot de passe temporaire
//   3. Lie le user au client via RPC
//   4. Envoie email avec identifiants via Resend
//
// Le client se connecte → changement de mot de passe obligatoire au 1er login
//
// Sécurité : verify_jwt: true, org membership check
// Payload POST : { "clientId": "uuid" }
// Secrets requis : RESEND_API_KEY
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

const PORTAL_URL = "https://majordhome.vercel.app";
const FROM_EMAIL = "Mayer Energie <contact@mayer-energie.fr>";

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

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pwd = "";
  const array = new Uint8Array(10);
  crypto.getRandomValues(array);
  for (const byte of array) {
    pwd += chars[byte % chars.length];
  }
  return pwd;
}

function buildInviteEmail(
  firstName: string,
  loginLink: string,
  email: string,
  tempPassword: string
): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 20px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background:linear-gradient(135deg,#1e3a5f 0%,#2d5a8e 100%);padding:28px 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="180" style="display:block;margin:0 auto 12px;max-width:180px;height:auto;" />
<p style="margin:0;color:rgba(255,255,255,0.7);font-size:13px;">Espace Client</p>
</td></tr>
<tr><td style="padding:36px 40px 20px;">
<p style="margin:0 0 20px;color:#1a1a1a;font-size:17px;line-height:1.5;">Bonjour <strong>${firstName}</strong>,</p>
<p style="margin:0 0 20px;color:#4a4a4a;font-size:15px;line-height:1.6;">Votre espace client Mayer Energie est pr\u00eat ! Vous pouvez d\u00e9sormais consulter vos informations, suivre vos interventions et acc\u00e9der \u00e0 vos documents en ligne.</p>
<p style="margin:0 0 12px;color:#4a4a4a;font-size:15px;line-height:1.6;">Voici vos identifiants de connexion :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr><td style="background-color:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;">
<table cellpadding="0" cellspacing="0" style="width:100%;">
<tr><td style="padding:4px 0;color:#666;font-size:13px;">Identifiant</td><td style="padding:4px 0;color:#1a1a1a;font-size:15px;font-weight:600;text-align:right;">${email}</td></tr>
<tr><td colspan="2" style="padding:8px 0;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"></td></tr>
<tr><td style="padding:4px 0;color:#666;font-size:13px;">Mot de passe temporaire</td><td style="padding:4px 0;color:#1a1a1a;font-size:15px;font-weight:600;font-family:monospace;letter-spacing:1px;text-align:right;">${tempPassword}</td></tr>
</table>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding-bottom:24px;">
<a href="${loginLink}" style="display:inline-block;background-color:#2d5a8e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:8px;">Se connecter</a>
</td></tr></table>
<p style="margin:0 0 12px;color:#e67e22;font-size:13px;line-height:1.5;">\u26a0\ufe0f Vous serez invit\u00e9(e) \u00e0 changer votre mot de passe lors de votre premi\u00e8re connexion.</p>
<p style="margin:0 0 12px;color:#888;font-size:13px;">Si vous n'avez pas demand\u00e9 cet acc\u00e8s, vous pouvez ignorer cet email.</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #eee;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 28px;">
<p style="margin:0 0 16px;color:#1a1a1a;font-size:14px;font-weight:600;">Sur votre espace, vous trouverez :</p>
<table cellpadding="0" cellspacing="0" style="width:100%;">
<tr><td style="padding:6px 0;color:#4a4a4a;font-size:14px;">\u2705 Vos informations et coordonn\u00e9es</td></tr>
<tr><td style="padding:6px 0;color:#4a4a4a;font-size:14px;">\u2705 Votre contrat d'entretien</td></tr>
<tr><td style="padding:6px 0;color:#4a4a4a;font-size:14px;">\u2705 Vos \u00e9quipements et leur suivi</td></tr>
<tr><td style="padding:6px 0;color:#4a4a4a;font-size:14px;">\u2705 L'historique de vos interventions et certificats</td></tr>
</table>
</td></tr>
<tr><td style="background-color:#f8f9fb;padding:24px 40px;text-align:center;border-top:1px solid #eee;">
<p style="margin:0 0 4px;color:#888;font-size:12px;">Mayer Energie</p>
<p style="margin:0;color:#aaa;font-size:11px;">Gaillac (81) \u00b7 05 63 81 02 65 \u00b7 contact@mayer-energie.fr</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No auth header" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: artisan },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !artisan)
      return jsonResponse({ error: "Unauthorized" }, 401);

    const { clientId } = await req.json();
    if (!clientId)
      return jsonResponse({ error: "clientId is required" }, 400);

    const { data: client, error: clientError } = await supabase
      .from("majordhome_clients_all")
      .select("id, email, org_id, first_name, last_name, auth_user_id")
      .eq("id", clientId)
      .single();
    if (clientError || !client)
      return jsonResponse({ error: "Client introuvable" }, 404);

    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("user_id", artisan.id)
      .eq("org_id", client.org_id)
      .eq("status", "active")
      .maybeSingle();
    if (!membership)
      return jsonResponse({ error: "Non autorise" }, 403);

    if (!client.email)
      return jsonResponse({ error: "Pas d'email" }, 400);
    if (client.auth_user_id)
      return jsonResponse({ error: "Acces portail deja actif" }, 409);

    const displayName =
      [client.first_name, client.last_name].filter(Boolean).join(" ") ||
      "Client";
    const firstName = client.first_name || "Client";

    // 1. Générer mot de passe temporaire
    const tempPassword = generateTempPassword();

    // 2. Créer le user auth avec le mot de passe temporaire
    const { data: createData, error: createError } =
      await supabase.auth.admin.createUser({
        email: client.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          full_name: displayName,
          client_id: client.id,
          must_change_password: true,
        },
      });

    if (createError) {
      console.error("[invite-client] createUser error:", createError);
      if (createError.message?.includes("already been registered")) {
        return jsonResponse(
          { error: "Un compte existe deja pour cet email" },
          409
        );
      }
      return jsonResponse({ error: createError.message }, 500);
    }

    const newUserId = createData.user.id;
    console.log("[invite-client] user created:", newUserId);

    // 3. Lier via RPC (évite le problème schema)
    const { error: linkError } = await supabase.rpc("link_client_auth", {
      p_client_id: clientId,
      p_auth_user_id: newUserId,
    });

    if (linkError) {
      console.error("[invite-client] link error:", linkError);
      return jsonResponse(
        { error: "Compte cree mais lien echoue" },
        500
      );
    }
    console.log("[invite-client] client linked");

    // 4. Email via Resend avec identifiants
    const loginLink = PORTAL_URL + "/login?from=portal";
    const emailHtml = buildInviteEmail(
      firstName,
      loginLink,
      client.email,
      tempPassword
    );

    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: client.email,
          subject: "Votre espace client Mayer Energie est pret",
          html: emailHtml,
          reply_to: "contact@mayer-energie.fr",
        }),
      });
      const resendResult = await resendRes.json();
      if (!resendRes.ok) {
        console.error("[invite-client] Resend error:", resendResult);
      } else {
        console.log("[invite-client] email sent:", resendResult.id);
      }
    } catch (emailErr) {
      console.error("[invite-client] email fetch error:", emailErr);
    }

    console.log("[invite-client] done for", client.email);
    return jsonResponse({
      success: true,
      userId: newUserId,
      email: client.email,
    });
  } catch (err) {
    console.error("[invite-client] unexpected:", err);
    return jsonResponse(
      { error: "Erreur interne", detail: String(err) },
      500
    );
  }
});
