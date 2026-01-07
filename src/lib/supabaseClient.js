import { createClient } from '@supabase/supabase-js';

// =============================================================================
// CONFIGURATION SUPABASE
// =============================================================================

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validation des variables d'environnement
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '❌ Variables Supabase manquantes!\n' +
    'Assurez-vous que VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont définis dans .env'
  );
}

// =============================================================================
// CLIENT SUPABASE
// =============================================================================

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Persistance de la session dans localStorage
    persistSession: true,
    // Stockage personnalisé (localStorage par défaut)
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    // Auto-refresh du token
    autoRefreshToken: true,
    // Détection automatique de la session
    detectSessionInUrl: true,
  },
  // Configuration globale des requêtes
  global: {
    headers: {
      'x-app-name': 'majordhome-artisan',
    },
  },
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Récupère la session courante
 * @returns {Promise<{session: Object|null, error: Error|null}>}
 */
export async function getSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return { session, error: null };
  } catch (error) {
    console.error('[supabaseClient] getSession error:', error);
    return { session: null, error };
  }
}

/**
 * Récupère l'utilisateur courant
 * @returns {Promise<{user: Object|null, error: Error|null}>}
 */
export async function getUser() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return { user, error: null };
  } catch (error) {
    console.error('[supabaseClient] getUser error:', error);
    return { user: null, error };
  }
}

/**
 * Écoute les changements d'état d'authentification
 * @param {Function} callback - Fonction appelée lors des changements
 * @returns {Function} Fonction pour se désabonner
 */
export function onAuthStateChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (event, session) => {
      callback(event, session);
    }
  );
  return () => subscription.unsubscribe();
}

export default supabase;
