import { supabase } from '@lib/supabaseClient';

// =============================================================================
// HELPERS INTERNES
// =============================================================================

/**
 * Détecte si une erreur est un AbortError (requête annulée)
 * Cause typique : React 18 Strict Mode double-mount en dev
 */
function isAbortError(error) {
  if (!error) return false;
  return error.name === 'AbortError'
    || error.message?.includes('abort')
    || error.details?.includes('abort');
}

/**
 * Exécute une fonction async avec retry automatique sur AbortError
 * @param {Function} fn - Fonction async à exécuter
 * @param {number} retries - Nombre de tentatives (défaut: 2)
 * @param {number} delay - Délai entre tentatives en ms (défaut: 200)
 */
async function withAbortRetry(fn, retries = 2, delay = 200) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      // Si pas d'erreur, retourner directement
      if (!result.error) return result;
      // Si AbortError et encore des tentatives, retry
      if (isAbortError(result.error) && attempt < retries) {
        console.warn(`[authService] AbortError détecté, retry ${attempt}/${retries - 1} dans ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // Autre erreur ou dernière tentative — retourner tel quel
      return result;
    } catch (error) {
      if (isAbortError(error) && attempt < retries) {
        console.warn(`[authService] AbortError (thrown), retry ${attempt}/${retries - 1} dans ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
}

// =============================================================================
// SERVICE D'AUTHENTIFICATION
// =============================================================================

export const authService = {
  // ===========================================================================
  // CONNEXION / DÉCONNEXION
  // ===========================================================================

  /**
   * Connexion avec email et mot de passe
   * @param {string} email - Email de l'utilisateur
   * @param {string} password - Mot de passe
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async signIn(email, password) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('[authService] signIn error:', error);
      return { data: null, error };
    }
  },

  /**
   * Inscription avec email et mot de passe
   * @param {string} email - Email de l'utilisateur
   * @param {string} password - Mot de passe
   * @param {Object} metadata - Métadonnées utilisateur (full_name, etc.)
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async signUp(email, password, metadata = {}) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: metadata.fullName || '',
            ...metadata,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('[authService] signUp error:', error);
      return { data: null, error };
    }
  },

  /**
   * Déconnexion
   * @returns {Promise<{error: Error|null}>}
   */
  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      return { error: null };
    } catch (error) {
      console.error('[authService] signOut error:', error);
      return { error };
    }
  },

  // ===========================================================================
  // OAUTH (Google)
  // ===========================================================================

  /**
   * Connexion avec Google OAuth
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async signInWithGoogle() {
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('[authService] signInWithGoogle error:', error);
      return { data: null, error };
    }
  },

  // ===========================================================================
  // MOT DE PASSE
  // ===========================================================================

  /**
   * Demande de réinitialisation de mot de passe
   * @param {string} email - Email de l'utilisateur
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async resetPassword(email) {
    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          redirectTo: `${window.location.origin}/reset-password`,
        }
      );

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('[authService] resetPassword error:', error);
      return { data: null, error };
    }
  },

  /**
   * Mise à jour du mot de passe (après reset ou connecté)
   * @param {string} newPassword - Nouveau mot de passe
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async updatePassword(newPassword) {
    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('[authService] updatePassword error:', error);
      return { data: null, error };
    }
  },

  /**
   * Change le mot de passe d'un client via l'Edge Function (admin API).
   * Contourne la restriction GoTrue "Secure password change".
   * @param {string} newPassword - Nouveau mot de passe (min 6 caractères)
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async clientChangePassword(newPassword) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session invalide');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-change-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ password: newPassword }),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Erreur serveur');

      return { data: result, error: null };
    } catch (error) {
      console.error('[authService] clientChangePassword error:', error);
      return { data: null, error };
    }
  },

  // ===========================================================================
  // SESSION & UTILISATEUR
  // ===========================================================================

  /**
   * Récupère la session courante
   * @returns {Promise<{session: Object|null, error: Error|null}>}
   */
  async getSession() {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      return { session, error: null };
    } catch (error) {
      console.error('[authService] getSession error:', error);
      return { session: null, error };
    }
  },

  /**
   * Récupère l'utilisateur courant
   * @returns {Promise<{user: Object|null, error: Error|null}>}
   */
  async getUser() {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      return { user, error: null };
    } catch (error) {
      console.error('[authService] getUser error:', error);
      return { user: null, error };
    }
  },

  /**
   * Met à jour les informations de l'utilisateur
   * @param {Object} updates - Champs à mettre à jour
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async updateUser(updates) {
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: updates,
      });

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('[authService] updateUser error:', error);
      return { data: null, error };
    }
  },

  // ===========================================================================
  // PROFIL (Table profiles)
  // ===========================================================================

  /**
   * Récupère le profil utilisateur depuis la table profiles
   * @param {string} userId - ID de l'utilisateur
   * @returns {Promise<{profile: Object|null, error: Error|null}>}
   */
  async getProfile(userId) {
    return withAbortRetry(async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (error) throw error;

        return { profile: data, error: null };
      } catch (error) {
        console.error('[authService] getProfile error:', error);
        return { profile: null, error };
      }
    });
  },

  /**
   * Met à jour le profil utilisateur
   * @param {string} userId - ID de l'utilisateur
   * @param {Object} updates - Champs à mettre à jour
   * @returns {Promise<{profile: Object|null, error: Error|null}>}
   */
  async updateProfile(userId, updates) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      return { profile: data, error: null };
    } catch (error) {
      console.error('[authService] updateProfile error:', error);
      return { profile: null, error };
    }
  },

  // ===========================================================================
  // ORGANISATION & MEMBRES
  // ===========================================================================

  /**
   * Récupère l'organisation de l'utilisateur
   * @param {string} userId - ID de l'utilisateur
   * @returns {Promise<{organization: Object|null, membership: Object|null, error: Error|null}>}
   */
  async getUserOrganization(userId) {
    return withAbortRetry(async () => {
      try {
        // Récupérer le membership via la vue enrichie (colonnes org_ jointes)
        const { data: membership, error: memberError } = await supabase
          .from('organization_members')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'active')
          .single();

        if (memberError) {
          // Pas de membership trouvé = pas d'organisation
          if (memberError.code === 'PGRST116') {
            return { organization: null, membership: null, error: null };
          }
          throw memberError;
        }

        // Reconstruire l'objet organization depuis les colonnes plates org_*
        const organization = membership.org_id
          ? {
              id: membership.org_id,
              name: membership.org_name,
              slug: membership.org_slug,
              plan: membership.org_plan,
              description: membership.org_description,
              is_active: membership.org_is_active,
              settings: membership.org_settings,
              app_id: membership.org_app_id,
              created_at: membership.org_created_at,
            }
          : null;

        return {
          organization,
          membership: {
            id: membership.id,
            role: membership.role,
            status: membership.status,
            joined_at: membership.joined_at,
          },
          error: null,
        };
      } catch (error) {
        console.error('[authService] getUserOrganization error:', error);
        return { organization: null, membership: null, error };
      }
    });
  },

  /**
   * Rejoint une organisation via un code d'invitation
   * @param {string} inviteCode - Code d'invitation
   * @returns {Promise<{organization: Object|null, error: Error|null}>}
   */
  async joinOrganization(inviteCode) {
    try {
      // Appel RPC pour rejoindre l'organisation
      const { data, error } = await supabase.rpc('join_organization_by_code', {
        p_invite_code: inviteCode.trim().toUpperCase(),
      });

      if (error) throw error;

      return { organization: data, error: null };
    } catch (error) {
      console.error('[authService] joinOrganization error:', error);
      return { organization: null, error };
    }
  },

  // ===========================================================================
  // CLIENT PORTAL
  // ===========================================================================

  /**
   * Charge le client record lié à un auth user (portail client)
   * Appelé uniquement quand pas d'org membership → zéro impact artisan
   * @param {string} userId - ID auth user
   * @returns {Promise<{clientRecord: Object|null, error: Error|null}>}
   */
  async getClientRecord(userId) {
    try {
      const { data, error } = await supabase
        .from('majordhome_clients')
        .select('id, first_name, last_name, display_name, email, project_id, org_id')
        .eq('auth_user_id', userId)
        .maybeSingle();

      if (error) throw error;

      return { clientRecord: data || null, error: null };
    } catch (error) {
      console.error('[authService] getClientRecord error:', error);
      return { clientRecord: null, error };
    }
  },

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Vérifie si l'utilisateur a un rôle spécifique
   * @param {Object} membership - Membership de l'utilisateur
   * @param {string|string[]} roles - Rôle(s) à vérifier
   * @returns {boolean}
   */
  hasRole(membership, roles) {
    if (!membership) return false;
    const roleArray = Array.isArray(roles) ? roles : [roles];
    return roleArray.includes(membership.role);
  },

  /**
   * Vérifie si l'utilisateur est admin de l'organisation
   * @param {Object} membership - Membership de l'utilisateur
   * @returns {boolean}
   */
  isOrgAdmin(membership) {
    return this.hasRole(membership, 'org_admin');
  },

  /**
   * Vérifie si l'utilisateur est team leader ou admin
   * @param {Object} membership - Membership de l'utilisateur
   * @returns {boolean}
   */
  isTeamLeaderOrAbove(membership) {
    return this.hasRole(membership, ['org_admin', 'team_leader']);
  },
};

export default authService;
