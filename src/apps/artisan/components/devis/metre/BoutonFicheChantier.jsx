// src/apps/artisan/components/devis/metre/BoutonFicheChantier.jsx
// Fiche chantier d'un devis qui porte un métré de fumisterie : plan, références, relevé saisi, alertes
// acceptées, points à vérifier. Imprimée pour l'équipe, jamais envoyée au client. N'apparaît que si le
// devis a un métré enregistré.
import { useState } from 'react';
import { HardHat, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFumMetreByQuote } from '@hooks/useFumisterie';
import { downloadBlob } from '@/lib/utils';
import { genererPlanConduit } from './planConduitExport';

export default function BoutonFicheChantier({ orgId, quote, settings }) {
  const { data: metre } = useFumMetreByQuote(orgId, quote?.id);
  const [enCours, setEnCours] = useState(false);
  if (!metre) return null;
  const imprimer = async () => {
    setEnCours(true);
    const r = await genererPlanConduit({ orgId, quote, settings, variante: 'chantier' });
    setEnCours(false);
    if (!r.blob) { toast.error(`Fiche chantier impossible : ${r.message || 'métré introuvable'}`); return; }
    downloadBlob(r.blob, `${quote.quote_number || 'devis'}-fiche-chantier.pdf`);
  };
  return (
    <button type="button" onClick={imprimer} disabled={enCours} className="btn-secondary btn-sm" title="Plan, références et points à vérifier, pour l'équipe (jamais envoyée au client)">
      {enCours ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <HardHat className="w-4 h-4 mr-1" />}
      Fiche chantier
    </button>
  );
}

/** Le plan du conduit n'accompagne que le PDF Majord'home : l'API Pennylane n'a pas été essayée pour une pièce jointe de devis. */
export function MentionPlanPennylane({ orgId, quoteId }) {
  const { data: metre } = useFumMetreByQuote(orgId, quoteId);
  if (!metre) return null;
  return (
    <div className="px-6 py-2 border-t bg-secondary-50 text-xs text-secondary-700">
      Le plan du conduit est joint au PDF Majord’home (« Générer PDF ») ; il ne part pas avec le devis envoyé dans Pennylane.
    </div>
  );
}
