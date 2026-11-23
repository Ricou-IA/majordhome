/**
 * ConfirmationClientSection.jsx - Majord'home Artisan
 * ============================================================================
 * Fenêtre d'un RDV (édition) : le RDV est-il confirmé au client ? (Eric 2026-11-23)
 *   - « Confirmé au client » : après un appel ou un message ; fige l'heure d'un RDV
 *     adaptable (le moteur des tournées ne le décale plus seul). La base retire la
 *     confirmation si la date ou l'heure change.
 *   - « Envoyer un rappel » : SMS `rappel_rdv` (entretien, SAV), marqué comme le cron.
 * Les deux gestes s'enregistrent tout de suite, sans passer par « Enregistrer ».
 * Règles : src/lib/confirmationRdv.js.
 * ============================================================================
 */

import { useState } from 'react';
import { PhoneCall, CheckCircle2, MessageSquare, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirmationRdv } from '@hooks/useAppointments';
import { etatConfirmation, rappelPropose } from '@/lib/confirmationRdv';
import { smsNameForMember } from '@/lib/smsCampaigns';
import { formatDateShortFR } from '@/lib/utils';

/**
 * @param {Object} props
 * @param {Object} props.appointment   RDV tel qu'ouvert (ligne de majordhome_appointments + technician_ids)
 * @param {string} props.orgId         org CORE
 * @param {Array}  props.teamMembers   membres de l'équipe (nom de qui a confirmé, prénom du technicien)
 * @param {Function} [props.onEcrit]   (ligne écrite) => void — la fenêtre réaligne son formulaire
 *   (souplesse « figé ») pour qu'un « Enregistrer » ne défige pas le RDV
 */
export function ConfirmationClientSection({ appointment, orgId, teamMembers = [], onEcrit }) {
  const { confirmer, isConfirming, envoyerRappel, isSendingRappel } = useConfirmationRdv(orgId);
  // La fenêtre garde l'objet ouvert : on suit ici ce qui vient d'être écrit.
  const [local, setLocal] = useState({});
  const rdv = { ...appointment, ...local };
  const { etat, joursDepuisPose } = etatConfirmation(rdv);
  if (etat === 'sans_objet') return null;

  const confirme = etat === 'confirme';
  const auteur = confirme
    ? teamMembers.find((m) => m.user_id && m.user_id === rdv.client_confirmed_by)
    : null;
  const technicien = teamMembers.find((m) => (rdv.technician_ids || []).includes(m.id));

  const basculer = async () => {
    try {
      const data = await confirmer({ appointment: rdv, confirme: !confirme });
      setLocal((l) => ({ ...l, ...data }));
      onEcrit?.(data);
      toast.success(confirme ? 'Confirmation retirée : le RDV redevient provisoire' : 'RDV confirmé au client');
    } catch (err) {
      toast.error(err?.message || 'Confirmation non enregistrée');
    }
  };

  const rappel = async () => {
    try {
      const data = await envoyerRappel({ appointment: rdv, technicianName: smsNameForMember(technicien) });
      setLocal((l) => ({ ...l, client_notified_at: data.sentAt }));
      toast.success('Rappel envoyé au client');
    } catch (err) {
      toast.error(err?.message || 'Rappel non envoyé');
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-secondary-900 mb-3 flex items-center gap-2">
        <PhoneCall className="w-4 h-4 text-secondary-500" />
        Confirmation au client
      </h3>
      <div className={`rounded-lg border p-3 space-y-3 ${confirme ? 'bg-st-ok-bg border-st-ok/30' : etat === 'a_confirmer' ? 'bg-st-attente-bg border-st-attente/30' : 'bg-secondary-25 border-secondary-200'}`}>
        <p className={`text-sm flex items-start gap-2 ${confirme ? 'text-st-ok' : etat === 'a_confirmer' ? 'text-st-attente' : 'text-secondary-700'}`}>
          {confirme ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : etat === 'a_confirmer' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : null}
          <span>
            {confirme
              ? `Confirmé au client le ${formatDateShortFR(rdv.client_confirmed_at)}${auteur ? ` par ${auteur.first_name || auteur.display_name}` : ''}. Le déplacer oblige à le rappeler.`
              : etat === 'a_confirmer'
                ? `À confirmer : posé il y a ${joursDepuisPose} jours sans confirmation au client.`
                : 'Provisoire : pas encore confirmé au client.'}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={confirme ? 'ghost' : 'secondary'} onClick={basculer} disabled={isConfirming}>
            {isConfirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {confirme ? 'Retirer la confirmation' : 'Confirmé au client'}
          </Button>
          {rappelPropose(rdv) && (
            <Button type="button" size="sm" variant="ghost" onClick={rappel} disabled={isSendingRappel}>
              {isSendingRappel ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
              {rdv.client_notified_at ? 'Renvoyer le rappel' : 'Envoyer un rappel (SMS)'}
            </Button>
          )}
          {rdv.client_notified_at && (
            <span className="text-xs text-secondary-500">Rappel envoyé le {formatDateShortFR(rdv.client_notified_at)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConfirmationClientSection;
