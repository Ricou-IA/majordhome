/**
 * PiecesCatalogueBloc.jsx — « Dans les catalogues de vos fournisseurs » (fenêtre « Trouver une pièce »)
 * ============================================================================
 * Les pièces dont la fiche du marchand CITE le modèle de l'appareil, puis, repliées, celles de la même marque dont
 * la fiche ne le cite pas. Lecture seule, sans clic ni coût : la recherche web par l'agent reste un choix, en
 * dessous. Le champ de saisie de la fenêtre filtre ce bloc au fil de la frappe, sans nouvel appel réseau. Une saisie qui
 * ne retient rien ne dit jamais « rien » : le bloc écrit combien de pièces existent sans filtre et les montre sur clic.
 *
 * Tout texte du marchand (désignation, référence, rayons, fournisseur) est affiché en nœud texte, jamais en HTML ; un
 * lien n'est rendu que si `lienSur` l'accepte (https). La date du relevé accompagne toujours prix et stock. Aucune
 * couleur ne porte seule l'information (stock écrit en toutes lettres).
 * Spec : docs/superpowers/specs/2026-11-12-base-pieces-catalogues-marchands-design.md § 3
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { usePiecesCatalogue } from '@hooks/usePiecesCatalogue';
import { classerPieces } from '@/lib/catalogue/recherchePieces';
import { libelleDateReleve, messageSaisieSansResultat } from '@/lib/catalogue/piecesAffichage';
import { lienSur } from '@/lib/assistantPieces';
import { LIMITE_LECTURE } from '@services/piecesCatalogue.service';
import { formatEuro } from '@/lib/utils';
import { logger } from '@lib/logger';

/** Au plus ce nombre de lignes par groupe : au-delà, on invite à préciser la recherche (pas de pagination). */
export const LIGNES_MAX = 50;

const MESSAGES_MOTIF = {
  modele_absent: 'Modèle non renseigné : recherche par marque seulement.',
  modele_generique: 'Le nom du modèle est trop court pour distinguer les pièces.',
  marque_absente: 'Aucun catalogue relevé ne couvre cette marque.',
};

/** La liste lue est limitée : on le dit, et on dit si les pièces qui citent le modèle ont pu être cherchées à part. */
function messageTroncature(aMotModele, ciblee) {
  const base = `Marque très fournie : la liste est limitée à ${LIMITE_LECTURE} pièces.`;
  if (!aMotModele) return `${base} Renseignez le modèle de l’appareil pour retrouver les pièces qui le citent.`;
  if (ciblee) return `${base} Les pièces qui citent le modèle ont été cherchées à part.`;
  return `${base} La recherche à part des pièces qui citent le modèle n’a pas abouti ou est elle-même limitée : la liste peut être incomplète.`;
}

