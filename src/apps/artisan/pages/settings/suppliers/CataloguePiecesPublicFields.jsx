// src/apps/artisan/pages/settings/suppliers/CataloguePiecesPublicFields.jsx
// Réglages d'un catalogue de pièces PUBLIC dans la fiche d'un fournisseur WooCommerce : « Boutique publique » (relevé
// sans identifiants) et « Catalogue de pièces détachées » (proposé seulement si la boutique est publique). L'accord du
// marchand n'est plus saisi : cocher « Boutique publique » et enregistrer vaut confirmation (écrite par la fiche, cf.
// `accordAConfirmer`). Composant présentationnel : l'état vit dans la fiche, les règles dans
// `@/lib/catalogue/reglagesCataloguePublic` (rien n'est décidé ici).
import { libelleAccord } from '@/lib/catalogue/reglagesCataloguePublic';

/**
 * @param {{ form: { public: boolean, cataloguePieces: boolean }, setField: (champ: string, valeur: any) => void, accord?: { contact: string, date: string } | null }} props
 *   `accord` = accord ENREGISTRÉ sur la fiche (affiché, jamais modifié ici)
 */
export default function CataloguePiecesPublicFields({ form, setField, accord = null }) {
  const accordEnregistre = libelleAccord(accord);

  const basculerPublic = (coche) => {
    setField('public', coche);
    if (!coche) setField('cataloguePieces', false); // l'accord enregistré, lui, est conservé
  };

  return (
    <div className="space-y-3">
      <label htmlFor="fournisseur-boutique-publique" className="flex items-center gap-2 text-sm text-secondary-800">
        <input id="fournisseur-boutique-publique" type="checkbox" checked={form.public} onChange={(e) => basculerPublic(e.target.checked)} />
        Boutique publique (relevé sans identifiants)
      </label>

      {form.public && (
        <div className="ml-6 space-y-3">
          <label htmlFor="fournisseur-catalogue-pieces" className="flex items-center gap-2 text-sm text-secondary-800">
            <input id="fournisseur-catalogue-pieces" type="checkbox" checked={form.cataloguePieces} onChange={(e) => setField('cataloguePieces', e.target.checked)} />
            Catalogue de pièces détachées
          </label>
          {!form.cataloguePieces && (
            <p className="text-xs text-secondary-500">Sans « Catalogue de pièces détachées », la boutique n&apos;est pas relevée sans identifiants : cochez-la pour activer le relevé public.</p>
          )}
          <p className="text-xs text-secondary-500">
            {accordEnregistre || 'En enregistrant, vous confirmez que ce fournisseur est d\'accord pour que son catalogue soit relevé.'}
          </p>
        </div>
      )}
    </div>
  );
}
