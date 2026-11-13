// src/apps/artisan/pages/settings/suppliers/CataloguePiecesPublicFields.jsx
// Réglages d'un catalogue de pièces PUBLIC dans la fiche d'un fournisseur WooCommerce : « Boutique publique » (relevé
// sans identifiants), « Catalogue de pièces détachées » (proposé seulement si la boutique est publique) et l'accord du
// marchand (contact + date). Composant présentationnel : l'état vit dans la fiche, les règles dans
// `@/lib/catalogue/reglagesCataloguePublic` (rien n'est décidé ici).
import { inputClass } from '../../../components/FormFields';
import { etatAccord } from '@/lib/catalogue/reglagesCataloguePublic';

const MESSAGE_DATE = {
  futur: 'La date de l\'accord ne peut pas être dans le futur.',
  invalide: 'La date de l\'accord n\'existe pas au calendrier.',
};

/**
 * @param {{ form: { public: boolean, cataloguePieces: boolean, accordContact: string, accordDate: string }, setField: (champ: string, valeur: any) => void }} props
 */
export default function CataloguePiecesPublicFields({ form, setField }) {
  const etat = etatAccord({ contact: form.accordContact, date: form.accordDate });
  const messageDate = MESSAGE_DATE[etat] || null;

  const basculerPublic = (coche) => {
    setField('public', coche);
    if (!coche) setField('cataloguePieces', false); // l'accord saisi, lui, est conservé
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="fournisseur-accord-contact" className="block text-sm font-medium text-secondary-700">Accord du fournisseur — contact</label>
              <input id="fournisseur-accord-contact" type="text" value={form.accordContact} autoComplete="off"
                onChange={(e) => setField('accordContact', e.target.value)} className={inputClass} placeholder="Nom de la personne qui a donné l'accord" />
            </div>
            <div className="space-y-1">
              <label htmlFor="fournisseur-accord-date" className="block text-sm font-medium text-secondary-700">Accord du fournisseur — date</label>
              <input id="fournisseur-accord-date" type="date" value={form.accordDate} autoComplete="off"
                aria-invalid={messageDate ? 'true' : undefined} aria-describedby={messageDate ? 'fournisseur-accord-date-erreur' : undefined}
                onChange={(e) => setField('accordDate', e.target.value)} className={inputClass} />
              {messageDate && <p id="fournisseur-accord-date-erreur" className="text-xs text-amber-700 font-medium">{messageDate}</p>}
            </div>
          </div>
          <p className="text-xs text-secondary-500">Le relevé n&apos;a lieu qu&apos;avec l&apos;accord du fournisseur. Notez ici qui l&apos;a donné et quand.</p>
        </div>
      )}
    </div>
  );
}
