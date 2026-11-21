/**
 * ClientsImport.jsx - Majord'home Artisan
 * ============================================================================
 * Import des clients d'un autre logiciel, en quatre étapes : fichier,
 * correspondance des colonnes, aperçu (doublons, lignes écartées), résultat.
 * Réservé à l'administrateur de l'entreprise. La page assemble : le parcours
 * est dans useParcoursImport, chaque règle dans src/lib/importClients/.
 * ============================================================================
 */

import { useEffect } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@lib/logger';
import { useClientImportRun } from '@hooks/useClientImports';
import { refusFichier } from '@/lib/importClients/lireFichier';
import { feuillesFichierType, feuilleLignesEcartees } from '@/lib/importClients/fichierType';
import { aImporter } from '@/lib/importClients/controles';
import { useParcoursImport } from '@/apps/artisan/components/clients/import/useParcoursImport';
import { lireFichierDepose, telechargerClasseur } from '@/apps/artisan/components/clients/import/classeur';
import EtapeFichier from '@/apps/artisan/components/clients/import/EtapeFichier';
import EtapeCorrespondance from '@/apps/artisan/components/clients/import/EtapeCorrespondance';
import EtapeApercu from '@/apps/artisan/components/clients/import/EtapeApercu';
import EtapeResultat from '@/apps/artisan/components/clients/import/EtapeResultat';

const ETAPES = [
  { cle: 'fichier', libelle: 'Fichier' },
  { cle: 'correspondance', libelle: 'Correspondance' },
  { cle: 'apercu', libelle: 'Aperçu' },
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
            {i > 0 && <span className="text-gray-300" aria-hidden="true">·</span>}
            <span
              aria-current={actif ? 'step' : undefined}
              className={`inline-flex items-center gap-1 ${actif ? 'font-semibold text-blue-700' : fait ? 'text-gray-700' : 'text-gray-400'}`}
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

export default function ClientsImport() {
  const { organization, isOrgAdmin } = useAuth();
  const orgId = organization?.id;
  const navigate = useNavigate();
  const { etat, actions, existants, validation, classees, bilan, relireExistants } = useParcoursImport(orgId);
  const run = useClientImportRun(orgId);
  const { fichier, choix, envoi } = etat;

  // Quitter la page pendant l'envoi coupe l'import : le navigateur demande confirmation.
  useEffect(() => {
    if (run.etat !== 'en_cours') return undefined;
    const retenir = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', retenir);
    return () => window.removeEventListener('beforeunload', retenir);
  }, [run.etat]);

  if (!isOrgAdmin) return <Navigate to="/clients" replace />;

  const deposer = async (file) => {
    const refus = refusFichier({ nom: file.name, taille: file.size });
    if (refus) { actions.refuser(refus); return; }
    actions.debutLecture();
    try {
      actions.fichierLu(file.name, await lireFichierDepose(file));
    } catch (e) {
      logger.warn('[ClientsImport] lecture du fichier impossible', e);
      actions.refuser(LECTURE_IMPOSSIBLE);
    }
  };

  const telecharger = async (nomFichier, feuilles) => {
    try {
      await telechargerClasseur(nomFichier, feuilles);
    } catch (e) {
      logger.error('[ClientsImport] téléchargement impossible', e);
      toast.error('Le fichier n\'a pas pu être préparé. Réessayez.');
    }
  };

  const telechargerEcartees = (lignesClassees, choixFaits) => telecharger(
    `lignes-ecartees-${baseDuNom(fichier?.nom)}.xlsx`,
    [feuilleLignesEcartees(fichier.entetes, fichier.lignes, lignesClassees, choixFaits)],
  );

  const lancer = () => {
    if (!classees || !bilan?.importees || run.etat === 'en_cours') return;
    actions.envoyer(classees);
    run.lancer({
      fileName: fichier.nom,
      sourceLabel: etat.sourceLabel.trim() || null,
      mapping: etat.correspondance,
      classees,
      choix,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-3">
          {/* Pendant l'envoi, aucun lien de la page : quitter démonterait l'écran qui suit l'import et sa reprise
              (le routeur est un BrowserRouter, sans useBlocker possible). */}
          {run.etat === 'en_cours' ? (
            <p role="status" className="flex items-center gap-2 text-sm font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              Import en cours : restez sur cette page jusqu&apos;à la fin.
            </p>
          ) : (
            <Link to="/clients" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Retour aux clients
            </Link>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Importer des clients</h1>
            <p className="text-gray-500 mt-1">Reprenez les clients de votre ancien logiciel depuis un fichier Excel ou CSV.</p>
          </div>
          <FilEtapes etape={etat.etape} />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {etat.etape === 'fichier' && (
          <EtapeFichier
            lecture={etat.lecture}
            refus={etat.refus}
            sourceLabel={etat.sourceLabel}
            onSource={actions.changerSource}
            onFichier={deposer}
            onTelechargerType={() => telecharger('fichier-type-clients.xlsx', feuillesFichierType())}
          />
        )}
        {etat.etape === 'correspondance' && fichier && (
          <EtapeCorrespondance
            fichier={fichier}
            correspondance={etat.correspondance}
            validation={validation}
            onEntete={actions.changerEntete}
            onCible={actions.changerCible}
            onRetour={actions.versFichier}
            onSuite={actions.versApercu}
          />
        )}
        {etat.etape === 'apercu' && fichier && (
          <EtapeApercu
            classees={classees}
            bilan={bilan}
            existants={existants}
            choix={choix}
            enCours={run.etat === 'en_cours'}
            libelleRetour="Revoir la correspondance"
            onRelire={relireExistants}
            onImporter={actions.basculerImporter}
            onEcarter={actions.basculerEcarter}
            onTelechargerEcartees={() => telechargerEcartees(classees, choix)}
            onRetour={actions.versCorrespondance}
            onLancer={lancer}
          />
        )}
        {etat.etape === 'resultat' && envoi && (
          <EtapeResultat
            etat={run.etat}
            progression={run.progression}
            bilan={run.bilan}
            erreur={run.erreur}
            aDesEcartees={envoi.classees.some((l) => !aImporter(l, envoi.choix))}
            onReprendre={run.reprendre}
            onVoirClients={() => navigate('/clients')}
            onTelechargerEcartees={() => telechargerEcartees(envoi.classees, envoi.choix)}
            onRetourApercu={actions.retourApercu}
          />
        )}
      </div>
    </div>
  );
}
