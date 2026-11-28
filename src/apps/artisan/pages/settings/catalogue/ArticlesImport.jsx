/**
 * ArticlesImport.jsx - Majord'home Artisan
 * ============================================================================
 * Import d'une base d'articles depuis un fichier (ancien logiciel, tarif) :
 * fichier, colonnes, aperçu (fournisseurs, valeurs, doublons), envoi, résultat.
 * Réservé à l'administrateur de l'entreprise (écran ET chaque RPC). La page
 * assemble : le parcours est dans useParcoursImportArticles, chaque règle dans
 * src/lib/importArticles/. Spec docs/superpowers/specs/2026-11-28-import-articles-fichier-design.md § 5.
 * ============================================================================
 */

import { useEffect } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@lib/logger';
import { PageHeader } from '@/components/ui/page-header';
import { useExecuterImportArticles } from '@hooks/useCatalogImports';
import { refusFichier } from '@/lib/importClients/lireFichier';
import { aImporter } from '@/lib/importArticles/controles';
import { feuillesFichierTypeArticles, feuilleLignesEcarteesArticles } from '@/lib/importArticles/fichierType';
import { lireFichierDepose, telechargerClasseur } from '@/apps/artisan/components/clients/import/classeur';
import { useParcoursImportArticles } from '@/apps/artisan/components/catalogue/import/useParcoursImportArticles';
import EtapeFichier from '@/apps/artisan/components/catalogue/import/EtapeFichier';
import EtapeColonnes from '@/apps/artisan/components/catalogue/import/EtapeColonnes';
import EtapeApercu from '@/apps/artisan/components/catalogue/import/EtapeApercu';
import EtapeResultat from '@/apps/artisan/components/catalogue/import/EtapeResultat';
import ImportsPrecedents from '@/apps/artisan/components/catalogue/import/ImportsPrecedents';
import { Encadre } from '@/apps/artisan/components/catalogue/import/Encadres';

const PAGE_ARTICLES = '/settings/suppliers/articles';

const ETAPES = [
  { cle: 'fichier', libelle: 'Fichier' },
  { cle: 'colonnes', libelle: 'Colonnes' },
  { cle: 'apercu', libelle: 'Aperçu' },
  { cle: 'envoi', libelle: 'Envoi' },
  { cle: 'resultat', libelle: 'Résultat' },
];

const LECTURE_IMPOSSIBLE = 'Ce fichier n\'a pas pu être lu. Vérifiez qu\'il s\'ouvre dans votre tableur, puis déposez-le de nouveau.';

