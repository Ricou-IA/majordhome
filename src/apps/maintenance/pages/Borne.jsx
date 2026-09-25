// src/apps/maintenance/pages/Borne.jsx
// ============================================================================
// Borne d'atelier (/maintenance/borne) — TV + Raspberry Pi en plein écran, écran
// d'affichage ET de saisie (spec 2026-09-25 § 5). Lisible à 3 m.
//   - En retard (ambre) en tête, puis les tâches du jour groupées par unité ;
//     les réalisations du jour restent affichées, grisées (qui / quand).
//   - Rafraîchissement 60 s ; la règle « dû / en retard » vient d'echeances.js.
//   - Pannes VISIBLES : hors ligne ⇒ bandeau + validations désactivées (pas de file
//     d'attente : un « fait » perdu en silence serait pire qu'un « réessayez »).
// ============================================================================
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WifiOff, Loader2, Clock, ArrowLeft } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import {
  useMaintenanceReferentiel, useMaintenanceDerniersLogs, useMaintenanceLogs, useMaintenanceMutations,
} from '@hooks/useMaintenance';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { jourParis, ajouterJours, tableauDuJour } from '@/lib/maintenance/echeances';
import { useEnLigne, useMaintenant } from '../lib/useEnLigne';
import TuileTache from '../components/borne/TuileTache';
import ValidationDialog from '../components/borne/ValidationDialog';

const RAFRAICHISSEMENT_MS = 60_000;
const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });
const HEURE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

export default function Borne() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { settings } = useOrgSettings();
  const company = buildCompanyInfo(settings);
  const enLigne = useEnLigne();
  const maintenant = useMaintenant(30_000);
  const aujourdhui = jourParis(maintenant);
  const estCompteBorne = (settings?.maintenance?.kiosk_user_ids || []).includes(user?.id);

  // Borne stable pour la journée : la clé de cache ne change qu'au changement de jour.
  const filtresJour = useMemo(() => ({ depuis: `${ajouterJours(aujourdhui, -1)}T00:00:00Z` }), [aujourdhui]);
  const opts = { refetchInterval: RAFRAICHISSEMENT_MS };
  const referentiel = useMaintenanceReferentiel(orgId, opts);
  const derniers = useMaintenanceDerniersLogs(orgId, opts);
  const logsJour = useMaintenanceLogs(orgId, filtresJour, opts);
  const { recordCompletion } = useMaintenanceMutations(orgId);
  const [cible, setCible] = useState(null);

  const echecReseau = referentiel.isError || derniers.isError || logsJour.isError;
  const horsLigne = !enLigne || echecReseau;
  const chargement = referentiel.isLoading || derniers.isLoading || logsJour.isLoading;

  const { units = [], tasks = [], operators = [] } = referentiel.data || {};
  const tableau = useMemo(() => tableauDuJour({
    units, tasks, derniersLogs: derniers.data || [], logsDuJour: logsJour.data || [], aujourdhui,
  }), [units, tasks, derniers.data, logsJour.data, aujourdhui]);
  const prenomParId = useMemo(() => new Map(operators.map((o) => [o.id, o.first_name])), [operators]);
  const operateursActifs = useMemo(() => operators.filter((o) => o.active), [operators]);

  const fermer = useCallback(() => setCible(null), []);
  const enregistrer = useCallback((payload) => recordCompletion.mutateAsync(payload), [recordCompletion]);

  const rienAujourdhui = !chargement && tableau.enRetard.length === 0 && tableau.unites.length === 0;

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="flex items-center justify-between gap-6 px-8 py-5 border-b border-slate-700">
        <div className="flex items-center gap-4">
          {!estCompteBorne && (
            <Link to="/maintenance" className="p-2 rounded-lg hover:bg-slate-800" aria-label="Retour au suivi">
              <ArrowLeft className="w-6 h-6 text-slate-400" />
            </Link>
          )}
          {company.logoUrl && <img src={company.logoUrl} alt="" className="h-12 w-auto rounded bg-white p-1" />}
          <div>
            <p className="text-2xl font-bold">{settings?.brand_name || organization?.name}</p>
            <p className="text-lg text-slate-400">Maintenance du jour</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tabular-nums">{HEURE.format(maintenant)}</p>
          <p className="text-lg text-slate-300 first-letter:uppercase">{DATE_LONGUE.format(maintenant)}</p>
        </div>
      </header>

      {horsLigne && (
        <div className="flex items-center gap-3 bg-red-700 px-8 py-4 text-2xl font-semibold" role="alert">
          <WifiOff className="w-8 h-8" />
          Hors ligne : validations impossibles. Vérifier le Wi-Fi.
        </div>
      )}

      <main className="px-8 py-6 space-y-8">
        {chargement && (
          <div className="flex justify-center py-24"><Loader2 className="w-12 h-12 animate-spin text-slate-400" /></div>
        )}

        {tableau.enRetard.length > 0 && (
          <section>
            <h2 className="flex items-center gap-3 text-2xl font-bold text-amber-300 mb-4">
              <Clock className="w-7 h-7" /> En retard ({tableau.enRetard.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {tableau.enRetard.map((r) => (
                <TuileTache
                  key={r.tache.id}
                  tache={r.tache}
                  unite={r.unite}
                  joursDeRetard={r.joursDeRetard}
                  dernierCommentaire={r.dernierLog?.status === 'not_done' ? r.dernierLog.comment : null}
                  desactive={horsLigne}
                  onValider={() => setCible({ tache: r.tache, unite: r.unite, echeance: r.echeance })}
                />
              ))}
            </div>
          </section>
        )}

        {tableau.unites.map((g) => (
          <section key={g.unite.id}>
            <h2 className="text-2xl font-bold text-slate-100 mb-4">{g.unite.name}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {g.aFaire.map((x) => (
                <TuileTache
                  key={x.tache.id}
                  tache={x.tache}
                  desactive={horsLigne}
                  onValider={() => setCible({ tache: x.tache, unite: g.unite, echeance: x.echeance })}
                />
              ))}
              {g.faites.map((x) => (
                <TuileTache key={x.log.id} tache={x.tache} log={x.log} operateur={prenomParId.get(x.log.operator_id)} />
              ))}
            </div>
          </section>
        ))}

        {rienAujourdhui && !horsLigne && (
          <p className="py-24 text-center text-3xl text-slate-300">✓ Aucune tâche prévue aujourd&apos;hui.</p>
        )}
      </main>

      {cible && (
        <ValidationDialog cible={cible} operateurs={operateursActifs} onFermer={fermer} onEnregistrer={enregistrer} />
      )}
    </div>
  );
}
