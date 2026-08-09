import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GOOGLE_REVIEWS_URL = "https://g.page/r/CX5QpYfID75jEBM/review";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const logId = url.searchParams.get("log_id");

  // Toujours rediriger, meme si le tracking echoue
  const redirectResponse = new Response(null, {
    status: 302,
    headers: { Location: GOOGLE_REVIEWS_URL },
  });

  if (!logId) {
    console.log("[avis-redirect] No log_id provided");
    return redirectResponse;
  }

  // Tracker le clic
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    console.log(`[avis-redirect] Tracking click for log_id=${logId}`);

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Utiliser la vue publique (pas schema majordhome)
    const { data, error } = await supabase
      .from('majordhome_sms_logs')
      .update({ clicked_at: new Date().toISOString() })
      .eq('id', logId)
      .is('clicked_at', null);

    if (error) {
      console.error(`[avis-redirect] Update error:`, JSON.stringify(error));
    } else {
      console.log(`[avis-redirect] Click tracked successfully for ${logId}`);
    }
  } catch (e) {
    console.error("[avis-redirect] Tracking error:", e);
  }

  return redirectResponse;
});