function Ligne({ piece, citee }) {
  const lien = lienSur(piece.fiche_url);
  const date = libelleDateReleve(piece.releve_at);
  const prix = typeof piece.prix_public_ttc === 'number' && Number.isFinite(piece.prix_public_ttc)
    ? `${formatEuro(piece.prix_public_ttc)} TTC` : 'prix non communiqué';
  const stock = piece.en_stock === true ? 'en stock' : piece.en_stock === false ? 'en rupture' : 'stock non communiqué';
  return (
    <li className="px-3 py-2 text-sm text-secondary-800">
      <p className="font-medium text-secondary-900 break-words">{piece.name || '—'}</p>
      <p className="text-xs text-secondary-600 break-words">
        <span className="font-mono">réf. {piece.reference || '—'}</span> · {piece.supplier_name || 'fournisseur inconnu'}
        {citee && <> · <span className="font-medium text-secondary-800">cité pour ce modèle</span></>}
      </p>
      <p className="text-xs text-secondary-700 mt-0.5">
        <span className="font-medium">{prix}</span> · <span className="font-medium">{stock}</span>
        {' '}{date}
        {lien && (
          <>
            {' · '}
            <a href={lien.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-700 hover:underline">
              voir la fiche ({lien.domaine})<ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          </>
        )}
      </p>
    </li>
  );
}

function Liste({ pieces, citee }) {
  const montrees = pieces.slice(0, LIGNES_MAX);
  const reste = pieces.length - montrees.length;
  return (
    <>
      <ul className="border border-secondary-200 rounded-lg divide-y divide-secondary-100">
        {montrees.map((p) => <Ligne key={p.id} piece={p} citee={citee} />)}
      </ul>
      {reste > 0 && <p className="text-xs text-secondary-600 mt-1">et {reste} autre{reste > 1 ? 's' : ''} — précisez la recherche</p>}
    </>
  );
}

/**
 * @param {{ equipment: { brand?: string|null, model?: string|null }, saisie?: string,
 *   onCompte?: (n: number|null) => void }} p  `onCompte(n)` (référence stable : appelée à chaque changement de n) : pièces « citées »
 *   pour ce modèle AVANT le filtre par la saisie (`total.citees`), `null` pendant le chargement, en erreur ou sans marque.
 */
export default function PiecesCatalogueBloc({ equipment, saisie = '', onCompte }) {
  const { lignes, tronque, ciblee, aMotModele, isLoading, error, aMarque } = usePiecesCatalogue(equipment);
  const marque = equipment?.brand ?? '';
  const modele = equipment?.model ?? '';

  useEffect(() => {
    if (error) logger.error('[PiecesCatalogueBloc] catalogues illisibles', error);
  }, [error]);

  // Saisie pour laquelle « Tout afficher » a été cliqué : une saisie modifiée remet le filtre en route.
  const [toutPour, setToutPour] = useState(null);
  const toutAfficher = toutPour !== null && toutPour === saisie;

  // `lignes` vient de React Query : mêmes objets d'un rendu à l'autre (le classement garde un index par ligne).
  const classement = useMemo(
    () => (aMarque && lignes ? classerPieces({ marque, modele, saisie }, lignes) : { citees: [], memeMarque: [], motif: 'marque_absente', total: { citees: 0, memeMarque: 0 } }),
    [aMarque, lignes, marque, modele, saisie],
  );
  const { motif, total } = classement;
  // Sans filtre (« Tout afficher ») : mêmes lignes, même index, saisie ignorée.
  const affiche = useMemo(
    () => (toutAfficher && aMarque && lignes ? classerPieces({ marque, modele, saisie: '' }, lignes) : classement),
    [toutAfficher, aMarque, lignes, marque, modele, classement],
  );
  const { citees, memeMarque } = affiche;

  // null tant que la lecture n'a pas abouti (chargement, erreur, marque inexploitable) : rien n'a été « vu ».
  // Compté AVANT le filtre par la saisie : une demande rédigée ne doit pas faire croire que la base est vide.
  const nbCitees = !aMarque || error || isLoading ? null : total.citees;
  useEffect(() => { onCompte?.(nbCitees); }, [nbCitees, onCompte]);

  let corps;
  if (!aMarque) {
    corps = <p className="text-sm text-secondary-700">{MESSAGES_MOTIF.marque_absente}</p>;
  } else if (isLoading) {
    corps = (
      <p className="flex items-center gap-2 text-sm text-secondary-600" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Chargement des catalogues…
      </p>
    );
  } else if (error) {
    corps = <p className="text-sm text-secondary-700">Catalogues indisponibles pour le moment.</p>;
  } else {
    const vide = citees.length === 0 && memeMarque.length === 0;
    const catalogueVide = total.citees + total.memeMarque === 0;
    const saisieSansResultat = vide && !catalogueVide;
    corps = (
      <div className="space-y-3">
        {tronque && <p className="text-sm text-secondary-700">{messageTroncature(aMotModele, ciblee)}</p>}
        {motif && <p className="text-sm text-secondary-700">{MESSAGES_MOTIF[motif]}</p>}
        {vide && catalogueVide && motif !== 'marque_absente' && <p className="text-sm text-secondary-700">Rien dans les catalogues relevés.</p>}
        {saisieSansResultat && (
          <p className="text-sm text-secondary-700">
            {messageSaisieSansResultat(total)}{' '}
            <button
              type="button" onClick={() => setToutPour(saisie)}
              className="font-medium text-primary-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
            >
              Tout afficher
            </button>
          </p>
        )}
        {!saisieSansResultat && (citees.length > 0 || (motif === null && memeMarque.length > 0)) && (
          <div>
            <h5 className="text-xs font-semibold text-secondary-900 mb-1">Cité pour ce modèle ({citees.length})</h5>
            {citees.length > 0
              ? <Liste pieces={citees} citee />
              : <p className="text-sm text-secondary-700">{total.citees > 0 ? 'Aucune pièce citée ne correspond à cette saisie.' : 'Aucune pièce ne cite ce modèle.'}</p>}
          </div>
        )}
        {memeMarque.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-secondary-900 mb-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
              Même marque, modèle non cité ({memeMarque.length})
            </summary>
            <div className="mt-1"><Liste pieces={memeMarque} citee={false} /></div>
          </details>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Dans les catalogues de vos fournisseurs" className="space-y-1.5">
      <h4 className="text-sm font-semibold text-secondary-900">Dans les catalogues de vos fournisseurs</h4>
      <p className="text-xs text-secondary-600">Tapez un mot (bougie, vis, sonde…) pour filtrer la liste.</p>
      {corps}
    </section>
  );
}
