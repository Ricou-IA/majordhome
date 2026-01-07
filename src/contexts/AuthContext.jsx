import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@lib/supabaseClient';
import { authService } from '@services/auth.service';

// =============================================================================
// CONTEXTE AUTH
// =============================================================================

const AuthContext = createContext(null);

// =============================================================================
// PROVIDER
// =============================================================================

export function AuthProvider({ children }) {
  // État
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [membership, setMembership] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [dataLoading, setDataLoading] = useState(false); // Chargement des données utilisateur

  // ===========================================================================
  // CHARGEMENT DES DONNÉES UTILISATEUR
  // ===========================================================================

  /**
   * Charge le profil et l'organisation de l'utilisateur
   */
  const loadUserData = useCallback(async (userId) => {
    setDataLoading(true);
    try {
      // Charger le profil
      const { profile: userProfile } = await authService.getProfile(userId);
      setProfile(userProfile);

      // Charger l'organisation
      const { organization: userOrg, membership: userMembership } =
        await authService.getUserOrganization(userId);
      setOrganization(userOrg);
      setMembership(userMembership);

      console.log('[AuthContext] Données utilisateur chargées:', {
        profile: userProfile?.full_name,
        organization: userOrg?.name,
        role: userMembership?.role,
      });
    } catch (error) {
      console.error('[AuthContext] Erreur chargement données:', error);
    } finally {
      setDataLoading(false);
    }
  }, []);

  /**
   * Réinitialise l'état
   */
  const resetState = useCallback(() => {
    setUser(null);
    setProfile(null);
    setOrganization(null);
    setMembership(null);
  }, []);

  // ===========================================================================
  // INITIALISATION & ÉCOUTE AUTH
  // ===========================================================================

  useEffect(() => {
    let mounted = true;

    // Initialisation
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (mounted) {
          if (session?.user) {
            setUser(session.user);
            await loadUserData(session.user.id);
          }
          setLoading(false);
          setInitialized(true);
        }
      } catch (error) {
        console.error('[AuthContext] Erreur initialisation:', error);
        if (mounted) {
          setLoading(false);
          setInitialized(true);
        }
      }
    };

    initAuth();

    // Écoute des changements d'état auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AuthContext] Auth event:', event);

        if (!mounted) return;

        switch (event) {
          case 'SIGNED_IN':
            if (session?.user) {
              setUser(session.user);
              await loadUserData(session.user.id);
            }
            break;

          case 'SIGNED_OUT':
            resetState();
            break;

          case 'TOKEN_REFRESHED':
            if (session?.user) {
              setUser(session.user);
            }
            break;

          case 'USER_UPDATED':
            if (session?.user) {
              setUser(session.user);
              await loadUserData(session.user.id);
            }
            break;

          default:
            break;
        }
      }
    );

    // Cleanup
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserData, resetState]);

  // ===========================================================================
  // ACTIONS
  // ===========================================================================

  /**
   * Connexion
   */
  const signIn = async (email, password) => {
    setLoading(true);
    const result = await authService.signIn(email, password);
    setLoading(false);
    return result;
  };

  /**
   * Inscription
   */
  const signUp = async (email, password, metadata = {}) => {
    setLoading(true);
    const result = await authService.signUp(email, password, metadata);
    setLoading(false);
    return result;
  };

  /**
   * Déconnexion
   */
  const signOut = async () => {
    setLoading(true);
    const result = await authService.signOut();
    if (!result.error) {
      resetState();
    }
    setLoading(false);
    return result;
  };

  /**
   * Connexion Google
   */
  const signInWithGoogle = async () => {
    return authService.signInWithGoogle();
  };

  /**
   * Réinitialisation mot de passe
   */
  const resetPassword = async (email) => {
    return authService.resetPassword(email);
  };

  /**
   * Mise à jour mot de passe
   */
  const updatePassword = async (newPassword) => {
    return authService.updatePassword(newPassword);
  };

  /**
   * Mise à jour du profil
   */
  const updateProfile = async (updates) => {
    if (!user) return { profile: null, error: new Error('Non connecté') };

    const result = await authService.updateProfile(user.id, updates);
    if (result.profile) {
      setProfile(result.profile);
    }
    return result;
  };

  /**
   * Rejoindre une organisation
   */
  const joinOrganization = async (inviteCode) => {
    const result = await authService.joinOrganization(inviteCode);
    if (!result.error && user) {
      // Recharger les données organisation
      await loadUserData(user.id);
    }
    return result;
  };

  /**
   * Rafraîchir les données utilisateur
   */
  const refreshUserData = async () => {
    if (user) {
      await loadUserData(user.id);
    }
  };

  // ===========================================================================
  // COMPUTED VALUES
  // ===========================================================================

  const isAuthenticated = !!user;
  const hasOrganization = !!organization;
  const isOrgAdmin = authService.isOrgAdmin(membership);
  const isTeamLeader = authService.hasRole(membership, 'team_leader');
  const isTeamLeaderOrAbove = authService.isTeamLeaderOrAbove(membership);

  // ===========================================================================
  // CONTEXT VALUE
  // ===========================================================================

  const value = {
    // État
    user,
    profile,
    organization,
    membership,
    loading,
    initialized,
    dataLoading,

    // Computed
    isAuthenticated,
    hasOrganization,
    isOrgAdmin,
    isTeamLeader,
    isTeamLeaderOrAbove,

    // Actions
    signIn,
    signUp,
    signOut,
    signInWithGoogle,
    resetPassword,
    updatePassword,
    updateProfile,
    joinOrganization,
    refreshUserData,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// =============================================================================
// HOOK
// =============================================================================

export function useAuth() {
  const context = useContext(AuthContext);
  
  if (!context) {
    throw new Error('useAuth doit être utilisé dans un AuthProvider');
  }
  
  return context;
}

export default AuthContext;
    