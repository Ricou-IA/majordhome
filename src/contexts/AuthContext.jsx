import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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
  const [dataLoading, setDataLoading] = useState(false);

  // Refs pour éviter les rechargements inutiles
  const currentUserIdRef = useRef(null);
  const isLoadingDataRef = useRef(false);
  const dataLoadedRef = useRef(false);

  // ===========================================================================
  // CHARGEMENT DES DONNÉES UTILISATEUR
  // ===========================================================================

  /**
   * Charge le profil et l'organisation de l'utilisateur
   */
  const loadUserData = useCallback(async (userId, force = false) => {
    if (!userId) {
      console.warn('[AuthContext] loadUserData appelé sans userId');
      return;
    }

    // Éviter les rechargements si déjà en cours
    if (isLoadingDataRef.current) {
      console.log('[AuthContext] Chargement déjà en cours, ignoré');
      return;
    }

    // Éviter de recharger si les données sont déjà présentes pour cet utilisateur
    if (!force && currentUserIdRef.current === userId && dataLoadedRef.current) {
      console.log('[AuthContext] Données déjà chargées pour cet utilisateur, ignoré');
      return;
    }

    isLoadingDataRef.current = true;
    currentUserIdRef.current = userId;
    setDataLoading(true);

    try {
      console.log('[AuthContext] Début chargement données pour userId:', userId);

      // Charger le profil ET l'organisation en parallèle
      const [profileResult, orgResult] = await Promise.all([
        authService.getProfile(userId),
        authService.getUserOrganization(userId),
      ]);

      const { profile: userProfile, error: profileError } = profileResult;
      const { organization: userOrg, membership: userMembership, error: orgError } = orgResult;

      if (profileError) {
        console.error('[AuthContext] Erreur getProfile:', profileError);
      } else {
        setProfile(userProfile);
      }

      if (orgError) {
        console.error('[AuthContext] Erreur getUserOrganization:', orgError);
      } else {
        setOrganization(userOrg);
        setMembership(userMembership);
      }

      dataLoadedRef.current = true;

      // DEBUG DÉTAILLÉ — à retirer après diagnostic
      console.log('[AuthContext] DEBUG COMPLET loadUserData résultat:', {
        profile: userProfile?.full_name,
        profileOrgId: userProfile?.org_id,
        organization: userOrg,
        orgId: userOrg?.id,
        orgName: userOrg?.name,
        membership: userMembership,
        orgError,
        profileError,
      });
    } catch (error) {
      console.error('[AuthContext] Erreur chargement données:', error);
    } finally {
      isLoadingDataRef.current = false;
      setDataLoading(false);
      console.log('[AuthContext] Fin chargement données, dataLoading = false');
    }
  }, []); // Pas de dépendances - utilise les refs

  /**
   * Réinitialise l'état
   */
  const resetState = useCallback(() => {
    setUser(null);
    setProfile(null);
    setOrganization(null);
    setMembership(null);
    currentUserIdRef.current = null;
    isLoadingDataRef.current = false;
    dataLoadedRef.current = false;
  }, []);

  // ===========================================================================
  // INITIALISATION & ÉCOUTE AUTH
  // ===========================================================================

  useEffect(() => {
    let mounted = true;

    // Initialisation
    const initAuth = async () => {
      try {
        console.log('[AuthContext] Début initialisation...');
        
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.error('[AuthContext] Erreur getSession:', error);
        }

        const session = data?.session;

        if (mounted) {
          if (session?.user) {
            console.log('[AuthContext] Session trouvée, user:', session.user.email);
            setUser(session.user);
            loadUserData(session.user.id, true).catch(err => {
              console.error('[AuthContext] Erreur loadUserData dans initAuth:', err);
            });
          } else {
            console.log('[AuthContext] Aucune session trouvée');
          }
          setLoading(false);
          setInitialized(true);
          console.log('[AuthContext] Initialisation terminée');
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

        // Ignorer INITIAL_SESSION car déjà géré par initAuth
        if (event === 'INITIAL_SESSION') {
          console.log('[AuthContext] INITIAL_SESSION ignoré');
          return;
        }

        switch (event) {
          case 'SIGNED_IN':
            console.log('[AuthContext] SIGNED_IN event');
            if (session?.user) {
              const isSameUser = currentUserIdRef.current === session.user.id;
              setUser(session.user);
              
              // Ne recharger que si nouvel utilisateur ou données pas encore chargées
              if (!isSameUser || !dataLoadedRef.current) {
                await loadUserData(session.user.id, !isSameUser);
              } else {
                console.log('[AuthContext] Même utilisateur, pas de rechargement');
              }
            }
            break;

          case 'SIGNED_OUT':
            console.log('[AuthContext] SIGNED_OUT event');
            resetState();
            break;

          case 'TOKEN_REFRESHED':
            console.log('[AuthContext] TOKEN_REFRESHED - ignoré');
            // Ne rien faire, les données sont déjà chargées
            if (session?.user) {
              setUser(session.user);
            }
            break;

          case 'USER_UPDATED':
            console.log('[AuthContext] USER_UPDATED event');
            if (session?.user) {
              setUser(session.user);
              await loadUserData(session.user.id, true);
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

  const signIn = async (email, password) => {
    setLoading(true);
    const result = await authService.signIn(email, password);
    setLoading(false);
    return result;
  };

  const signUp = async (email, password, metadata = {}) => {
    setLoading(true);
    const result = await authService.signUp(email, password, metadata);
    setLoading(false);
    return result;
  };

  const signOut = async () => {
    setLoading(true);
    const result = await authService.signOut();
    if (!result.error) {
      resetState();
    }
    setLoading(false);
    return result;
  };

  const signInWithGoogle = async () => {
    return authService.signInWithGoogle();
  };

  const resetPassword = async (email) => {
    return authService.resetPassword(email);
  };

  const updatePassword = async (newPassword) => {
    return authService.updatePassword(newPassword);
  };

  const updateProfile = async (updates) => {
    if (!user) return { profile: null, error: new Error('Non connecté') };

    const result = await authService.updateProfile(user.id, updates);
    if (result.profile) {
      setProfile(result.profile);
    }
    return result;
  };

  const joinOrganization = async (inviteCode) => {
    const result = await authService.joinOrganization(inviteCode);
    if (!result.error && user) {
      await loadUserData(user.id, true);
    }
    return result;
  };

  const refreshUserData = async () => {
    if (user) {
      await loadUserData(user.id, true);
    }
  };

  // ===========================================================================
  // COMPUTED VALUES
  // ===========================================================================

  const isAuthenticated = !!user;
  const hasOrganization = !!organization;

  // Rôles applicatifs basés PRIORITAIREMENT sur core.profiles
  const appRole = profile?.app_role || null;
  const businessRole = profile?.business_role || null;

  const isOrgAdminFromProfile = appRole === 'org_admin';
  const isCommercialBusiness =
    businessRole && typeof businessRole === 'string' && businessRole.toLowerCase() === 'commercial';

  // Compatibilité : on garde les helpers basés sur membership,
  // mais on fait de core.profiles la source de vérité pour l'admin app
  const isOrgAdmin = isOrgAdminFromProfile || authService.isOrgAdmin(membership);
  const isTeamLeader = authService.hasRole(membership, 'team_leader');
  const isTeamLeaderOrAbove = authService.isTeamLeaderOrAbove(membership);

  // Permissions métier dérivées
  // - Accès pipeline si org_admin (app_role) OU business_role = Commercial
  const canAccessPipeline = isOrgAdminFromProfile || isCommercialBusiness;

  // Debug: log pour vérifier les valeurs
  if (profile && !canAccessPipeline && appRole) {
    console.log('[AuthContext] Debug Pipeline access:', {
      appRole,
      businessRole,
      isOrgAdminFromProfile,
      isCommercialBusiness,
      canAccessPipeline,
    });
  }

  // ===========================================================================
  // CONTEXT VALUE
  // ===========================================================================

  const value = {
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

    // Rôles & permissions basés sur core.profiles
    appRole,
    businessRole,
    isOrgAdminFromProfile,
    isCommercialBusiness,
    canAccessPipeline,

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
