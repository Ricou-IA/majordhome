import { useEffect, useState } from 'react';
import { Phone, CalendarPlus, XCircle, PhoneForwarded } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { callCampaignsService } from '@services/callCampaigns.service';
import { appointmentsService } from '@services/appointments.service';
import { entretiensService } from '@services/entretiens.service';

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
  const [rdvDate, setRdvDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [rdvTime, setRdvTime] = useState('');
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

  const bookRdv = async () => {
    setBusy(true);
    const { error } = await appointmentsService.createAppointment({
      coreOrgId: orgId,
      technicianIds: [],
      appointment_type: 'maintenance',
      client_id: ctx?.client_id ?? null,
      intervention_id: contact.id,
      scheduled_date: rdvDate,
      scheduled_start: rdvTime || null,
      subject: `Entretien annuel — ${contact.name}`,
      client_name: contact.name,
      client_phone: contact.phone || '',
      status: 'scheduled',
      priority: 'normal',
    });
    setBusy(false);
    if (error) {
      toast.error('Erreur création RDV');
      return;
    }
    toast.success('RDV planifié');
    onClosed({ result: 'rdv_booked' });
  };

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

  return (
    <div className="rounded-xl border bg-white shadow-lg p-5">
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

      {mode === 'rdv' && (
        <div className="mt-4 space-y-2 border-t pt-3">
          <label className="block text-sm font-medium text-gray-700">Date du RDV</label>
          <input
            type="date"
            value={rdvDate}
            onChange={(e) => setRdvDate(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <label className="block text-sm font-medium text-gray-700">
            Heure <span className="font-normal text-gray-400">(facultatif)</span>
          </label>
          <input
            type="time"
            value={rdvTime}
            onChange={(e) => setRdvTime(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <button
            disabled={busy}
            onClick={bookRdv}
            className="w-full py-2 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-50"
          >
            {busy ? 'Enregistrement…' : 'Confirmer le RDV'}
          </button>
        </div>
      )}

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
