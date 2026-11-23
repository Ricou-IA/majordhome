/**
 * Dashboard.jsx - Majord'home Artisan
 * ============================================================================
 * Page d'accueil : la journée (RDV du jour ou du prochain jour qui en a), quelques
 * repères chiffrés, ce qui attend d'être traité, et — pour l'administrateur, en bas
 * de page — le ménage des données.
 *
 * La page assemble, elle ne calcule rien : règles de l'accueil dans src/lib/accueil.js,
 * portefeuille et CA signé repris du Dashboard du pipeline (usePipelineDashboard),
 * CA HT programmé repris du Planning (usePlanningCa). Un chiffre inconnu n'est pas
 * affiché, jamais remplacé par un zéro.
 *
 * @version 3.0.0 - accueil métier (2026-11-22)
 * ============================================================================
 */

import { useMemo } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useAppointments } from '@hooks/useAppointments';
import { usePlanningCa } from '@hooks/usePlanningCa';
import { usePipelineDashboard } from '@hooks/usePipelineDashboard';
import { usePennylaneEnabled } from '@hooks/useOrgSettings';
import { useQuotesExplorer } from '@hooks/usePennylane';
import { chantierKeys } from '@hooks/cacheKeys';
import { supabase } from '@lib/supabaseClient';
import { SEUIL_RELANCE_JOURS } from '@lib/pipelineDashboard';
import { cumulPeriode, formatCa } from '@/lib/planningCa';
import { plageAccueil, journeeAffichee, compterRdv, lignesATraiter, sousTitreAccueil, variation } from '@/lib/accueil';
import { PageHeader } from '@components/ui/page-header';
import { KpiCard } from '@components/ui/kpi-card';
import { entier, euros, libelleMoisCourt } from '@components/pipeline/dashboard/format';
import { AccueilJournee } from '@apps/artisan/components/dashboard/AccueilJournee';
import { AccueilATraiter } from '@apps/artisan/components/dashboard/AccueilATraiter';
import { AccueilACorriger } from '@apps/artisan/components/dashboard/AccueilACorriger';
import { AccueilRelances } from '@apps/artisan/components/dashboard/AccueilRelances';

// =============================================================================
// HOOK — chantiers en attente d'un geste (commande à passer, pose à dater)
// =============================================================================

function useChantiersEnAttente(orgId, enabled) {
  return useQuery({
    queryKey: [...chantierKeys.all(orgId), 'accueil-en-attente'],
    queryFn: async () => {
      const compter = (statut) => supabase
        .from('majordhome_chantiers')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('chantier_status', statut);
      const [commande, planifier] = await Promise.all([compter('commande_a_faire'), compter('commande_recue')]);
      if (commande.error) throw commande.error;
      if (planifier.error) throw planifier.error;
      return { commandeAFaire: commande.count || 0, aPlanifier: planifier.count || 0 };
    },
    enabled: !!orgId && enabled,
    staleTime: 30_000,
  });
}

// =============================================================================
// PAGE
// =============================================================================

