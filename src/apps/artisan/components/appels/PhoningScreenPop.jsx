import { useEffect, useState } from 'react';
import { Phone, CalendarPlus, XCircle, PhoneForwarded } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { callCampaignsService } from '@services/callCampaigns.service';
import { entretiensService } from '@services/entretiens.service';
import { useTeamMembers } from '@hooks/useAppointments';
import { EventModal } from '../planning/EventModal';
import { createPortal } from 'react-dom';

/**
 * Screen-pop affiché quand un transfert d'appel est accepté.
 * Permet de caler un RDV, enregistrer un refus client, ou marquer "à rappeler".
 *
 * @param {{ contact:{id,phone,name}, orgId:string, onAccept:()=>void, onClosed:(p:{result,note?})=>void }} props
 */
export function PhoningScreenPop({ contact, orgId, onAccept, onClosed }) {
  const { user } = useAuth();
  const [ctx, setCtx] = useState(null);
  const [mode, setMode] = useState(null); // null | 'rdv' | 'refus'
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    callCampaignsService.getCardContext(contact.id).then(({ data }) => {
      if (alive) setCtx(data);
    });
    onAccept(); // l'humain a "pris" le transfert dès l'ouverture du pop
    return () => { alive = false; };
  }, [contact.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Équipe pour la fenêtre « Nouveau RDV »
  const { members } = useTeamMembers(orgId);


  const refuse = async () => {
    if (!ctx?.contract_id) {
      toast.error('Contrat introuvable');
      return;
    }
    setBusy(true);
    const { error } = await entretiensService.recordVisit({
      contractId: ctx.contract_id,
      orgId,
      year: ctx.visit_year,
      visitDate: null,
      status: 'cancelled',
      notes: note || null,
      userId: user?.id,
    });
    setBusy(false);
    if (error) {
      toast.error('Erreur enregistrement refus');
      return;
    }
    toast.success('Refus enregistré');
    onClosed({ result: 'refused', note });
  };

  const callback = () => onClosed({ result: 'callback' });

  const goBack = () => { setMode(null); };

  return (
    <div className="rounded-xl border bg-white shadow-lg p-5 overflow-y-auto max-h-[85vh]">
      <div className="flex items-center gap-2 text-emerald-700 mb-1">
        <PhoneForwarded className="h-5 w-5" />
        <span className="font-semibold">Appel transféré</span>
      </div>
      <h3 className="text-lg font-bold text-gray-900">{contact.name}</h3>
      <p className="text-sm text-gray-500 flex items-center gap-1">
        <Phone className="h-3.5 w-3.5" />
        {contact.phone}
      </p>
      {ctx?.contract_number && (
        <p className="text-xs text-gray-400 mt-0.5">Contrat {ctx.contract_number}</p>
      )}

      {/* Grille 3 actions — visible uniquement quand aucune action n'est choisie */}
      {mode === null && (
        <div className="grid grid-cols-3 gap-2 mt-4">
          <button
            onClick={() => setMode('rdv')}
            className="flex flex-col items-center gap-1 p-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          >
            <CalendarPlus className="h-5 w-5" />
            <span className="text-xs font-medium">Caler le RDV</span>
          </button>
          <button
            onClick={() => setMode('refus')}
            className="flex flex-col items-center gap-1 p-3 rounded-lg border border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
          >
            <XCircle className="h-5 w-5" />
            <span className="text-xs font-medium">Refusé client</span>
          </button>
          <button
            onClick={callback}
            className="flex flex-col items-center gap-1 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
          >
            <PhoneForwarded className="h-5 w-5" />
            <span className="text-xs font-medium">À rappeler</span>
          </button>
        </div>
      )}

      {/* Lien retour commun aux deux sous-panneaux */}
      {mode !== null && (
        <button
          onClick={goBack}
          className="mt-3 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          ← Retour
        </button>
      )}

      {/* RDV = la fenêtre unique « Nouveau RDV », rattachée à la carte entretien (elle passe en Planifié) */}
      {mode === 'rdv' && createPortal(
        <EventModal
          isOpen
          mode="create"
          prefillClient={{ id: ctx?.client_id ?? null, last_name: contact.name || '', phone: contact.phone || '' }}
          members={members || []}
          orgId={orgId}
          userId={user?.id}
          attachContext={{ interventionId: contact.id, lockedType: 'maintenance' }}
          onCreated={() => onClosed({ result: 'rdv_booked' })}   // hook journalise rdv_booked + avance la file
          onClose={() => setMode(null)}
          onSave={async () => false}
          onDelete={async () => {}}
          onCancel={async () => {}}
        />,
        document.body,
      )}

      {/* Panneau Refus — inchangé */}
      {mode === 'refus' && (
        <div className="mt-4 space-y-2 border-t pt-3">
          <label className="block text-sm font-medium text-gray-700">Motif du refus</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border rounded-lg text-sm"
            placeholder="Ex : déménage, plus de poêle…"
          />
          <button
            disabled={busy}
            onClick={refuse}
            className="w-full py-2 rounded-lg bg-red-600 text-white font-medium disabled:opacity-50"
          >
            {busy ? 'Enregistrement…' : 'Confirmer le refus'}
          </button>
        </div>
      )}
    </div>
  );
}
