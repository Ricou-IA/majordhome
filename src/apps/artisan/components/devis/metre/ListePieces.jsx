// src/apps/artisan/components/devis/metre/ListePieces.jsx
// Liste de pièces chiffrée + contrôles du métré. Rendu pur des sorties de calculerMetre.
import { CheckCircle2, AlertTriangle, Info, ClipboardCheck, Eye, EyeOff } from 'lucide-react';
import { formatEuro } from '@/lib/utils';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { useAfficherMarges } from '@hooks/useAfficherMarges';
import { formatQuantite } from '@/lib/fumisterie/format.js';

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


/** Repère de la coupe : même disque blanc cerclé qu'à l'écran et sur le PDF (le cuivre reste à l'action). */
const Repere = ({ n }) => <span className="inline-grid place-items-center w-6 h-6 rounded-full bg-white border border-secondary-700 text-caption font-bold text-secondary-900 tabular-nums">{n}</span>;

/** Désignation entière (jamais tronquée : on doit savoir quelle pièce on commande), précision et référence dessous. */
function Designation({ l }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-secondary-900">{l.libelle}</p>
      {(l.sous_libelle || l.reference) && (
        <p className="text-caption text-secondary-600">
          {l.sous_libelle}{l.sous_libelle && l.reference ? ' · ' : ''}{l.reference && <span className="font-mono">{l.reference}</span>}
        </p>
      )}
      {l.statut === 'provisoire' && <StatusPill tone="attente" taille="compacte" className="mt-1">Quantité à valider</StatusPill>}
    </div>
  );
}

const totalLigne = (l) => (l.prix_vente_ht != null ? formatEuro(l.prix_vente_ht * l.quantite) : <StatusPill tone="attente" taille="compacte">À chiffrer</StatusPill>);

/**
 * Liste de pièces chiffrée. Prix d'achat et marge masqués par défaut (le métré se fait souvent devant le client) :
 * même interrupteur que l'éditeur de devis (useAfficherMarges, droit `devis · marges`). Tableau sur ordinateur et
 * tablette, cartes empilées sur un écran étroit.
 */
export default function ListePieces({ lignes, totaux }) {
  const marges = useAfficherMarges();
  const sansPrix = totaux.lignes_a_chiffrer || 0;
  return (
    <div>
      {marges.peut && (
        <div className="flex justify-end mb-2">
          <Button type="button" variant="ghost" size="sm" onClick={marges.basculer} aria-pressed={marges.visibles}>
            {marges.visibles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}{marges.visibles ? 'Masquer les marges' : 'Afficher les marges'}
          </Button>
        </div>
      )}
      <table className="w-full text-sm hidden md:table">
        <thead><tr className="text-left text-label text-secondary-700 border-b border-secondary-300">
          <th className="py-2 pr-2 w-10">Rep.</th><th className="py-2 pr-2">Désignation</th><th className="py-2 pr-2 text-right">Qté</th>
          <th className="py-2 pr-2 text-right">PU vente HT</th>{marges.visibles && <th className="py-2 pr-2 text-right">PU achat HT</th>}<th className="py-2 text-right">Total HT</th></tr></thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-secondary-100 align-top">
              <td className="py-2 pr-2"><Repere n={l.repere} /></td>
              <td className="py-2 pr-2"><Designation l={l} /></td>
              <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{formatQuantite(l.quantite, l.unite)}</td>
              <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{l.prix_vente_ht != null ? formatEuro(l.prix_vente_ht) : '—'}</td>
              {marges.visibles && <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap text-secondary-600">{l.prix_achat_ht != null ? formatEuro(l.prix_achat_ht) : '—'}</td>}
              <td className="py-2 text-right tabular-nums whitespace-nowrap">{totalLigne(l)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="md:hidden divide-y divide-secondary-100">
        {lignes.map((l, i) => (
          <li key={i} className="flex gap-3 py-2.5">
            <Repere n={l.repere} />
            <div className="min-w-0 flex-1"><Designation l={l} /><p className="mt-1 text-caption text-secondary-700 tabular-nums">{formatQuantite(l.quantite, l.unite)}{l.prix_vente_ht != null ? ` × ${formatEuro(l.prix_vente_ht)}` : ''}</p></div>
            <div className="text-right tabular-nums whitespace-nowrap">{totalLigne(l)}</div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-secondary-300 pt-2 mt-1">
        <p className="text-sm text-secondary-800">Fournitures fumisterie{sansPrix > 0 && <span className="text-secondary-600"> · dont {sansPrix} pièce{sansPrix > 1 ? 's' : ''} sans prix</span>}</p>
        <p className="text-right">
          {marges.visibles && <span className="mr-3 text-caption text-secondary-600 tabular-nums">achat {formatEuro(totaux.achat_ht)} · marge {formatEuro(totaux.marge_ht)}</span>}
          <span className="text-lg font-semibold text-secondary-900 tabular-nums">{formatEuro(totaux.vente_ht)}</span>
        </p>
      </div>
    </div>
  );
}
