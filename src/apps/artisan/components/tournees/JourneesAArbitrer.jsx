// src/apps/artisan/components/tournees/JourneesAArbitrer.jsx
// ============================================================================
// Journées PLEINES que l'ordonnanceur ne sait pas tenir (spec 2026-09-12
// « bloc contrat et journée pleine », R3) : le figeage automatique les laisse
// de côté, il faut un humain. Affichées dans le Dashboard des entretiens (spec
// auto-RDV 2026-09-29 § 5), même verdict que l'edge `tournees-figer` — avec des
// trajets estimés à vol d'oiseau, le navigateur n'ayant pas la matrice de
// chaque journée.
// Un clic ouvre la journée dans le Planning (lienJourneePlanning).
// ============================================================================
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Route } from 'lucide-react';
import { useJourneesAArbitrer } from '@hooks/useTournees';
import { formatDateFR } from '@/lib/utils';
import { formatDuree, lienJourneePlanning } from './tourneesPanelUtils';

/** Carte du Dashboard des entretiens. Rien à afficher = rien ; un échec de chargement, lui, se voit. */
export function JourneesAArbitrer({ coreOrgId }) {
  const navigate = useNavigate();
  const { journees, error } = useJourneesAArbitrer(coreOrgId);
  if (error) {
    return (
      <div className="card text-xs text-amber-800 bg-amber-50 border-amber-200">
        Journées à arbitrer indisponibles — chargement des tournées en échec ({error.message || 'échec inconnu'}).
      </div>
    );
  }
  if (journees.length === 0) return null;

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-secondary-900 flex items-center gap-2 mb-1">
        <AlertTriangle className="w-5 h-5 text-red-500" />
        Journées pleines à arbitrer
        <span className="text-sm font-normal text-gray-400">({journees.length})</span>
      </h2>
      <p className="text-xs text-secondary-500 mb-3">
        Pleines, mais impossibles à ordonnancer dans les tolérances : le figeage automatique les laisse de côté.
        Trajets estimés à vol d’oiseau — ouvrez la journée dans le Planning pour les chiffres réels.
      </p>
      <ul className="divide-y divide-gray-100">
        {journees.map(({ journee: j, sequence }) => {
          const d = sequence?.diagnostic;
          const motifs = [];
          if (d?.depasseBudget) motifs.push(`${formatDuree(d.chargeMinutes)} d’homme pour ${formatDuree(j.budgetMinutes)}`);
          if (d?.conflits?.length) motifs.push(`${d.conflits.length} trajet(s) qui ne tiennent pas entre deux rendez-vous`);
          if (motifs.length === 0) motifs.push(sequence?.raison === 'amplitude' ? 'la journée déborde de l’amplitude' : 'un rendez-vous ne tient pas dans sa fenêtre');
          return (
            <li key={`${j.date}-${j.technicienId}`}>
              <button
                type="button"
                onClick={() => navigate(lienJourneePlanning(j))}
                className="w-full flex items-center justify-between gap-3 text-left px-2 py-2 rounded hover:bg-gray-50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-secondary-900 truncate">
                    {formatDateFR(j.date)} — {j.technicienNom}
                  </span>
                  <span className="block text-xs text-secondary-500 truncate">
                    {j.rdvs.length} RDV · {motifs.join(' · ')}
                  </span>
                </span>
                <Route className="w-4 h-4 text-secondary-400 shrink-0" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
