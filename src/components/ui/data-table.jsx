import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@lib/utils';

/**
 * Tableau de données (DA § 7 « Tableau ») : en-tête 40 px sur fond pierre clair, lignes de
 * 56 px, survol léger, ligne entière cliquable et atteignable au clavier, tri visible sur les
 * colonnes triables (colonne triée en foncé, flèche cuivre). Affichage seul : le tri et la
 * pagination sont décidés par l'appelant (`tri`, `onTri`).
 *
 * @param {Object} props
 * @param {Array<{ cle: string, titre: React.ReactNode, rendu: (ligne: any) => React.ReactNode,
 *   triable?: boolean, alignement?: 'gauche'|'droite', largeur?: string, classe?: string }>} props.colonnes
 * @param {Array<any>} props.lignes
 * @param {(ligne: any) => string} props.cleLigne
 * @param {{ cle: string, ascendant: boolean }} [props.tri]
 * @param {(cle: string) => void} [props.onTri]
 * @param {(ligne: any) => void} [props.onLigne]   clic ou Entrée sur une ligne
 * @param {(ligne: any) => string} [props.libelleLigne]  nom lu par un lecteur d'écran
 * @param {boolean} [props.chargement]  premier chargement : lignes squelettes
 * @param {React.ReactNode} [props.pied]
 * @param {string} [props.libelle]       légende du tableau (accessibilité)
 */
export function DataTable({
  colonnes, lignes, cleLigne, tri, onTri, onLigne, libelleLigne, chargement = false, pied, libelle, className,
}) {
  const aDroite = (col) => col.alignement === 'droite';

  return (
    <div className={cn('overflow-hidden rounded-2xl border border-secondary-200 bg-white shadow-sm', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          {libelle && <caption className="sr-only">{libelle}</caption>}
          <thead className="bg-secondary-25">
            <tr className="h-10 border-b border-secondary-200">
              {colonnes.map((col) => {
                const triee = tri?.cle === col.cle;
                const sens = triee ? (tri.ascendant ? 'ascending' : 'descending') : 'none';
                return (
                  <th
                    key={col.cle}
                    scope="col"
                    aria-sort={col.triable ? sens : undefined}
                    style={col.largeur ? { width: col.largeur } : undefined}
                    className={cn('px-4 text-label font-semibold text-secondary-500', aDroite(col) && 'text-right')}
                  >
                    {col.triable && onTri ? (
                      <button
                        type="button"
                        onClick={() => onTri(col.cle)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md py-1 hover:text-secondary-900 focus-visible:shadow-ring focus-visible:outline-none',
                          triee && 'text-secondary-900',
                          aDroite(col) && 'flex-row-reverse',
                        )}
                      >
                        {col.titre}
                        {triee ? (
                          tri.ascendant
                            ? <ArrowUp className="h-3.5 w-3.5 text-primary-600" aria-hidden="true" />
                            : <ArrowDown className="h-3.5 w-3.5 text-primary-600" aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 text-secondary-300" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      col.titre
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {chargement && lignes.length === 0
              ? Array.from({ length: 8 }, (_, i) => (
                <tr key={`squelette-${i}`} className="h-14 border-b border-secondary-100 last:border-0">
                  {colonnes.map((col) => (
                    <td key={col.cle} className="px-4">
                      <div className="h-3 w-3/4 animate-pulse rounded bg-secondary-100" />
                    </td>
                  ))}
                </tr>
              ))
              : lignes.map((ligne) => (
                <tr
                  key={cleLigne(ligne)}
                  tabIndex={onLigne ? 0 : undefined}
                  aria-label={onLigne && libelleLigne ? libelleLigne(ligne) : undefined}
                  onClick={onLigne ? () => onLigne(ligne) : undefined}
                  onKeyDown={onLigne ? (e) => { if (e.key === 'Enter') onLigne(ligne); } : undefined}
                  className={cn(
                    'h-14 border-b border-secondary-100 text-cell text-secondary-800 last:border-0',
                    onLigne && 'cursor-pointer hover:bg-secondary-50 focus-visible:bg-primary-50 focus-visible:outline-none',
                  )}
                >
                  {colonnes.map((col) => (
                    <td key={col.cle} className={cn('px-4', aDroite(col) && 'text-right tabular-nums', col.classe)}>
                      {col.rendu(ligne)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {pied && (
        <div className="border-t border-secondary-200 bg-secondary-25 px-4 py-3 text-body-sm text-secondary-500">
          {pied}
        </div>
      )}
    </div>
  );
}

export default DataTable;