export default function Dashboard() {
  const { profile, organization, effectiveRole, isOrgAdmin } = useAuth();
  const { can } = useCanAccess();
  const orgId = organization?.id;

  const peutPlanning = can('planning', 'view');
  const peutPipeline = can('pipeline', 'view');
  // Commandes et poses à dater : affaire des responsables, pas des commerciaux.
  const peutChantiers = can('chantiers', 'view') && effectiveRole !== 'commercial';
  // Le chiffre du planning est un outil de pilotage (même règle que le Planning).
  const pilote = effectiveRole === 'org_admin' || effectiveRole === 'team_leader';

  // Plage lue : figée à l'ouverture de la page (dates locales).
  const plage = useMemo(() => plageAccueil(), []);
  const weekEnd = plage.semaine.debut > plage.aujourdhui;

  // --- Planning : RDV de la plage, et CA HT programmé de la semaine de référence ---
  const { appointments, teamList, isLoading: rdvLoading, error: rdvError } = useAppointments({
    orgId: peutPlanning ? orgId : undefined,
    startDate: plage.startDate,
    endDate: plage.endDate,
  });
  const { ca } = usePlanningCa({
    orgId,
    startDate: plage.startDate,
    endDate: plage.endDate,
    appointments,
    enabled: pilote && peutPlanning,
  });
  const journee = useMemo(() => journeeAffichee(appointments, plage.aujourdhui), [appointments, plage.aujourdhui]);
  const rdvConnus = peutPlanning && !rdvLoading && !rdvError;

  // --- Pipeline : portefeuille ouvert et CA signé du mois (mêmes chiffres que son Dashboard) ---
  const moisCourant = plage.aujourdhui.slice(0, 7);
  const mois = useMemo(() => [moisCourant], [moisCourant]);
  const sourceIds = useMemo(() => [], []);
  const { dashboard, isLoading: pipelineLoading, error: pipelineError } = usePipelineDashboard({
    mois,
    sourceIds,
    enabled: peutPipeline,
  });

  // --- Chantiers en attente ---
  const chantiers = useChantiersEnAttente(orgId, peutChantiers);

  // --- Ménage des données (administrateur) ---
  const pennylaneActif = usePennylaneEnabled();
  const voitDevisNonRattaches = isOrgAdmin && pennylaneActif;
  const { orphanCount, error: quotesError } = useQuotesExplorer({ enabled: voitDevisNonRattaches });

  // --- Repères : seulement les chiffres connus ---
  const reperes = [];
  const compte = rdvConnus ? compterRdv(appointments, plage) : null;
  if (rdvConnus) {
    reperes.push({
      key: 'rdv',
      label: 'RDV aujourd’hui',
      value: entier(compte.aujourdhui),
      sub: `${entier(compte.semaine)} ${weekEnd ? 'la semaine prochaine' : 'cette semaine'}`,
    });
  }
  if (rdvConnus && ca) {
    reperes.push({
      key: 'ca-programme',
      label: `CA HT programmé, ${weekEnd ? 'semaine prochaine' : 'cette semaine'}`,
      value: formatCa(cumulPeriode(ca.parJour, plage.semaine.debut, plage.semaine.finExclue)),
      sub: 'Interventions posées au planning',
      title: 'Installations au prorata des journées posées, entretiens au montant du contrat ramené en HT.',
    });
  }
  if (dashboard) {
    const { actuel, precedent } = dashboard.entreprise;
    const { total } = dashboard.portefeuille;
    const nomDuMois = new Date().toLocaleDateString('fr-FR', { month: 'long' });
    const ecart = variation(actuel.ca, precedent?.ca);
    const moisPrecedent = dashboard.periode?.precedente?.length === 1 ? libelleMoisCourt(dashboard.periode.precedente[0]) : null;
    reperes.push({
      key: 'ca-signe',
      label: `CA signé HT en ${nomDuMois}`,
      value: euros(actuel.ca),
      sub: `${entier(actuel.ventes)} ${actuel.ventes > 1 ? 'ventes signées' : 'vente signée'}`,
      delta: ecart && moisPrecedent
        ? { valeur: `${ecart.pourcent} % vs ${moisPrecedent}`, sens: ecart.sens }
        : undefined,
    });
    reperes.push({
      key: 'devis',
      label: 'Devis en attente',
      value: entier(total.devisEnAttente),
      sub: `${euros(total.montantEnAttente)} HT`,
    });
  }

  // --- À traiter ---
  const lignes = lignesATraiter({
    portefeuille: dashboard ? dashboard.portefeuille.total : null,
    chantiers: chantiers.data || null,
    seuilRelance: SEUIL_RELANCE_JOURS,
  });
  const echecs = [
    peutPipeline && pipelineError ? 'le pipeline' : null,
    peutChantiers && chantiers.error ? 'les chantiers' : null,
  ].filter(Boolean);
  const aTraiterVisible = peutPipeline || peutChantiers;
  const dateDuJour = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bonjour${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        subtitle={sousTitreAccueil({
          dateDuJour: dateDuJour.charAt(0).toUpperCase() + dateDuJour.slice(1),
          rdvAujourdhui: compte ? compte.aujourdhui : null,
          aRappeler: dashboard ? dashboard.portefeuille.total.aContacter : null,
        })}
        actions={[
          peutPlanning && { label: 'Ouvrir le planning', icon: CalendarDays, variant: 'secondary', to: '/planning' },
          can('pipeline', 'create') && { label: 'Nouveau lead', icon: Plus, variant: 'primary', to: '/pipeline?tab=kanban&new=1' },
        ]}
      />

      {reperes.length >= 2 && (
        <div className={`grid gap-4 ${reperes.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2'}`}>
          {reperes.map((repere) => (
            <KpiCard key={repere.key} label={repere.label} value={repere.value} context={repere.sub} info={repere.title} delta={repere.delta} />
          ))}
        </div>
      )}

      <div className={`grid gap-6 ${peutPlanning && aTraiterVisible ? 'lg:grid-cols-3' : ''}`}>
        {peutPlanning && (
          <div className={aTraiterVisible ? 'lg:col-span-2' : ''}>
            <AccueilJournee
              journee={journee}
              equipe={teamList}
              isLoading={rdvLoading}
              error={rdvError}
              finDeLecture={plage.endDate}
            />
          </div>
        )}
        {aTraiterVisible && (
          <div className="space-y-6">
            <AccueilATraiter
              lignes={lignes}
              isLoading={(peutPipeline && pipelineLoading) || (peutChantiers && chantiers.isLoading)}
              echecs={echecs}
              peutCreerLead={can('pipeline', 'create')}
            />
            {dashboard && <AccueilRelances relances={dashboard.portefeuille.relancesPrioritaires} />}
          </div>
        )}
      </div>

      {isOrgAdmin && (
        <AccueilACorriger
          pennylaneActif={pennylaneActif}
          devisNonRattaches={voitDevisNonRattaches && !quotesError ? orphanCount : null}
        />
      )}
    </div>
  );
}
