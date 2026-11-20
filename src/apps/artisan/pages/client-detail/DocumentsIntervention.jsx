/**
 * DocumentsIntervention.jsx — les documents d'un chantier ou d'une carte Entretien / SAV,
 * dans l'onglet Interventions de la fiche client.
 * ============================================================================
 * On ne montre que ce qui EXISTE : PV de réception signé, PV de levée des réserves,
 * certificat d'entretien avec son PDF, attestation de ramonage, rapport d'intervention SAV.
 * Ce qui existe est décidé par `src/lib/documentsIntervention.js` (pur, testé) ; ce fichier
 * ne fait qu'afficher et ouvrir.
 * ============================================================================
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2 } from 'lucide-react';
import { storageService } from '@services/storage.service';
import { AttestationLink } from '@/apps/artisan/components/certificat/AttestationLink';
import { useOuvrirPv } from '@/apps/artisan/components/chantiers/useOuvrirPv';
import { documentsDeChantier, documentsDeCarte, receptionneSansPv } from '@/lib/documentsIntervention';
import { formatDateShortFR } from '@/lib/utils';

const BOUTON = 'inline-flex items-center gap-1.5 min-h-[32px] px-2.5 py-1.5 text-xs font-medium rounded-md border border-secondary-300 bg-white text-secondary-800 hover:bg-secondary-50 disabled:opacity-60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

function BoutonDocument({ libelle, onClick, enCours }) {
  return (
    <button type="button" onClick={onClick} disabled={enCours} className={BOUTON}>
      {enCours
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        : <FileText className="w-3.5 h-3.5" aria-hidden="true" />}
      {libelle}
    </button>
  );
}

/** Ce que l'on sait de la signature d'un PV, en une phrase. */
function detailDuPv(doc) {
  if (doc.cle === 'pv_levee') return doc.signeLe ? `Réserves levées le ${formatDateShortFR(doc.signeLe)}` : null;
  if (!doc.enLigne) return 'Signé sur place';
  return `Signé en ligne le ${formatDateShortFR(doc.signeLe)}, ${doc.avecReserves ? 'avec réserves' : 'sans réserve'}`;
}

/**
 * PV de réception et PV de levée d'un chantier. Un chantier réceptionné sans aucun PV le dit.
 * @param {{ chantier: Object, onUpdated?: () => void }} props `onUpdated` : le PDF vient d'être produit et archivé
 */
export function DocumentsChantier({ chantier, onUpdated }) {
  const { ouvrirPv, ouvrirLevee, enCours } = useOuvrirPv({ onUpdated });
  const documents = documentsDeChantier(chantier);

  if (documents.length === 0) {
    return receptionneSansPv(chantier)
      ? <p className="text-xs text-secondary-600">Réception validée sans PV signé.</p>
      : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-amber-200 pt-3">
      {documents.map((doc) => {
        const detail = detailDuPv(doc);
        return (
          <div key={doc.cle} className="flex flex-wrap items-center gap-2">
            <BoutonDocument
              libelle={doc.libelle} enCours={enCours}
              onClick={() => (doc.cle === 'pv_levee' ? ouvrirLevee(chantier) : ouvrirPv(chantier))}
            />
            {detail && <span className="text-xs text-secondary-600">{detail}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Documents d'une carte Entretien / SAV : certificat, attestation de ramonage, rapport SAV.
 * Ne rend rien s'il n'y en a aucun.
 * @param {{ intervention: Object, certificat?: Object|null }} props
 */
export function DocumentsCarte({ intervention, certificat }) {
  const [ouverture, setOuverture] = useState(null);
  const documents = documentsDeCarte(intervention, certificat);
  if (documents.length === 0) return null;

  // Fenêtre ouverte AVANT l'appel : après une attente, le navigateur la bloquerait.
  const ouvrir = async (doc) => {
    const fenetre = window.open('', '_blank');
    setOuverture(doc.cle);
    const { url, error } = await storageService.getSignedUrl(doc.depot, doc.chemin);
    setOuverture(null);
    if (error || !url) {
      fenetre?.close();
      toast.error(`${doc.libelle} introuvable`);
      return;
    }
    if (fenetre) fenetre.location.href = url; else window.location.href = url;
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-secondary-100 px-4 py-2.5">
      {documents.map((doc) => (
        <BoutonDocument key={doc.cle} libelle={doc.libelle} enCours={ouverture === doc.cle} onClick={() => ouvrir(doc)} />
      ))}
      {/* L'attestation est rangée à côté du certificat : son lien ne s'affiche que si elle existe. */}
      {documents.some((d) => d.cle === 'certificat') && (
        <AttestationLink interventionId={intervention.id} label="Attestation de ramonage" className={BOUTON} />
      )}
    </div>
  );
}
