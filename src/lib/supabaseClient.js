import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Variables Supabase manquantes!');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: { enabled: false },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storage: localStorage,
    // Suffixe -v2 posé le 2026-08-12 pour invalider les sessions d'AVANT la
    // migration Supabase du 10/08. Un jeton émis par l'ancien projet ne valide
    // plus sur le nouveau : son rafraîchissement échoue sans passer par
    // SIGNED_OUT, donc l'app reste affichée et enchaîne les 401 silencieux —
    // écrans vides, et même la déconnexion renvoie 403 puisqu'elle réutilise ce
    // jeton mort. Constaté en vrai sur un onglet ouvert avant la bascule.
    // Changer la clé rend toute session antérieure invisible : chacun retombe
    // proprement sur l'écran de connexion, une fois. Déterministe, là où une
    // gestion d'erreur demanderait de deviner l'événement émis par supabase-js.
    // ⚠️ Ne pas re-changer cette clé sans raison : chaque changement déconnecte
    // tout le monde.
    storageKey: 'majordhome-auth-v2',
  },
  global: {
    headers: { 'x-app-name': 'majordhome-artisan' },
  },
});

export default supabase;
