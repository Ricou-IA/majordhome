/**
 * SAVInterventionFaiteModal.jsx — « Intervention faite » : clôturer un SAV traité sans planification.
 *
 * Cas d'usage (Eric, 2026-11-09) : un technicien règle le problème entre deux entretiens. On saisit
 * quand et qui, la carte passe en Réalisé et l'intervention est inscrite au planning après coup.
 * Règles : src/lib/savCloture.js · écriture : savClotureService (via useEntretienSAVMutations).
 */

import { useMemo, useState } from 'react';
import { X, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@hooks/useAppointments';
import { useEntretienSAVMutations } from '@hooks/useEntretienSAV';
import { TechnicianSelect } from '@apps/artisan/components/planning/TechnicianSelect';
import { clotureParDefaut, validerCloture, dateLocale, DUREES_CLOTURE } from '@/lib/savCloture';
import { formatDateShortFR } from '@/lib/utils';

const champ = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none';

const libelleDuree = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`);

/**
 * @param {{ item: object, onClose: () => void, onDone?: () => void }} props
 */
export function SAVInterventionFaiteModal({ item, onClose, onDone }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { members } = useTeamMembers(orgId);
  const { closeWithoutScheduling, isClosingWithoutScheduling } = useEntretienSAVMutations();

  const aujourdhui = dateLocale(new Date());
  const [saisie, setSaisie] = useState(() => clotureParDefaut(new Date()));
  // La personne n'est pré-cochée que si l'utilisateur connecté est lui-même technicien ;
  // `null` = pas encore touché (les membres arrivent après le premier rendu).
  const [techniciens, setTechniciens] = useState(null);

  // Techniciens d'abord, puis le reste de l'équipe (un commercial peut dépanner)
  const equipe = useMemo(
    () => [...(members || [])].sort((a, b) => Number(b.role === 'technician') - Number(a.role === 'technician')),
    [members],
  );
  const moi = useMemo(
    () => (members || []).find((m) => m.user_id === user?.id && m.role === 'technician')?.id || null,
    [members, user?.id],
  );
  const technicianIds = techniciens ?? (moi ? [moi] : []);

  const set = (cle) => (valeur) => setSaisie((s) => ({ ...s, [cle]: valeur }));
  const complete = { ...saisie, technicianIds };
  const erreurs = validerCloture(complete, { aujourdhui });
  const nom = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';

  const handleConfirm = async () => {
    if (erreurs.length > 0) { toast.error(erreurs[0]); return; }
    try {
      await closeWithoutScheduling(item, complete);
      toast.success(`SAV clôturé · intervention inscrite au planning du ${formatDateShortFR(saisie.date)}`);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err?.message || 'La clôture a échoué', { duration: 10000 });
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[calc(100%-2rem)] max-w-md bg-white rounded-xl shadow-2xl max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900">Intervention faite</h3>
              <p className="text-xs text-gray-500 truncate">{nom}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <p className="text-xs text-gray-500">
            Le SAV passe en Réalisé et l&apos;intervention est inscrite au planning à la date saisie, pour garder la trace du passage.
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 sm:col-span-1">
              <label htmlFor="sif-date" className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
              <input id="sif-date" type="date" max={aujourdhui} value={saisie.date} onChange={(e) => set('date')(e.target.value)} className={champ} />
            </div>
            <div>
              <label htmlFor="sif-heure" className="block text-sm font-medium text-gray-700 mb-1.5">Début</label>
              <input id="sif-heure" type="time" step="300" value={saisie.startTime} onChange={(e) => set('startTime')(e.target.value)} className={champ} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="sif-duree" className="block text-sm font-medium text-gray-700 mb-1.5">Durée</label>
              <select id="sif-duree" value={saisie.durationMinutes} onChange={(e) => set('durationMinutes')(Number(e.target.value))} className={`${champ} bg-white`}>
                {DUREES_CLOTURE.map((m) => <option key={m} value={m}>{libelleDuree(m)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1.5">Qui est intervenu <span className="text-red-500">*</span></span>
            <TechnicianSelect selectedIds={technicianIds} onChange={setTechniciens} members={equipe} placeholder="Choisir la ou les personnes..." />
          </div>

          <div>
            <label htmlFor="sif-fait" className="block text-sm font-medium text-gray-700 mb-1.5">Ce qui a été fait</label>
            <textarea
              id="sif-fait"
              rows={3}
              value={saisie.workPerformed}
              onChange={(e) => set('workPerformed')(e.target.value)}
              placeholder="Ex : remplacement de la bougie d'allumage, essai OK"
              className={`${champ} resize-none`}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
          <span className="text-xs text-amber-700">{erreurs[0] || ''}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Annuler</button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isClosingWithoutScheduling || erreurs.length > 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isClosingWithoutScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Clôturer le SAV
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default SAVInterventionFaiteModal;
