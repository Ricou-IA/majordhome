/**
 * EtapeApercu.jsx - Import d'articles, étape 3
 * Ce qui sera importé, les fournisseurs du fichier, les valeurs à interpréter, les doublons (repris ou écartés au
 * choix) et les lignes écartées, avant toute écriture. « Importer » reste fermé tant que la liste des articles
 * existants (ou des fournisseurs) est inconnue, qu'une erreur de correspondance reste ou que rien n'est à importer.
 */

import { useMemo } from 'react';
import { ArrowLeft, Download, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LignesSquelette, Squelette } from '@/components/ui/squelette';
import { aImporter } from '@/lib/importArticles/controles';
import {
  phraseBilanArticles, texteCorrectionsArticles, texteDateDuPrix,
} from '@/lib/importArticles/libelles';
import { Encadre } from './Encadres';
import {
  FournisseursDuFichier, ValeursAInterpreter, ListePretes, ListeDoublons, ListeEcartees,
} from './ApercuSections';

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

function Compteur({ libelle, valeur }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-2xl font-semibold text-secondary-900">{valeur}</p>
      <p className="text-sm text-secondary-600">{libelle}</p>
    </Card>
  );
}

function CompteursEnAttente() {
  return (
    <div role="status" aria-label="Lecture de vos articles existants" className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {Array.from({ length: 5 }, (_, i) => (
        <Card key={i} className="px-4 py-3 space-y-2">
          <Squelette className="h-7 w-12" />
          <Squelette className="h-4 w-24" />
        </Card>
      ))}
    </div>
  );
}

/** Pourquoi des articles importés n'auront pas de ligne fournisseur. */
function phrasesSansLigne(s) {
  const phrases = [];
  if (s.sans_prix) phrases.push(`${pluriel(s.sans_prix, 'article', 'articles')} sans prix d'achat : pas de ligne fournisseur.`);
  if (s.sans_reference) phrases.push(`${pluriel(s.sans_reference, 'article', 'articles')} sans référence fournisseur : pas de ligne fournisseur.`);
  if (s.sans_fournisseur) phrases.push(`${pluriel(s.sans_fournisseur, 'article', 'articles')} sans fournisseur : pas de ligne fournisseur.`);
  if (s.non_creee) phrases.push(`${pluriel(s.non_creee, 'article', 'articles')} d'un fournisseur que vous ne créez pas : importés sans ligne fournisseur.`);
  if (s.existante) phrases.push(`${pluriel(s.existante, 'article repris', 'articles repris')} malgré une ligne fournisseur existante : importés sans ligne fournisseur.`);
  return phrases;
}

export default function EtapeApercu({
  apercu, fournisseurs, fournisseursOrg, existants, valeurs, choix, validation, enCours, avis,
  onRelire, onValeur, onCreation, onBasculer, onTousLesDoublons, onTelechargerEcartees, onRetour, onLancer, peutLancer,
}) {
  const groupes = useMemo(() => {
    if (!apercu) return null;
    return {
      pretes: apercu.classees.filter((l) => l.fiche && !l.doublon),
      doublons: apercu.classees.filter((l) => l.fiche && l.doublon),
      ecartees: apercu.classees.filter((l) => !l.fiche),
    };
  }, [apercu]);
  const nonImportees = useMemo(
    () => (apercu ? apercu.classees.some((l) => !aImporter(l, choix)) : false),
    [apercu, choix],
  );

  const bilan = apercu?.bilan;
  const corrections = apercu ? texteCorrectionsArticles(apercu.corrections) : null;
  const sansDate = apercu ? texteDateDuPrix(apercu.sansDate) : null;
  const sansLigne = apercu ? phrasesSansLigne(apercu.sansLigne) : [];
  const n = bilan?.importees ?? 0;

  // Fournisseurs de l'entreprise en échec (le fichier en nomme) : rien ne peut être rapproché, import fermé.
  const fournisseursEnErreur = fournisseurs === undefined && !!fournisseursOrg.error;
  // Une relecture en cours prime sur l'erreur précédente (react-query la garde pendant la relecture).
  const existantsEnErreur = !apercu && !fournisseursEnErreur && !existants.isLoading && !!existants.error;

  return (
    <div className="space-y-6">
      {avis && <Encadre ton="attention" role="status">{avis}</Encadre>}
      {fournisseursEnErreur && (
        <Encadre ton="alerte" role="alert">
          Vos fournisseurs n&apos;ont pas pu être lus : l&apos;import est fermé. Rechargez la page pour réessayer.
        </Encadre>
      )}
      {existantsEnErreur && (
        <Encadre
          ton="alerte"
          role="alert"
          action={(
            <Button type="button" variant="secondary" size="sm" onClick={onRelire}>
              <RefreshCw aria-hidden="true" />
              Réessayer
            </Button>
          )}
        >
          Vos articles existants n&apos;ont pas pu être lus : l&apos;import est fermé pour ne pas créer de doublons.
        </Encadre>
      )}
      {!apercu && !fournisseursEnErreur && !existantsEnErreur && (
        <>
          <CompteursEnAttente />
          <LignesSquelette nombre={4} libelle="Comparaison avec vos articles existants" />
        </>
      )}

      {apercu && groupes && (
        <>
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Compteur libelle="lignes lues" valeur={bilan.lues} />
              <Compteur libelle="articles à importer" valeur={bilan.importees} />
              <Compteur libelle="lignes fournisseur" valeur={bilan.lignesFournisseur} />
              <Compteur libelle="doublons écartés" valeur={bilan.doublons} />
              <Compteur libelle="écartées" valeur={bilan.ecartees} />
            </div>
            <p className="text-sm text-secondary-700">{phraseBilanArticles(bilan)}</p>
            <Encadre>Les prix du fichier sont lus hors taxe : un prix TTC n&apos;est jamais converti.</Encadre>
            {corrections && <Encadre>{corrections}</Encadre>}
            {sansDate && <Encadre>{sansDate}</Encadre>}
            {sansLigne.length > 0 && <Encadre>{sansLigne.join(' ')}</Encadre>}
          </div>

          <FournisseursDuFichier fournisseurs={fournisseurs} enCours={enCours} onCreation={onCreation} />
          <ValeursAInterpreter valeurs={valeurs} enCours={enCours} onValeur={onValeur} />

          <div className="space-y-3">
            <ListePretes lignes={groupes.pretes} />
            <ListeDoublons
              lignes={groupes.doublons}
              choix={choix}
              enCours={enCours}
              onBasculer={(l) => onBasculer(l, choix)}
              onTous={(reprendre) => onTousLesDoublons(apercu.classees, reprendre)}
            />
            <ListeEcartees lignes={groupes.ecartees} />
          </div>

          {nonImportees && (
            <Button type="button" variant="link" onClick={onTelechargerEcartees} className="px-0">
              <Download aria-hidden="true" />
              Télécharger les lignes écartées
            </Button>
          )}
        </>
      )}

      {validation.erreurs.length > 0 && (
        <div role="alert" className="space-y-2">
          {validation.erreurs.map((e) => <Encadre key={e} ton="alerte">{e}</Encadre>)}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="secondary" onClick={onRetour}>
          <ArrowLeft aria-hidden="true" />
          Revoir les colonnes
        </Button>
        <Button type="button" onClick={onLancer} disabled={!peutLancer || enCours}>
          <Upload aria-hidden="true" />
          {bilan ? `Importer ${pluriel(n, 'article', 'articles')}` : 'Importer'}
        </Button>
      </div>
    </div>
  );
}
