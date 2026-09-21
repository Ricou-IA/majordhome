// src/shared/hooks/useOrgSettings.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { orgSettingsService } from '@services/orgSettings.service';
import { orgSettingsKeys } from './cacheKeys';

/**
 * Hook React Query pour les settings de l'org courante.
 * - settings : objet (vide {} si rien configuré)
 * - save(patch) : merge le patch côté DB, retourne le nouveau settings
 * - isDirty est calculé localement par chaque consumer (form values vs initial)
 *
 * AuthContext utilise useState local (pas React Query) pour l'organization,
 * on appelle donc refreshUserData() après save pour rafraîchir l'objet
 * organization de AuthContext (consommé partout via useAuth().organization.settings,
 * notamment par buildCompanyInfo dans les PDFs/emails).
 */
export function useOrgSettings() {
  const { organization, refreshUserData } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: orgSettingsKeys.byOrg(orgId),
    queryFn: async () => {
      const { data, error } = await orgSettingsService.getSettings(orgId);
      if (error) throw error;
      return data ?? {};
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (patch) => {
      const { data, error } = await orgSettingsService.updateSettings(orgId, patch);
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: orgSettingsKeys.byOrg(orgId) });
      // AuthContext gère organization en useState local — refresh manuel
      // pour que useAuth().organization.settings reflète les nouvelles valeurs
      // (consommé par buildCompanyInfo, getMapDefaultCenter, etc.)
      await refreshUserData();
    },
  });

  return {
    settings: query.data ?? {},
    isLoading: query.isLoading,
    error: query.error,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}

/**
 * Sélecteur : l'org courante a-t-elle l'intégration Pennylane activée ?
 *
 * Source : `core.organizations.settings.pennylane.enabled`, éditable dans
 * Settings → Socle → Facturation Pennylane (/settings/pennylane, 2026-09-21).
 *
 * Consommé par QuoteCandidatesModal (PR 4) et MarkWonQuoteModal (PR 5) pour
 * brancher conditionnellement les nouvelles modales du bridge Pipeline ↔ PL.
 * Si false (ou absent) : flow MDH actuel intégral, pas de bridge.
 */
export function usePennylaneEnabled() {
  const { settings } = useOrgSettings();
  return Boolean(settings?.pennylane?.enabled);
}

export const PENNYLANE_INVOICE_DEFAULTS = Object.freeze({ deadlineDays: 30, mode: 'draft' });

/**
 * Réglages des factures créées depuis les cartes entretien (push MDH → PL,
 * spec 2026-09-21). Source `settings.pennylane.invoice = { deadline_days, mode,
 * ledger_accounts: { by_category: { [categoryId]: ledgerAccountId }, parts } }`,
 * `mode` ∈ `draft` (brouillon à finaliser dans PL) | `final`. Défauts si absent.
 *
 * Comptes comptables (Eric, 2026-09-21) : la famille d'une ligne pour les stats
 * = son compte de vente Pennylane (706xxx), paramétré PAR CATÉGORIE d'équipement
 * (Settings → Facturation Pennylane) + un compte pour les pièces. Une ligne sans
 * compte part en ligne libre sur le compte par défaut de PL, avec avertissement.
 * Fonction pure (pas de hook) pour être appelable depuis un modèle ou un test.
 */
/**
 * Plan comptable de GESTION (Eric, 2026-09-21) : le sous-ensemble des comptes de vente
 * Pennylane que Majord'home a le droit d'utiliser, avec un alias facultatif. Source
 * unique de tous les sélecteurs de compte (contrats d'entretien, pièces, catalogue
 * article à venir). `settings.pennylane.chart = [{ number: '70601', alias: 'Entretien' }]`.
 * Vide → les sélecteurs retombent sur toute la classe 7 de Pennylane.
 * @returns {Array<{ number: string, alias: string }>}
 */
export function pennylaneChart(settings) {
  const chart = settings?.pennylane?.chart;
  if (!Array.isArray(chart)) return [];
  return chart
    .filter((c) => c && c.number)
    .map((c) => ({ number: String(c.number), alias: typeof c.alias === 'string' ? c.alias : '' }));
}

export function pennylaneInvoiceSettings(settings) {
  const inv = settings?.pennylane?.invoice || {};
  const days = Number(inv.deadline_days);
  const la = inv.ledger_accounts || {};
  return {
    deadlineDays: Number.isInteger(days) && days >= 0 ? days : PENNYLANE_INVOICE_DEFAULTS.deadlineDays,
    mode: inv.mode === 'final' ? 'final' : PENNYLANE_INVOICE_DEFAULTS.mode,
    ledgerAccounts: {
      byCategory: la.by_category && typeof la.by_category === 'object' ? la.by_category : {},
      parts: la.parts ?? null,
    },
  };
}
