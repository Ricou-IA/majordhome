// src/apps/artisan/components/devis/PennylaneDoublonsClients.jsx
// ============================================================================
// Fiches client Pennylane en double, remontées sur le TABLEAU DE BORD de
// l'org_admin (décision Eric 2026-09-16, après 10 fiches rejouées chaque heure
// par le cron). Source = projection `majordhome_pennylane_customer_duplicates`
// écrite par `pennylane-sync-cron` : un client MDH déjà lié à une fiche PL est
// matché par une SECONDE fiche PL. Le cron garde le lien en place ; ici on dit
// à l'admin quelle fiche fusionner dans Pennylane (garder celle liée à MDH).
// Une fiche fusionnée disparaît d'elle-même au passage horaire suivant.
// Pas de lien profond vers Pennylane : l'URL app.pennylane.com/… renvoie 404
// en multi-cabinet (cf. Module Pennylane), on donne l'identifiant à chercher.
// ============================================================================
import { useNavigate } from 'react-router-dom';
import { Copy as CopyIcon } from 'lucide-react';
import { usePennylaneCustomerDuplicates } from '@hooks/usePennylane';
import { formatDateShortFR } from '@/lib/utils';

/** Carte du tableau de bord (org_admin + Pennylane actif). Rien à afficher = rien ; un échec de chargement, lui, se voit. */
export function PennylaneDoublonsClients() {
  const navigate = useNavigate();
  const { duplicates, error } = usePennylaneCustomerDuplicates();

  if (error) {
    return (
      <div className="card text-xs text-amber-800 bg-amber-50 border-amber-200">
        Doublons Pennylane indisponibles — chargement en échec ({error.message || 'échec inconnu'}).
      </div>
    );
  }
  if (duplicates.length === 0) return null;

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-secondary-900 flex items-center gap-2 mb-1">
        <CopyIcon className="w-5 h-5 text-amber-500" />
        Clients en double dans Pennylane
        <span className="text-sm font-normal text-gray-400">({duplicates.length})</span>
      </h2>
      <p className="text-xs text-secondary-500 mb-3">
        Une seconde fiche Pennylane correspond à un client déjà lié. À fusionner dans Pennylane en gardant la fiche
        liée à Majord’home ; la ligne disparaît au passage suivant du cron.
      </p>
      <ul className="divide-y divide-gray-100">
        {duplicates.map((d) => (
          <li key={d.pennylaneId} className="flex items-start justify-between gap-3 px-2 py-2">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => navigate(`/clients/${d.clientId}`)}
                className="text-sm font-medium text-secondary-900 hover:underline truncate text-left"
              >
                {d.clientName || 'Client sans nom'}
                {d.clientNumber != null && (
                  <span className="ml-1 text-xs font-normal text-gray-400">n° {d.clientNumber}</span>
                )}
              </button>
              <div className="text-xs text-secondary-500">
                <span className="text-secondary-700">Garder</span> la fiche {d.mappedPennylaneId}
                {d.mappedName ? ` « ${d.mappedName} »` : ''} ·{' '}
                <span className="text-secondary-700">fusionner</span> la fiche {d.pennylaneId}
                {d.plName ? ` « ${d.plName} »` : ''}
                {d.plEmail ? ` (${d.plEmail})` : ''}
              </div>
            </div>
            <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap">
              vu le {formatDateShortFR(d.firstSeenAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
