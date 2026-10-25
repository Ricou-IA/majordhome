/**
 * OffreEntete.jsx — En-tête d'une offre lue : fournisseur, numéro, dates, contrôles, consommation de la lecture
 * ============================================================================
 * Les alertes des contrôles (controlerOffre) sont affichées telles quelles : un total qui ne retombe pas signale
 * une ligne oubliée ou mal lue — on le dit, on ne le masque pas.
 * ============================================================================
 */

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatEuro } from '@/lib/utils';

const dateFr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

export default function OffreEntete({ lecture }) {
  const { offre, controle, conso, modele } = lecture;
  const alertes = controle?.alertes || [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-secondary-700">
        <span>Offre de <b>{offre.fournisseur?.nom || 'fournisseur non lu'}</b></span>
        <span>n° <b>{offre.numero || '—'}</b></span>
        <span>du {dateFr(offre.date)}</span>
        {offre.validite && <span>valable jusqu&apos;au {dateFr(offre.validite)}</span>}
        <span>{offre.lignes.length} ligne{offre.lignes.length > 1 ? 's' : ''}</span>
        {offre.total_ht != null && <span>total {formatEuro(offre.total_ht)} HT{offre.eco_total ? ` dont ${formatEuro(offre.eco_total)} d’éco-participations` : ''}</span>}
      </div>
      {controle?.total_verifie && (
        <p className="flex items-center gap-1.5 text-xs text-secondary-500">
          <CheckCircle2 className="w-3.5 h-3.5 text-primary-600" /> La somme des lignes retombe sur le total de l&apos;offre.
        </p>
      )}
      {alertes.length > 0 && (
        <ul className="space-y-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          {alertes.map((a, i) => (
            <li key={`${a.code}-${i}`} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{a.message}</li>
          ))}
        </ul>
      )}
      {offre.remarque && <p className="text-xs text-secondary-500">Note de lecture : {offre.remarque}</p>}
      {conso && (
        <p className="text-[11px] text-secondary-400">
          Lecture : {modele} · {conso.input_tokens.toLocaleString('fr-FR')} jetons lus, {conso.output_tokens.toLocaleString('fr-FR')} écrits
        </p>
      )}
    </div>
  );
}
