// src/apps/artisan/pages/settings/catalogue/ProposalRow.jsx
// Une proposition de fusion : deux articles Majord'home côte à côte (libellé, marque, catégorie, offres, meilleur prix
// d'achat), l'écart de prix, le motif ; « Fusionner » (survivant = le plus ancien) / « garder l'autre » / « Refuser ».
import { Loader2, GitMerge, XCircle } from 'lucide-react';
import { formatEuro } from '@/lib/utils';
import { formatDateShortFR } from '@/lib/utils';

const SOURCE_LABELS = { cle: 'marque + modèle', ean: 'code EAN', ia: 'IA' };
const STATUT_LABELS = { propose: 'à confirmer', fusionne: 'fusionnée', refuse: 'refusée' };

function Cote({ nom, marque, categorie, offres, prix, fournisseurs, image, onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left flex items-start gap-2 hover:bg-secondary-50 rounded p-1">
      {image ? <img src={image} alt="" className="w-10 h-10 object-contain rounded border border-secondary-100 bg-white flex-shrink-0" /> : <div className="w-10 h-10 rounded bg-secondary-100 flex-shrink-0" />}
      <div className="min-w-0">
        <p className="text-sm text-secondary-900 truncate" title={nom}>{nom}</p>
        <p className="text-xs text-secondary-400 truncate">{[marque, categorie].filter(Boolean).join(' · ')}</p>
        <p className="text-xs text-secondary-500 truncate">
          {offres} offre{offres > 1 ? 's' : ''}{fournisseurs?.length ? ` (${fournisseurs.join(', ')})` : ''}{prix != null ? ` · achat ${formatEuro(prix)}` : ''}
        </p>
      </div>
    </button>
  );
}

/**
 * @param {{ proposal: any, onDecide: (ids: string[], statut: 'fusionne'|'refuse') => Promise<void>,
 *   onMergeKeep: (survivorId: string, absorbedId: string) => Promise<void>, onOpenItem: (id: string) => void, busy?: boolean }} p
 */
export default function ProposalRow({ proposal: p, onDecide, onMergeKeep, onOpenItem, busy = false }) {
  const enAttente = p.statut === 'propose';
  return (
    <div className="rounded-lg border border-secondary-200 bg-white p-3 space-y-2">
      <div className="flex items-stretch gap-3">
        <Cote nom={p.item_a_name} marque={p.item_a_brand} categorie={p.item_a_category} offres={p.item_a_offres} prix={p.item_a_prix} fournisseurs={p.item_a_fournisseurs} image={p.item_a_image_url} onOpen={() => onOpenItem(p.item_a_id)} />
        <div className="flex flex-col items-center justify-center text-xs text-secondary-400 w-20 flex-shrink-0">
          <GitMerge className="w-4 h-4 mb-1" />
          {p.ecart_pct != null && <span className={Math.abs(p.ecart_pct) > 30 ? 'text-amber-700' : ''}>{p.ecart_pct > 0 ? '+' : ''}{p.ecart_pct} %</span>}
        </div>
        <Cote nom={p.item_b_name} marque={p.item_b_brand} categorie={p.item_b_category} offres={p.item_b_offres} prix={p.item_b_prix} fournisseurs={p.item_b_fournisseurs} image={p.item_b_image_url} onOpen={() => onOpenItem(p.item_b_id)} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-secondary-500">
        <span>{SOURCE_LABELS[p.source] || p.source}{p.motif ? ` · ${p.motif}` : ''}</span>
        <span>· {STATUT_LABELS[p.statut] || p.statut}{p.decided_at ? ` le ${formatDateShortFR(p.decided_at)}` : ''}</span>
        {enAttente && (
          <span className="ml-auto flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => onDecide([p.id], 'fusionne')} className="btn-primary btn-sm" title="Fusionner : le plus ancien des deux articles survit">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <GitMerge className="w-3.5 h-3.5 mr-1" />} Fusionner
            </button>
            <button type="button" disabled={busy} onClick={() => onMergeKeep(p.item_b_id, p.item_a_id)} className="text-secondary-500 hover:text-secondary-800 underline" title="Fusionner en gardant l’article de droite">garder le second</button>
            <button type="button" disabled={busy} onClick={() => onDecide([p.id], 'refuse')} className="btn-secondary btn-sm">
              <XCircle className="w-3.5 h-3.5 mr-1" /> Pas le même
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
