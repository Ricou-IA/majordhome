// src/apps/maintenance/components/SuiviTab.jsx
// Suivi du responsable : retards et tâches du jour, « pas pu faire » des 7 derniers jours,
// ponctualité du mois par unité. Tous les états viennent d'echeances.js (jamais recalculés ici).
import { useMemo } from 'react';
import { Loader2, Clock, AlertTriangle, CheckCircle2, Gauge } from 'lucide-react';
import {
  useMaintenanceReferentiel, useMaintenanceDerniersLogs, useMaintenanceLogs,
} from '@hooks/useMaintenance';
import { jourParis, ajouterJours, tableauDuJour, ponctualite } from '@/lib/maintenance/echeances';

const DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);

function Kpi({ icon: Icon, label, value, ton }) {
  const couleur = ton === 'alerte' ? 'text-amber-700 bg-amber-50' : 'text-blue-700 bg-blue-50';
  return (
    <div className="card flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${couleur}`}><Icon className="w-5 h-5" /></div>
      <div>
        <p className="text-2xl font-bold text-secondary-900">{value}</p>
        <p className="text-sm text-secondary-600">{label}</p>
      </div>
    </div>
  );
}

export default function SuiviTab({ orgId }) {
  const aujourdhui = jourParis(new Date());
  const debutMois = `${aujourdhui.slice(0, 8)}01`;
  const debut = [debutMois, ajouterJours(aujourdhui, -7)].sort()[0];
  // Clé stable pour la journée (le jour Paris d'hier à minuit UTC couvre tout le jour Paris).
  const filtres = useMemo(() => ({ depuis: `${ajouterJours(debut, -1)}T00:00:00Z` }), [debut]);

  const referentiel = useMaintenanceReferentiel(orgId);
  const derniers = useMaintenanceDerniersLogs(orgId);
  const logs = useMaintenanceLogs(orgId, filtres);

  const { units = [], tasks = [], operators = [] } = referentiel.data || {};
  const prenom = useMemo(() => new Map(operators.map((o) => [o.id, o.first_name])), [operators]);
  const tacheParId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const uniteParId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  const tableau = useMemo(() => tableauDuJour({
    units, tasks, derniersLogs: derniers.data || [], logsDuJour: logs.data || [], aujourdhui,
  }), [units, tasks, derniers.data, logs.data, aujourdhui]);

  const logsMois = useMemo(() => (logs.data || []).filter((l) => jourParis(l.done_at) >= debutMois), [logs.data, debutMois]);
  const nonFaits7j = useMemo(() => (logs.data || [])
    .filter((l) => l.status === 'not_done' && jourParis(l.done_at) >= ajouterJours(aujourdhui, -7)), [logs.data, aujourdhui]);
  const ponctualiteGlobale = ponctualite(logsMois);
  const ponctualiteParUnite = useMemo(() => units.filter((u) => !u.archived_at).map((u) => ({
    unite: u, ...ponctualite(logsMois.filter((l) => l.unit_id === u.id)),
  })), [units, logsMois]);

  if (referentiel.isLoading || derniers.isLoading || logs.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>;
  }
  if (referentiel.isError || derniers.isError || logs.isError) {
    return <div className="card text-red-700">Impossible de charger le suivi de maintenance. Réessayez.</div>;
  }
  if (tasks.length === 0) {
    return <div className="card text-secondary-600">Aucune tâche pour l&apos;instant : créez vos unités et leurs tâches dans l&apos;onglet « Unités &amp; tâches ».</div>;
  }

  const aFaire = tableau.unites.flatMap((g) => g.aFaire.map((x) => ({ ...x, unite: g.unite })));

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Clock} label="Tâches en retard" value={tableau.enRetard.length} ton={tableau.enRetard.length ? 'alerte' : null} />
        <Kpi icon={CheckCircle2} label="Restant à faire aujourd'hui" value={aFaire.length} />
        <Kpi icon={AlertTriangle} label="« Pas pu faire » (7 jours)" value={nonFaits7j.length} ton={nonFaits7j.length ? 'alerte' : null} />
        <Kpi icon={Gauge} label="Ponctualité du mois" value={pct(ponctualiteGlobale.taux)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card space-y-3">
          <h2 className="font-semibold text-secondary-900">En attente</h2>
          {tableau.enRetard.length === 0 && aFaire.length === 0 && <p className="text-sm text-secondary-500">✓ Tout est à jour.</p>}
          <ul className="divide-y divide-secondary-100">
            {tableau.enRetard.map((r) => (
              <li key={r.tache.id} className="py-2 flex items-center justify-between gap-3">
                <span><span className="text-secondary-500">{r.unite.name} · </span>{r.tache.label}</span>
                <span className="text-sm font-medium text-amber-700 whitespace-nowrap">retard {r.joursDeRetard} j</span>
              </li>
            ))}
            {aFaire.map((x) => (
              <li key={x.tache.id} className="py-2 flex items-center justify-between gap-3">
                <span><span className="text-secondary-500">{x.unite.name} · </span>{x.tache.label}</span>
                <span className="text-sm text-secondary-500 whitespace-nowrap">aujourd&apos;hui</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold text-secondary-900">« Pas pu faire » des 7 derniers jours</h2>
          {nonFaits7j.length === 0 && <p className="text-sm text-secondary-500">Aucun.</p>}
          <ul className="divide-y divide-secondary-100">
            {nonFaits7j.map((l) => (
              <li key={l.id} className="py-2">
                <p>
                  <span className="text-secondary-500">{uniteParId.get(l.unit_id)?.name} · </span>
                  {tacheParId.get(l.task_id)?.label}
                </p>
                <p className="text-sm text-secondary-600">
                  {DATE_HEURE.format(new Date(l.done_at))} — {prenom.get(l.operator_id) || '?'} : « {l.comment} »
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold text-secondary-900">Ponctualité du mois par unité</h2>
        <p className="text-sm text-secondary-500">Part des réalisations faites au plus tard à leur échéance.</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-secondary-500">
              <th className="py-1 font-medium">Unité</th>
              <th className="py-1 font-medium text-right">Faites</th>
              <th className="py-1 font-medium text-right">À l&apos;heure</th>
              <th className="py-1 font-medium text-right">Pas pu faire</th>
              <th className="py-1 font-medium text-right">Ponctualité</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {ponctualiteParUnite.map((p) => (
              <tr key={p.unite.id}>
                <td className="py-1.5">{p.unite.name}</td>
                <td className="py-1.5 text-right">{p.faits}</td>
                <td className="py-1.5 text-right">{p.aLHeure}</td>
                <td className="py-1.5 text-right">{p.nonFaits}</td>
                <td className="py-1.5 text-right font-medium">{pct(p.taux)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
