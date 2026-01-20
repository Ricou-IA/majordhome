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
    storageKey: 'majordhome-auth',
  },
  global: {
    headers: { 'x-app-name': 'majordhome-artisan' },
  },
});

export default supabase;
