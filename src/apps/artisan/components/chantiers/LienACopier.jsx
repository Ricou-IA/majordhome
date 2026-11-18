/**
 * LienACopier.jsx - Majord'home Artisan
 * ============================================================================
 * Lien du PV affiché quand le presse-papiers a refusé l'écriture : l'action a réussi côté
 * serveur (lien rendu, demande notée), seule la copie automatique a échoué. Le lien est
 * présenté dans un champ en lecture seule, sélectionné d'un clic, pour le copier à la main.
 * ============================================================================
 */

export function LienACopier({ url, id }) {
  if (!url) return null;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs text-gray-600">
        Lien à copier à la main (sélectionnez-le, puis copiez) :
      </label>
      <input
        id={id}
        type="text"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.target.select()}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-800"
      />
    </div>
  );
}

export default LienACopier;
