import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@lib/supabaseClient';
import { authService } from '@services/auth.service';
import { computeEffectiveRole } from '@lib/permissions';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [membership, setMembership] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Refs de contrôle
  const signInActiveRef = useRef(false);       // Éviter que SIGNED_IN double-charge pendant signIn()
  const signOutTimerRef = useRef(null);        // Debounce SIGNED_OUT (protection alt-tab)

  // ===========================================================================
  // CHARGEMENT DES DONNÉES UTILISATEUR
  // ===========================================================================

  const loadUserData = useCallback(async (userId) => {
    if (!userId) return;

    try {
      const [profileResult, orgResult] = await Promise.all([
        authService.getProfile(userId),
        authService.getUserOrganization(userId),
      ]);

      const userProfile = profileResult.error ? null : profileResult.profile;
      let userOrg = orgResult.error ? null : orgResult.organization;
      let userMembership = orgResult.error ? null : orgResult.membership;

      // Fallback : si org null mais profil a un org_id, retry une fois
      if (!userOrg && userProfile?.org_id) {
        const retry = await authService.getUserOrganization(userId);
        userOrg = retry.organization || { id: userProfile.org_id, name: null, slug: null };
        userMembership = retry.membership || userMembership;
      }

      if (userProfile) setProfile(userProfile);
      if (userOrg) setOrganization(userOrg);
      if (userMembership) setMembership(userMembership);
    } catch (error) {
      console.error('[AuthContext] loadUserData error:', error);
    }
  }, []);

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

    const initAuth = async () => {
      try {
        // getSession() : lecture localStorage, rapide
        const { data: { session } } = await supabase.auth.getSession();

        if (mounted && session?.user) {
          setUser(session.user);
          await loadUserData(session.user.id);
        } else if (mounted) {
          // Pas de session locale — tenter getUser (PKCE redirect, etc.)
          const { data: { user: verifiedUser } } = await supabase.auth.getUser();
          if (mounted && verifiedUser) {
            setUser(verifiedUser);
            await loadUserData(verifiedUser.id);
          }
        }
      } catch (error) {
        console.error('[AuthContext] init error:', error);
      } finally {
        if (mounted) {
          setLoading(false);
          setInitialized(true);
        }
      }
    };

    initAuth();

    // Helper : annuler un SIGNED_OUT en attente
    const cancelPendingSignOut = () => {
      if (signOutTimerRef.current) {
        clearTimeout(signOutTimerRef.current);
        signOutTimerRef.current = null;
      }
    };

    // Helper : mettre à jour user SANS re-render si même utilisateur
    const updateUserIfChanged = (sessionUser) => {
      setUser(prev => {
        if (prev?.id === sessionUser.id) return prev; // Même user → pas de re-render
        return sessionUser;
      });
    };

    // Helper : recharger profile/org SEULEMENT si manquants
    const reloadIfNeeded = (userId) => {
      setProfile(prev => {
        setOrganization(prevOrg => {
          if (!prev || !prevOrg) {
            console.log('[AuthContext] reload needed (profile:', !!prev, 'org:', !!prevOrg, ')');
            loadUserData(userId);
          }
          return prevOrg;
        });
        return prev;
      });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted || event === 'INITIAL_SESSION') return;

        console.log('[AuthContext] onAuthStateChange:', event);

        switch (event) {
          case 'SIGNED_IN':
            cancelPendingSignOut();
            if (session?.user) {
              // signIn() explicite gère déjà loadUserData — ne pas doubler
              if (signInActiveRef.current) {
                setUser(session.user);
              } else {
                // Alt-tab / refresh : ne PAS re-render si données déjà présentes
                updateUserIfChanged(session.user);
                reloadIfNeeded(session.user.id);
              }
            }
            break;

          case 'SIGNED_OUT':
            // Protection alt-tab : Supabase peut fire SIGNED_OUT puis SIGNED_IN
            // en rafale lors d'un refresh. On debounce 2s pour laisser le temps
            // au SIGNED_IN de suivre et annuler le reset.
            cancelPendingSignOut();
            signOutTimerRef.current = setTimeout(() => {
              if (mounted) {
                console.log('[AuthContext] SIGNED_OUT confirmé — reset state');
                resetState();
              }
              signOutTimerRef.current = null;
            }, 2000);
            break;

          case 'TOKEN_REFRESHED':
            cancelPendingSignOut();
            if (session?.user) {
              updateUserIfChanged(session.user);
              reloadIfNeeded(session.user.id);
            }
            break;

          case 'USER_UPDATED':
            cancelPendingSignOut();
            if (session?.user) {
              setUser(session.user); // Force update — user data a changé
              await loadUserData(session.user.id);
            }
            break;
        }
      }
    );

    // =========================================================================
    // VISIBILITY CHANGE — filet de sécurité au retour d'alt-tab
    // =========================================================================
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !mounted) return;

      // Annuler tout SIGNED_OUT en attente — on revient sur l'onglet
      cancelPendingSignOut();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mounted = false;
      cancelPendingSignOut();
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadUserData, resetState]);

  // ===========================================================================
  // ACTIONS
  // ===========================================================================

  const signIn = useCallback(async (email, password) => {
    setLoading(true);
    signInActiveRef.current = true;

    try {
      const result = await authService.signIn(email, password);

      if (!result.error && result.data?.user) {
        setUser(result.data.user);
        await loadUserData(result.data.user.id);
      }

      return result;
    } finally {
      signInActiveRef.current = false;
      setLoading(false);
    }
  }, [loadUserData]);

  const signUp = useCallback(async (email, password, metadata = {}) => {
    setLoading(true);
    const result = await authService.signUp(email, password, metadata);
    setLoading(false);
    return result;
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    const result = await authService.signOut();
    if (!result.error) resetState();
    setLoading(false);
    return result;
  }, [resetState]);

  const signInWithGoogle = () => authService.signInWithGoogle();
  const resetPassword = (email) => authService.resetPassword(email);
  const updatePassword = (newPassword) => authService.updatePassword(newPassword);

  const updateProfile = async (updates) => {
    if (!user) return { profile: null, error: new Error('Non connecté') };
    const result = await authService.updateProfile(user.id, updates);
    if (result.profile) setProfile(result.profile);
    return result;
  };

  const joinOrganization = async (inviteCode) => {
    const result = await authService.joinOrganization(inviteCode);
    if (!result.error && user) await loadUserData(user.id);
    return result;
  };

  const refreshUserData = async () => {
    if (user) await loadUserData(user.id);
  };

  // ===========================================================================
  // COMPUTED VALUES
  // ===========================================================================

  const isAuthenticated = !!user;
  const hasOrganization = !!organization;

  const appRole = profile?.app_role || null;
  const businessRole = profile?.business_role || null;

  const isOrgAdminFromProfile = appRole === 'org_admin';
  const isCommercialBusiness =
    businessRole && typeof businessRole === 'string' && businessRole.toLowerCase() === 'commercial';

  const isOrgAdmin = isOrgAdminFromProfile || authService.isOrgAdmin(membership);
  const isTeamLeader = authService.hasRole(membership, 'team_leader');
  const isTeamLeaderOrAbove = authService.isTeamLeaderOrAbove(membership);
  const canAccessPipeline = isOrgAdminFromProfile || isCommercialBusiness;

  // Sprint 7 : rôle effectif unique (org_admin | team_leader | commercial | technicien)
  const effectiveRole = computeEffectiveRole(profile, membership);

  // ===========================================================================
  // CONTEXT VALUE
  // ===========================================================================

  const value = {
    user, profile, organization, membership,
    loading, initialized,
    isAuthenticated, hasOrganization,
    isOrgAdmin, isTeamLeader, isTeamLeaderOrAbove,
    appRole, businessRole, isOrgAdminFromProfile, isCommercialBusiness, canAccessPipeline,
    effectiveRole,
    signIn, signUp, signOut, signInWithGoogle,
    resetPassword, updatePassword, updateProfile,
    joinOrganization, refreshUserData,
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
  if (!context) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return context;
}

export default AuthContext;
