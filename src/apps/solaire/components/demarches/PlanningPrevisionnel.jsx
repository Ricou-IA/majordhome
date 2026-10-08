// src/apps/solaire/components/demarches/PlanningPrevisionnel.jsx
// Frise datée du parcours (dates calculées par le moteur, jamais recalculées ici).
import { useState } from 'react';
import { Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDateFR } from '@lib/utils';

const JALONS = [
  { cle: 'depot_dp', libelle: 'Dépôt de la déclaration préalable' },
  { cle: 'accord_dp', libelle: 'Accord prévu de la mairie' },
  { cle: 'depot_enedis', libelle: 'Demande Enedis déposée' },
  { cle: 'fin_recours', libelle: 'Fin du recours des tiers' },
  { cle: 'reponse_enedis', libelle: 'Réponse Enedis' },
  { cle: 'pose_au_plus_tot', libelle: 'Pose au plus tôt' },
  { cle: 'attestation_consuel', libelle: 'Attestation Consuel' },
  { cle: 'mise_en_service_au_plus_tard', libelle: 'Mise en service au plus tard' },
];

export default function PlanningPrevisionnel({ planning }) {
  const [showHyp, setShowHyp] = useState(false);
  if (!planning) return null;
  const dureeMois = String(planning.duree_totale_mois).replace('.', ',');
  return (
    <div className="space-y-3">
      <ol className="grid sm:grid-cols-2 gap-2">
        {JALONS.map((j) => (
          <li key={j.cle} className="flex items-start gap-2 rounded-md border border-secondary-200 px-3 py-2">
            <Calendar className="w-4 h-4 mt-0.5 text-[#1565C0] flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs text-secondary-500">{j.libelle}</p>
              <p className="text-sm font-medium text-secondary-900">{formatDateFR(planning[j.cle])}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-sm text-secondary-700">
        Durée totale estimée : <span className="font-semibold">{dureeMois} mois</span>
        <span className="text-secondary-500"> — délais indicatifs</span>
      </p>
      <button type="button" onClick={() => setShowHyp((v) => !v)} className="text-xs text-[#1565C0] inline-flex items-center gap-1">
        {showHyp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        Hypothèses du calcul
      </button>
      {showHyp && (
        <ul className="text-xs text-secondary-600 list-disc pl-5 space-y-0.5">
          {planning.hypotheses.map((h, i) => <li key={i}>{h}</li>)}
        </ul>
      )}
    </div>
  );
}