function FilEtapes({ etape }) {
  const courant = ETAPES.findIndex((e) => e.cle === etape);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Étapes de l'import">
      {ETAPES.map((e, i) => {
        const fait = i < courant;
        const actif = i === courant;
        return (
          <li key={e.cle} className="flex items-center gap-2">
            {i > 0 && <span className="text-secondary-300" aria-hidden="true">·</span>}
            <span
              aria-current={actif ? 'step' : undefined}
              className={`inline-flex items-center gap-1 ${actif ? 'font-semibold text-primary-700' : fait ? 'text-secondary-700' : 'text-secondary-400'}`}
            >
              {fait ? <Check className="w-4 h-4" aria-hidden="true" /> : <span aria-hidden="true">{i + 1}.</span>}
              {e.libelle}
              {fait && <span className="sr-only">(fait)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Nom du fichier sans extension, pour nommer les fichiers téléchargés. */
const baseDuNom = (nom) => String(nom || 'import').replace(/\.[^.]+$/, '');

function texteArretArticles(faits) {
  if (!(faits > 0)) return "Import arrêté : aucun article n'a été écrit.";
  return faits > 1
    ? `Import arrêté : ${faits} articles sont déjà écrits. Vous pouvez les retirer dans « Imports précédents », plus bas.`
    : 'Import arrêté : 1 article est déjà écrit. Vous pouvez le retirer dans « Imports précédents », plus bas.';
}

export default function ArticlesImport() {
  const { organization, isOrgAdmin } = useAuth();
  const orgId = organization?.id;
  const navigate = useNavigate();
  const parcours = useParcoursImportArticles(orgId);
  const { etat, actions, apercu, envoiPrevu } = parcours;
  const run = useExecuterImportArticles(orgId);
  const { fichier, envoi } = etat;
  const enCours = run.etat === 'en_cours';

  // Quitter la page pendant l'envoi coupe l'import : le navigateur demande confirmation.
  useEffect(() => {
    if (!enCours) return undefined;
    const retenir = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', retenir);
    return () => window.removeEventListener('beforeunload', retenir);
  }, [enCours]);

  if (!isOrgAdmin) return <Navigate to={PAGE_ARTICLES} replace />;

  // L'étape Envoi devient Résultat quand l'écriture est terminée.
  const etapeAffichee = etat.etape === 'envoi' && run.etat === 'termine' ? 'resultat' : etat.etape;

  const deposer = async (file) => {
    const refus = refusFichier({ nom: file.name, taille: file.size });
    if (refus) { actions.refuser(refus); return; }
    actions.debutLecture();
    try {
      const { matrice, reparees } = await lireFichierDepose(file);
      actions.fichierLu(file.name, matrice, reparees);
    } catch (e) {
      logger.warn('[ArticlesImport] lecture du fichier impossible', e);
      actions.refuser(LECTURE_IMPOSSIBLE);
    }
  };

  const telecharger = async (nomFichier, feuilles) => {
    try {
      await telechargerClasseur(nomFichier, feuilles);
    } catch (e) {
      logger.error('[ArticlesImport] téléchargement impossible', e);
      toast.error('Le fichier n\'a pas pu être préparé. Réessayez.');
    }
  };

  const telechargerEcartees = (lignesClassees, choixFaits) => telecharger(
    `lignes-ecartees-${baseDuNom(fichier?.nom)}.xlsx`,
    [feuilleLignesEcarteesArticles(fichier.entetes, fichier.lignes, lignesClassees, choixFaits)],
  );

  // Fermé (envoiPrevu = null) tant qu'articles existants ou fournisseurs sont inconnus, qu'une erreur de
  // correspondance reste, ou qu'aucune ligne n'est à importer.
  const lancer = () => {
    if (!envoiPrevu || run.etat === 'en_cours' || run.etat === 'interrompu') return;
    actions.envoyer(envoiPrevu.classees);
    run.lancer({ import: envoiPrevu.ouverture, lignes: envoiPrevu.lignes, preparer: envoiPrevu.preparer });
  };

  // Import interrompu que l'on ne reprend pas : retour à l'aperçu, les articles déjà écrits restent (retirables plus bas).
  const arreter = () => {
    const faits = run.progression.faits;
    run.abandonner();
    actions.arreter(texteArretArticles(faits));
  };

  return (
    <div className="space-y-6">
      {/* Pendant l'envoi, aucun lien de la page : quitter démonterait l'écran qui suit l'import et sa reprise. */}
      {enCours ? (
        <Encadre ton="attention" role="status">
          Import en cours : restez sur cette page jusqu&apos;à la fin.
        </Encadre>
      ) : (
        <Link to={PAGE_ARTICLES} className="inline-flex items-center gap-1 text-sm text-secondary-600 hover:text-secondary-900">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Retour aux articles
        </Link>
      )}
      <PageHeader
        title="Importer des articles"
        subtitle="Reprenez les articles de votre ancien logiciel ou d'un tarif, avec leurs fournisseurs."
      />
      <FilEtapes etape={etapeAffichee} />

      {etat.etape === 'fichier' && (
        <EtapeFichier
          lecture={etat.lecture}
          refus={etat.refus}
          onFichier={deposer}
          onTelechargerType={() => telecharger('fichier-type-articles.xlsx', feuillesFichierTypeArticles())}
        />
      )}
      {etat.etape === 'colonnes' && fichier && (
        <EtapeColonnes
          fichier={fichier}
          correspondance={etat.correspondance}
          validation={parcours.validation}
          fournisseurIncomplet={parcours.fournisseurIncomplet}
          onEntete={actions.changerEntete}
          onCible={actions.changerCible}
          onRetour={actions.versFichier}
          onSuite={actions.versApercu}
        />
      )}
      {etat.etape === 'apercu' && fichier && (
        <EtapeApercu
          apercu={apercu}
          fournisseurs={parcours.fournisseurs}
          fournisseursOrg={parcours.fournisseursOrg}
          existants={parcours.existants}
          valeurs={parcours.valeurs}
          choix={etat.choix}
          validation={parcours.validation}
          enCours={enCours}
          avis={etat.avis}
          peutLancer={!!envoiPrevu && run.etat !== 'interrompu'}
          onRelire={parcours.existants.refetch}
          onValeur={actions.changerValeur}
          onCreation={actions.changerCreation}
          onBasculer={actions.basculerDoublon}
          onTousLesDoublons={actions.tousLesDoublons}
          onTelechargerEcartees={() => telechargerEcartees(apercu.classees, etat.choix)}
          onRetour={actions.versColonnes}
          onLancer={lancer}
        />
      )}
      {etat.etape === 'envoi' && envoi && (
        <EtapeResultat
          etat={run.etat}
          progression={run.progression}
          bilan={run.bilan}
          erreur={run.erreur}
          fournisseurs={run.fournisseurs}
          aDesEcartees={envoi.classees.some((l) => !aImporter(l, envoi.choix))}
          onReprendre={run.reprendre}
          onArreter={arreter}
          onVoirArticles={() => navigate(PAGE_ARTICLES)}
          onNouvelImport={actions.versFichier}
          onTelechargerEcartees={() => telechargerEcartees(envoi.classees, envoi.choix)}
          onRetourApercu={actions.retourApercu}
        />
      )}
      {/* Masquée aussi quand l'import est interrompu : le retirer en partie puis « Reprendre » recréerait
          les articles retirés. On reprend ou on arrête d'abord ; la liste revient ensuite. */}
      {run.etat !== 'en_cours' && run.etat !== 'interrompu' && <ImportsPrecedents orgId={orgId} />}
    </div>
  );
}
