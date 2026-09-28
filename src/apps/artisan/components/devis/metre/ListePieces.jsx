// src/apps/artisan/components/devis/metre/ListePieces.jsx
// Liste de pièces chiffrée + contrôles du métré. Rendu pur des sorties de calculerMetre.
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { formatEuro } from '@/lib/utils';

const STATUT = { catalogue: 'bg-secondary-100 text-secondary-700 border-secondary-300', implicite: 'bg-white text-secondary-600 border-secondary-200', provisoire: 'bg-primary-50 text-primary-800 border-primary-300' };
const NIVEAU = { ok: ['✓ Conforme', 'border-secondary-500 bg-secondary-50', CheckCircle2], warn: ['⚠ À vérifier', 'border-primary-500 bg-primary-50', AlertTriangle], info: ['ⓘ Info', 'border-secondary-300 bg-white', Info] };

export function Alertes({ alertes }) {
  return (
    <div className="space-y-2">
      {alertes.map((a, i) => {
        const [tag, cls, Icon] = NIVEAU[a.niveau] || NIVEAU.info;
        return (
          <div key={`${a.code}-${i}`} className={`flex gap-2 items-start border-l-4 px-3 py-2 text-sm ${cls}`}><Icon className="w-4 h-4 mt-0.5 shrink-0" /><span><b className="font-mono text-[11px] uppercase mr-2">{tag}</b>{a.message}{a.source ? <span className="text-xs text-secondary-500"> — {a.source}</span> : null}</span></div>
        );
      })}
    </div>
  );
}

export default function ListePieces({ lignes, totaux }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-secondary-500 border-b-2 border-secondary-900">
          <th className="py-2 pr-2">Rep.</th><th className="py-2 pr-2">Désignation</th><th className="py-2 pr-2">Référence</th><th className="py-2 pr-2 text-right">Qté</th><th className="py-2 pr-2 text-right">PU vente HT</th><th className="py-2 pr-2 text-right">PU achat HT</th><th className="py-2 text-right">Total vente HT</th></tr></thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-secondary-100 align-top">
              <td className="py-2 pr-2"><span className="inline-grid place-items-center w-6 h-6 rounded-full bg-primary-400 text-secondary-900 font-bold border border-secondary-900 text-xs">{l.repere}</span></td>
              <td className="py-2 pr-2">{l.libelle}<span className={`ml-2 inline-block border rounded px-1.5 text-[10px] uppercase font-mono ${STATUT[l.statut] || STATUT.implicite}`}>{l.statut}</span>{l.sous_libelle && <span className="block text-xs text-secondary-500">{l.sous_libelle}</span>}</td>
              <td className="py-2 pr-2 font-mono text-xs text-secondary-600">{l.reference || '—'}</td>
              <td className="py-2 pr-2 text-right font-mono">{l.quantite}</td>
              <td className="py-2 pr-2 text-right font-mono">{l.prix_vente_ht != null ? formatEuro(l.prix_vente_ht) : '—'}</td>
              <td className="py-2 pr-2 text-right font-mono text-secondary-500">{l.prix_achat_ht != null ? formatEuro(l.prix_achat_ht) : '—'}</td>
              <td className="py-2 text-right font-mono">{l.prix_vente_ht != null ? formatEuro(l.prix_vente_ht * l.quantite) : <span className="text-primary-800">à chiffrer</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t-2 border-secondary-900 font-semibold">
          <td colSpan={4} className="py-2">Fournitures fumisterie{totaux.lignes_a_chiffrer > 0 && <span className="text-primary-800 font-normal"> · dont {totaux.lignes_a_chiffrer} ligne{totaux.lignes_a_chiffrer > 1 ? 's' : ''} à chiffrer</span>}</td>
          <td colSpan={2} className="py-2 text-right text-xs text-secondary-500 font-normal">achat {formatEuro(totaux.achat_ht)} · marge {formatEuro(totaux.marge_ht)}</td>
          <td className="py-2 text-right text-lg">{formatEuro(totaux.vente_ht)}</td></tr></tfoot>
      </table>
    </div>
  );
}
