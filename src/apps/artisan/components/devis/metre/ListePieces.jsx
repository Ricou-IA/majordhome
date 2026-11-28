// src/apps/artisan/components/devis/metre/ListePieces.jsx
// Liste de pièces chiffrée + contrôles du métré. Rendu pur des sorties de calculerMetre.
import { CheckCircle2, AlertTriangle, Info, ClipboardCheck } from 'lucide-react';
import { formatEuro } from '@/lib/utils';
import { StatusPill } from '@/components/ui/status-pill';

const STATUT = { catalogue: 'bg-secondary-100 text-secondary-700 border-secondary-300', implicite: 'bg-white text-secondary-600 border-secondary-200', provisoire: 'bg-primary-50 text-primary-800 border-primary-300' };
// Niveau d'une alerte → mot + ton de statut (jamais le cuivre, réservé à l'action) + icône.
const NIVEAU = { ok: ['Conforme', 'ok', CheckCircle2], warn: ['À vérifier', 'attente', AlertTriangle], info: ['Info', 'info', Info], verifier: ['Sur place', 'neutre', ClipboardCheck] };

export function Alertes({ alertes }) {
  return (
    <div className="space-y-2">
      {alertes.map((a, i) => {
        const [tag, ton, Icon] = NIVEAU[a.niveau] || NIVEAU.info;
        return (
          <div key={`${a.code}-${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5 text-body-sm text-secondary-800">
            <StatusPill tone={ton} taille="compacte" icone={<Icon className="w-3.5 h-3.5" aria-hidden="true" />} className="shrink-0 mt-0.5">{tag}</StatusPill>
            <span className="min-w-0 flex-1">{a.message}{a.source ? <span className="block text-caption text-secondary-600">{a.source}</span> : null}</span>
          </div>
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
          {/* Lignes de hauteur fixe (une seule ligne de texte, précision en gris à la suite) : la liste se lit d'un coup. */}
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-secondary-100 h-11">
              <td className="pr-2 align-middle"><span className="inline-grid place-items-center w-6 h-6 rounded-full bg-primary-400 text-secondary-900 font-bold border border-secondary-900 text-xs">{l.repere}</span></td>
              <td className="pr-2 align-middle max-w-0" title={[l.libelle, l.sous_libelle].filter(Boolean).join(' — ')}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{l.libelle}</span>
                  <span className={`shrink-0 inline-block border rounded px-1.5 text-[11px] uppercase font-mono ${STATUT[l.statut] || STATUT.implicite}`}>{l.statut}</span>
                  {l.sous_libelle && <span className="shrink-0 max-w-[38%] truncate text-xs text-secondary-500">· {l.sous_libelle}</span>}
                </div>
              </td>
              <td className="pr-2 align-middle font-mono text-xs text-secondary-600 whitespace-nowrap">{l.reference || '—'}</td>
              <td className="pr-2 align-middle text-right font-mono">{l.quantite}</td>
              <td className="pr-2 align-middle text-right font-mono whitespace-nowrap">{l.prix_vente_ht != null ? formatEuro(l.prix_vente_ht) : '—'}</td>
              <td className="pr-2 align-middle text-right font-mono text-secondary-500 whitespace-nowrap">{l.prix_achat_ht != null ? formatEuro(l.prix_achat_ht) : '—'}</td>
              <td className="align-middle text-right font-mono whitespace-nowrap">{l.prix_vente_ht != null ? formatEuro(l.prix_vente_ht * l.quantite) : <span className="text-primary-800">à chiffrer</span>}</td>
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
