/**
 * JoursDePoseSection.jsx — bloc « Jours de pose » de la fenêtre d'un RDV d'installation.
 *
 * Tous les jours de pose du client, rangés par chantier (celui du RDV ouvert d'abord) :
 * un chantier posé sur plusieurs jours, ou un client à deux chantiers, ne laisse plus de
 * jour introuvable depuis le RDV ouvert (vécu CONDOM 2026-11-25). Chaque autre jour se
 * supprime ici ; le RDV ouvert garde son menu « … » du pied de fenêtre.
 * Règle de regroupement : `joursParChantier` (src/lib/joursIntervention.js).
 */
import { useMemo, useState } from 'react';
import { CalendarDays, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePosesDuLead, useSupprimerRdv } from '@hooks/useAppointments';
import { getChantierAmount } from '@services/chantiers.service';
import { joursParChantier } from '@/lib/joursIntervention';
import { formatDateLongueFR } from '@/lib/datesFr';
import { formatEuroCeil } from '@/lib/utils';
import { MenuActions } from '@/components/ui/menu-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LignesSquelette } from '@/components/ui/squelette';

const heures = (rdv) => (rdv.scheduled_start
  ? `${rdv.scheduled_start.slice(0, 5)}${rdv.scheduled_end ? ` – ${rdv.scheduled_end.slice(0, 5)}` : ''}`
  : '');

function titreGroupe(groupe) {
  const base = groupe.chantierId
    ? (groupe.courant ? 'Ce chantier' : 'Autre chantier de ce client')
    : 'Pose sans chantier rattaché';
  if (!groupe.chantier) return base;
  const label = groupe.chantier.label && groupe.chantier.label !== 'Devis' ? ` · ${groupe.chantier.label}` : '';
  const montant = getChantierAmount(groupe.chantier);
  return `${base}${label}${montant > 0 ? ` · ${formatEuroCeil(montant)} HT` : ''}`;
}

/**
 * @param {object} props
 * @param {string} props.orgId - org CORE
 * @param {object} props.appointment - RDV ouvert (installation, `lead_id` renseigné)
 * @param {object[]} props.members - team_members (noms des personnes posées)
 * @param {boolean} [props.disabled]
 */
export function JoursDePoseSection({ orgId, appointment, members = [], disabled = false }) {
  const { rdvs, chantiers, isLoading, error } = usePosesDuLead(orgId, appointment?.lead_id);
  const supprimer = useSupprimerRdv(orgId);
  const [aSupprimer, setASupprimer] = useState(null);

  const groupes = useMemo(
    () => (rdvs ? joursParChantier(rdvs, chantiers, appointment?.chantier_id || null) : null),
    [rdvs, chantiers, appointment?.chantier_id],
  );
  const nomDe = (id) => members.find((m) => m.id === id)?.display_name?.split(' ')[0] || null;
  const totalJours = groupes ? groupes.reduce((n, g) => n + g.jours.length, 0) : 0;

  const confirmerSuppression = async () => {
    try {
      await supprimer.mutateAsync(aSupprimer.id);
      toast.success('Jour de pose supprimé');
      setASupprimer(null);
    } catch {
      toast.error('Suppression refusée');
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-secondary-900 mb-3 flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-secondary-500" />
        Jours de pose
        {groupes && <span className="text-xs font-normal text-secondary-500">· {totalJours} jour{totalJours > 1 ? 's' : ''}</span>}
      </h3>

      {isLoading && <LignesSquelette nombre={2} libelle="Chargement des jours de pose" />}
      {!isLoading && error && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Les jours de pose n&apos;ont pas pu être lus.
        </p>
      )}

      {groupes && (
        <div className="space-y-3">
          {groupes.map((g) => (
            <div key={g.chantierId || 'sans'}>
              <p className="text-xs font-medium text-secondary-600 mb-1.5">{titreGroupe(g)}</p>
              {g.jours.length === 0 ? (
                <p className="text-xs text-secondary-500 italic">Aucun jour posé.</p>
              ) : (
                <ul className="space-y-1.5">
                  {g.jours.map((jour, i) => {
                    const estCeRdv = jour.id === appointment?.id;
                    const personnes = (jour.technician_ids || []).map(nomDe).filter(Boolean).join(', ');
                    return (
                      <li
                        key={jour.id}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${estCeRdv ? 'border-primary-300 bg-primary-50' : 'border-secondary-200 bg-white'}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap text-sm">
                            <span className="font-medium text-secondary-900">{formatDateLongueFR(jour.scheduled_date)}</span>
                            {g.jours.length > 1 && <span className="text-xs text-secondary-500">J{i + 1}/{g.jours.length}</span>}
                            <span className="text-xs text-secondary-500">{heures(jour)}</span>
                            {estCeRdv && <span className="text-xs font-medium text-primary-700">· ce RDV</span>}
                          </div>
                          {personnes && <p className="text-xs text-secondary-500 truncate">{personnes}</p>}
                        </div>
                        {!estCeRdv && !disabled && (
                          <MenuActions
                            libelle="Actions sur ce jour de pose"
                            actions={[
                              { label: 'Supprimer ce jour', icon: Trash2, danger: true, onClick: () => setASupprimer(jour) },
                            ]}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!aSupprimer}
        onOpenChange={(o) => { if (!o) setASupprimer(null); }}
        title="Supprimer ce jour de pose ?"
        description={aSupprimer
          ? `Le RDV d'installation du ${formatDateLongueFR(aSupprimer.scheduled_date)} sera retiré du planning.`
          : ''}
        confirmLabel="Supprimer"
        onConfirm={confirmerSuppression}
        loading={supprimer.isPending}
      />
    </div>
  );
}

export default JoursDePoseSection;
