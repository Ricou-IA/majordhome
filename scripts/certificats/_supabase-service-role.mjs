/**
 * Remplaçant de `src/lib/supabaseClient.js` pour les scripts Node.
 * ============================================================================
 * Le bundle (esbuild) des services de l'app redirige tout import de
 * `supabaseClient` vers ce module : même API (`supabase` nommé + défaut),
 * mais un client service_role lu dans l'environnement (DST_URL / DST_KEY),
 * sans session navigateur ni localStorage.
 *
 * Les services tournent donc tels quels (un seul écrivain : `savService`,
 * `certificatsService`) — RLS contournée par service_role, GRANTs de la charte
 * multi-tenant toujours en vigueur (SELECT/UPDATE/INSERT accordés sur les
 * tables concernées, vérifié le 2026-10-01).
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.DST_URL;
const key = process.env.DST_KEY;
if (!url || !key) {
  throw new Error('DST_URL / DST_KEY absents de l’environnement (passer --env .env.local)');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { enabled: false },
  global: { headers: { 'x-app-name': 'majordhome-script-certificats' } },
});

export default supabase;
