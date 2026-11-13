/**
 * NomenclatureTable.jsx — Liste des pièces d'un modèle fabricant : recherche + tableau + choix (+ / −)
 * ============================================================================
 * Sortie d'`EquipmentPartsSection` pour servir au bloc normal ET à la colonne « liste » du mode atelier.
 * Repère · référence · désignation (mentions) · quantité · prix public HT, et une colonne de choix quand la
 * sélection est active. La recherche est tenue par le parent (elle survit au passage en atelier).
 * Règles (filtre, mentions, prix) : src/lib/catalogue/nomenclature.js (pur, testé). Aucun calcul ici.
 * ============================================================================
 */

import { useMemo } from 'react';
import { Search, AlertTriangle, Minus, Plus } from 'lucide-react';
import { chercherDansNomenclature, trierParRepere, mentionsPiece, prixPublicPiece } from '@/lib/catalogue/nomenclature';
import { formatEuro } from '@/lib/utils';

function Mentions({ ligne }) {
  const mentions = mentionsPiece(ligne);
  if (!mentions.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 ml-1.5 align-middle">
      {mentions.map((m) => (
        <span key={m.cle} className={`inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full ${m.ton === 'alerte' ? 'bg-amber-100 text-amber-900' : 'bg-secondary-100 text-secondary-600'}`}>
          {m.ton === 'alerte' && <AlertTriangle className="w-3 h-3" />}{m.texte}
        </span>
      ))}
    </span>
  );
}

/**
 * @param {object} p
 * @param {object[]} p.parts lignes de nomenclature du modèle
 * @param {boolean} [p.chargement] pièces en cours de chargement
 * @param {string} p.recherche texte de recherche (repère, référence ou mot)
 * @param {(texte: string) => void} p.onRecherche
 * @param {{ [ligneId: string]: number }} [p.quantites] quantités choisies par ligne
 * @param {(ligne: object, quantite: number) => void} [p.onRegler] + / − sur une ligne
 * @param {boolean} [p.avecSelection] affiche la colonne de choix
 * @param {string} [p.libelleSelection] en-tête de la colonne de choix
 * @param {boolean} [p.lectureSeule] + / − désactivés, quantités affichées
 */
export default function NomenclatureTable({
  parts, chargement = false, recherche, onRecherche, quantites = {}, onRegler = null,
  avecSelection = false, libelleSelection = 'Pour le devis', lectureSeule = false,
}) {
  const lignes = useMemo(() => chercherDansNomenclature(trierParRepere(parts), recherche), [parts, recherche]);

  return (
    <>
      {/* Filtre par repère */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary-400" />
          <input
            type="text" value={recherche} onChange={(e) => onRecherche(e.target.value)}
            placeholder="Repère, référence ou mot"
            aria-label="Repère, référence ou mot de la désignation"
            className="pl-8 pr-3 py-1.5 w-64 max-w-full border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <span className="text-xs text-secondary-500">
          {chargement ? 'Chargement des pièces…' : recherche.trim() ? `${lignes.length} ligne${lignes.length > 1 ? 's' : ''} sur ${parts.length}` : `${parts.length} ligne${parts.length > 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Tableau */}
      {!chargement && parts.length > 0 && (
        <div className="overflow-x-auto -mx-1">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-secondary-500 border-b border-secondary-200">
                <th className="px-1 py-1.5 font-medium w-14">Repère</th>
                <th className="px-1 py-1.5 font-medium w-28">Référence</th>
                <th className="px-1 py-1.5 font-medium">Désignation</th>
                <th className="px-1 py-1.5 font-medium text-right w-12">Qté</th>
                <th className="px-1 py-1.5 font-medium text-right w-28">Prix public HT</th>
                {avecSelection && <th className="px-1 py-1.5 font-medium text-right w-28">{libelleSelection}</th>}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const prix = prixPublicPiece(l);
                const q = quantites[l.id] || 0;
                return (
                  <tr key={l.id} className={`border-b border-secondary-100 ${q > 0 ? 'bg-primary-50/60' : ''}`}>
                    <td className="px-1 py-1.5 tabular-nums text-secondary-700">{l.repere || '—'}</td>
                    <td className="px-1 py-1.5 font-mono text-xs text-secondary-800 whitespace-nowrap">{l.piece_reference}</td>
                    <td className="px-1 py-1.5 text-secondary-900">
                      {l.piece_name}
                      {l.notes ? <span className="text-secondary-500"> {l.notes}</span> : null}
                      <Mentions ligne={l} />
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-secondary-700">{Number(l.quantity) || 1}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-secondary-900 whitespace-nowrap">{prix != null ? formatEuro(prix) : <span className="text-secondary-400">non communiqué</span>}</td>
                    {avecSelection && (
                      <td className="px-1 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => onRegler?.(l, q - 1)} disabled={lectureSeule || q === 0} aria-label={`Retirer ${l.piece_reference}`} className="w-6 h-6 rounded-full border border-secondary-300 flex items-center justify-center hover:bg-secondary-100 disabled:opacity-30"><Minus className="w-3 h-3" /></button>
                          <span className="w-5 text-center tabular-nums text-sm">{q}</span>
                          <button type="button" onClick={() => onRegler?.(l, q + 1)} disabled={lectureSeule} aria-label={`Ajouter ${l.piece_reference}`} className="w-6 h-6 rounded-full border border-secondary-300 flex items-center justify-center hover:bg-secondary-100 disabled:opacity-30"><Plus className="w-3 h-3" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lignes.length === 0 && <p className="px-1 py-3 text-sm text-secondary-500">Aucune pièce ne correspond à « {recherche} » sur ce modèle.</p>}
        </div>
      )}
    </>
  );
}
