import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@lib/supabaseClient';
import { authService } from '@services/auth.service';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [membership, setMembership] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Seule ref nécessaire : éviter que SIGNED_IN double-charge pendant signIn()
  const signInActiveRef = useRef(false);

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted || event === 'INITIAL_SESSION') return;

        switch (event) {
          case 'SIGNED_IN':
            if (session?.user) {
              setUser(session.user);
              // signIn() gère déjà loadUserData — ne pas doubler
              if (!signInActiveRef.current) {
                await loadUserData(session.user.id);
              }
            }
            break;

          case 'SIGNED_OUT':
            resetState();
            break;

          case 'TOKEN_REFRESHED':
            if (session?.user) {
              setUser(session.user);
              // Retry si les données manquent (le load initial a pu échouer avec un token expiré)
              // On lit le state via les setters pour éviter les closures stales
              setProfile(prev => {
                if (!prev) loadUserData(session.user.id);
                return prev;
              });
            }
            break;

          case 'USER_UPDATED':
            if (session?.user) {
              setUser(session.user);
              await loadUserData(session.user.id);
            }
            break;
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
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

  // ===========================================================================
  // CONTEXT VALUE
  // ===========================================================================

  const value = {
    user, profile, organization, membership,
    loading, initialized,
    isAuthenticated, hasOrganization,
    isOrgAdmin, isTeamLeader, isTeamLeaderOrAbove,
    appRole, businessRole, isOrgAdminFromProfile, isCommercialBusiness, canAccessPipeline,
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
