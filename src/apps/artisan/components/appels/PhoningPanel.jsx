import { X, PhoneOff, Voicemail, PhoneForwarded, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCallSession } from '@hooks/useCallSession';
import { PhoningScreenPop } from './PhoningScreenPop';

/**
 * Panneau modal de phoning outbound.
 * Affiche les compteurs en temps réel et le screen-pop quand un transfert décroche.
 *
 * @param {{ contacts:Array<{id,phone,name}>, orgId:string, onClose:()=>void }} props
 */
export function PhoningPanel({ contacts, orgId, onClose }) {
  const session = useCallSession({ orgId });
  const { status, counters, current } = session;

  const handleStart = async () => {
    const { error } = await session.start(contacts);
    if (error === 'hors_plage_horaire') {
      toast.error("Hors plage d'appel autorisée (9h-20h, hors dimanche).");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl bg-gray-50 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b">
          <h2 className="text-base font-semibold">Phoning — {contacts.length} contact(s)</h2>
          <button
            onClick={() => { session.stop(); onClose(); }}
            className="p-1.5 text-gray-400 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <Counter label="Appelés"       value={counters.dialed}    icon={Loader2} />
            <Counter label="Non décrochés" value={counters.no_answer} icon={PhoneOff} />
            <Counter label="Répondeurs"    value={counters.voicemail} icon={Voicemail} />
            <Counter label="Transferts"    value={counters.transfers} icon={PhoneForwarded} />
          </div>

          {status === 'popped' && current ? (
            <PhoningScreenPop
              contact={current}
              orgId={orgId}
              onAccept={session.acceptTransfer}
              onClosed={(p) => session.closeCurrent(p)}
            />
          ) : (
            <div className="text-center py-8">
              {status === 'idle' && (
                <button
                  onClick={handleStart}
                  className="px-6 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
                >
                  Démarrer la séquence
                </button>
              )}
              {status === 'running' && (
                <>
                  <p className="text-gray-500 animate-pulse">
                    Composition en cours… (en veille — vous serez notifié quand ça décroche)
                  </p>
                  <button onClick={session.pause} className="mt-3 text-sm text-gray-500 underline">
                    Mettre en pause
                  </button>
                </>
              )}
              {status === 'paused' && (
                <button
                  onClick={session.resume}
                  className="px-6 py-2.5 rounded-lg bg-blue-600 text-white"
                >
                  Reprendre
                </button>
              )}
              {status === 'done' && (
                <p className="text-emerald-600 font-medium">Séquence terminée.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Counter({ label, value, icon: Icon }) {
  return (
    <div className="bg-white rounded-lg border p-3 text-center">
      <Icon className="h-4 w-4 mx-auto text-gray-400 mb-1" />
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
