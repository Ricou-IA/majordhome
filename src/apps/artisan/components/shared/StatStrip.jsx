/**
 * StatStrip.jsx — bande de chiffres compacte (une ligne de repères, pas de cartes).
 * Présentationnel : chaque repère = libellé, valeur, précision facultative.
 * Partagé par le Dashboard du pipeline et le Suivi MT-LT.
 */

/**
 * @param {Object} props
 * @param {Array<{ key: string, label: string, value: React.ReactNode, sub?: React.ReactNode, title?: string }>} props.items
 * @param {string} [props.columns] classes de grille (nombre de colonnes par largeur d'écran)
 */
export function StatStrip({ items, columns = 'grid-cols-2 md:grid-cols-4' }) {
  return (
    <div className="overflow-hidden rounded-lg border border-secondary-200 bg-white">
      {/* Filets entre repères quel que soit le retour à la ligne : chaque case porte
          son bord droit et bas, le conteneur rogne ceux de la dernière ligne / colonne. */}
      <dl className={`-mb-px -mr-px grid ${columns}`}>
        {items.map((item) => (
          <div key={item.key} className="border-b border-r border-secondary-200 px-4 py-3" title={item.title}>
            <dt className="text-xs font-medium text-secondary-500">{item.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums leading-tight text-secondary-900">{item.value}</dd>
            {item.sub && <dd className="mt-0.5 text-xs text-secondary-500">{item.sub}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

export default StatStrip;
