// src/apps/artisan/components/devis/metre/MetreFumisterie.jsx
// Métré assisté (plein écran, au-dessus de CreateDevisModal) : qualification → relevé → validation.
// Les lignes validées sont injectées dans la section FUMISTERIE du devis ; le métré (relevé +
// résultat FIGÉ + engine_version) est rendu à l'appelant, qui l'enregistre après création du devis.
import { useEffect, useMemo, useState } from 'react';
import { X, ArrowLeft, Check, AlertTriangle, RotateCcw } from 'lucide-react';
import { CalqueModal } from '@/components/ui/calque-modal';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useFumConfigurations, useFumBundle, useFumFabricantsDuMetre } from '@hooks/useFumisterie';
import { buildFumisterieConfig } from '@/lib/fumisterie/config.js';
import { comparerFabricants, choisirColonne, champsAcorriger } from '@/lib/fumisterie/index.js';
import { LignesSquelette } from '@/components/ui/squelette';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { logger } from '@lib/logger';
import QualificationStep from './QualificationStep';
import ReleveStep from './ReleveStep';
import { useMetreDraft } from './useMetreDraft';
import { releveInitial, versLignesDevis, resultatDeColonne, criteresDepuisFamille } from './metreModel';
import { useFabricantPrefere } from './useFabricantPrefere';

const EMPTY = [];
const Chargement = ({ libelle }) => <LignesSquelette nombre={4} libelle={libelle} className="max-w-2xl" />;

/** Blocage explicite (erreur de requête, fournisseur absent) : jamais un écran vide, jamais le texte technique. */
function Blocage({ titre, message, action }) {
  return (
    <div role="alert" className="flex items-start gap-3 max-w-2xl p-4 rounded-xl border border-st-alerte/30 bg-st-alerte-bg text-secondary-800">
      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-st-alerte" />
      <div>
        <p className="font-semibold">{titre}</p>{message && <p className="text-sm text-secondary-700 mt-1">{message}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export default function MetreFumisterie({ orgId, leadId, dossier = null, family, onClose, onValidate }) {
  const { user } = useAuth();
  const { settings } = useOrgSettings();
  const reglages = useMemo(() => buildFumisterieConfig(settings), [settings]);
  const { draft, setDraft, clear } = useMetreDraft(user?.id, dossier);
  const [etape, setEtape] = useState(draft?.etape ?? 0);
  // Brouillon en cours ⇒ ses critères ; sinon appareil + combustible viennent de la famille du devis.
  const [criteres, setCriteres] = useState(draft?.criteres ?? criteresDepuisFamille(family));
  const [configurationId, setConfigurationId] = useState(draft?.configurationId ?? null);
  const [releve, setReleveState] = useState(draft?.releve ?? null);
  const setReleve = (r) => { setReleveState(r); setDraft({ etape, criteres, configurationId, releve: r }); };
  // Un brouillon restauré se DIT (il peut rouvrir directement le relevé d'une autre configuration
  // que celle qu'on attend) et se jette d'un geste. Contradiction famille ↔ brouillon = alerte.
  const [brouillonRestaure, setBrouillonRestaure] = useState(!!draft);
  const familleCriteres = criteresDepuisFamille(family);
  const brouillonContradictoire = !!(draft?.criteres?.combustible && familleCriteres.combustible && draft.criteres.combustible !== familleCriteres.combustible);
  const repartirDeZero = () => {
    clear(); setBrouillonRestaure(false); setEtape(0); setCriteres(familleCriteres); setConfigurationId(null); setReleveState(null);
  };

  const confsQ = useFumConfigurations(orgId);
  const bundleQ = useFumBundle(orgId, configurationId);
  const configurations = confsQ.data ?? EMPTY;
  const bundle = bundleQ.data;
  // Chaque fabricant de fumisterie de l'org : mapping, équivalences, articles au Ø du relevé.
  const fab = useFumFabricantsDuMetre(orgId, bundle, releve?.diametre);

  // Une requête en erreur n'est JAMAIS présentée comme un catalogue vide.
  const erreurRequete = [confsQ, bundleQ].find((q) => q.isError)?.error || fab.error;
  const sansFournisseur = !fab.isLoading && !fab.error && fab.fabricants.length === 0 && !!orgId;
  useEffect(() => { if (erreurRequete) logger.error('[MetreFumisterie] chargement du catalogue', erreurRequete); }, [erreurRequete]);
  const reessayer = () => { [confsQ, bundleQ].filter((q) => q.isError).forEach((q) => q.refetch()); fab.reessayer(); };

  // Calcul UNIQUE, chez chaque fabricant : ce qui s'affiche (colonne choisie) est ce qui sera injecté.
  const comparaison = useMemo(
    () => (etape === 1 && bundle && releve && !fab.isLoading ? comparerFabricants({ ...bundle, reglages, releve }, fab.fabricants) : null),
    [etape, bundle, reglages, releve, fab.isLoading, fab.fabricants],
  );
  const [fabricantChoisi, setFabricantChoisi] = useFabricantPrefere(orgId);
  const colonne = choisirColonne(comparaison, fabricantChoisi, fab.fabricants);
  const resultat = useMemo(() => (colonne ? resultatDeColonne(colonne) : null), [colonne]);
  // Articles d'un autre Ø affichés le temps du fetch (placeholder) : on n'injecte pas ça.
  const injectable = !!resultat && !resultat.erreur && !fab.isPlaceholder && !sansFournisseur && !erreurRequete;
  // Refus du relevé, un par champ : écrits sous le champ, comptés dans un seul bandeau (jamais répétés ailleurs).
  const aCorriger = useMemo(() => (etape === 1 && bundle?.gabarit && releve ? champsAcorriger(bundle.gabarit, releve) : EMPTY), [etape, bundle, releve]);
  const erreursParCle = useMemo(() => Object.fromEntries(aCorriger.map((e) => [e.cle, e])), [aCorriger]);
  const raisonBouton = aCorriger.length ? `Corrigez ${aCorriger.length > 1 ? `les ${aCorriger.length} champs signalés` : 'le champ signalé'}` : undefined;

  const allerAuReleve = () => {
    if (!bundle?.gabarit) { toast.error('Cette configuration n\'a pas encore de gabarit de métré'); return; }
    const r = releve || releveInitial(bundle.gabarit, reglages, criteres);
    setReleveState(r);
    setEtape(1);
    setDraft({ etape: 1, criteres, configurationId, releve: r });
  };
  // Cliquer une carte de configuration = la choisir ET ouvrir son relevé dès que son gabarit est chargé.
  const [versReleve, setVersReleve] = useState(false);
  const choisirEtContinuer = (id) => { if (id !== configurationId) setReleveState(null); setConfigurationId(id); setVersReleve(true); };
  useEffect(() => {
    if (!versReleve || etape !== 0 || !bundle || bundle.configuration?.id !== configurationId) return;
    setVersReleve(false);
    allerAuReleve();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versReleve, bundle, configurationId, etape]);
  const fermer = () => { if (dossier && (draft || releve)) toast.info('Métré mis de côté : la saisie reste en brouillon.'); onClose(); };
  // Alertes de contrôle (zone, dévoiement, buse…) : on demande confirmation dans une modale de l'app,
  // pas dans le dialogue système du navigateur. Les lignes « à chiffrer » ne bloquent pas.
  const [confirmationAlertes, setConfirmationAlertes] = useState(false);
  const alertesBloquantes = resultat ? resultat.alertes.filter((a) => a.niveau === 'warn' && a.code !== 'article_manquant' && a.code !== 'article_ambigu') : [];
  const injecter = () => {
    setConfirmationAlertes(false);
    onValidate({
      lignesDevis: versLignesDevis(resultat.lignes, colonne.supplierId, colonne.nom),
      // supplier_id n'existe en base qu'après la migration 20261128_1 (vue des fabricants présente).
      metre: { configurationId, gabaritCode: bundle.gabarit.code, diametre: releve.diametre, finition: releve.finition, releve, resultat, engineVersion: resultat.engine_version, leadId,
        supplierId: fab.avecVue ? colonne.supplierId : null },
    });
    // Le brouillon n'est PAS effacé ici : le devis n'est pas encore enregistré (CreateDevisModal l'efface
    // après saveMetre). Abandonner le devis laisse donc le relevé à reprendre.
  };
  const valider = () => {
    if (!injectable) return;
    if (alertesBloquantes.length) { setConfirmationAlertes(true); return; }
    injecter();
  };

  return (
    <CalqueModal onClose={fermer} titreId="metre-titre" fermerAuFond={false} className="bg-secondary-100 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-secondary-200">
        <div><p className="text-xs uppercase tracking-wide text-secondary-500">Métré assisté · fumisterie</p><h2 id="metre-titre" className="text-lg font-semibold text-secondary-900">{etape === 0 ? 'Qualifier le projet' : bundle?.configuration?.titre}</h2></div>
        <button type="button" onClick={fermer} className="p-2 rounded hover:bg-secondary-100" aria-label="Fermer"><X className="w-5 h-5" /></button>
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        {brouillonRestaure && (
          <div role="status" className={`flex items-center justify-between gap-3 mb-4 px-4 py-2.5 rounded-lg border text-sm ${brouillonContradictoire ? 'border-primary-300 bg-primary-50 text-primary-900' : 'border-secondary-200 bg-white text-secondary-700'}`}>
            <span>
              {brouillonContradictoire ? <AlertTriangle className="w-4 h-4 inline mr-1.5 -mt-0.5" /> : null}
              Saisie précédente restaurée{bundle?.configuration ? ` : ${bundle.configuration.code} · ${bundle.configuration.titre}` : ''}.
              {brouillonContradictoire && ` Ce métré est « ${draft.criteres.combustible === 'pellets' ? 'pellets' : 'bois bûches'} » alors que le devis est « ${family} ».`}
            </span>
            <button type="button" onClick={repartirDeZero} className="btn-secondary shrink-0">Repartir de zéro</button>
          </div>
        )}
        {erreurRequete ? <Blocage titre="Le catalogue n’a pas pu être chargé." message="Vérifiez la connexion puis réessayez."
              action={<Button variant="secondary" size="sm" onClick={reessayer}><RotateCcw className="w-4 h-4" />Réessayer</Button>} />
          : sansFournisseur ? <Blocage titre="Aucun fabricant de fumisterie configuré : importer un tarif et ses attributs" />
          : etape === 0 ? (confsQ.isLoading ? <Chargement libelle="Chargement des configurations" /> : <QualificationStep configurations={configurations} criteres={criteres} setCriteres={setCriteres} selectedId={configurationId} onContinue={choisirEtContinuer} />)
          : (!bundle || !releve || fab.isLoading || !resultat) ? <Chargement libelle="Calcul du métré" />
          : (
            <div className="space-y-4">
              {/* Relevé incomplet / hors plage : dit sous chaque champ et compté dans le bandeau de ReleveStep. Une autre
                  erreur du calcul (gabarit non pris en charge) reste dite ici, sans le texte technique. */}
              {resultat.erreur && !aCorriger.length && <Blocage titre="Le métré n’a pas pu être calculé pour cette solution." message="Choisissez une autre solution ou prévenez l’administrateur." />}
              <ReleveStep bundle={bundle} reglages={reglages} releve={releve} setReleve={setReleve} resultat={resultat} erreurs={erreursParCle} aCorriger={aCorriger}
                comparaison={comparaison} fabricantChoisi={colonne?.supplierId} onChoisirFabricant={setFabricantChoisi} />
            </div>
          )}
      </main>
      {/* À la qualification, la carte cliquée est l'action : pas de pied, une seule sortie (la croix). */}
      {etape === 1 && (
        <footer className="flex items-center justify-between px-4 py-3 bg-white border-t border-secondary-200">
          <button type="button" onClick={() => setEtape(0)} className="btn-secondary"><ArrowLeft className="w-4 h-4 mr-1" />Changer de configuration</button>
          <button type="button" disabled={!injectable} title={raisonBouton} onClick={valider} className="btn-primary"><Check className="w-4 h-4 mr-1" /> Injecter dans le devis</button>
        </footer>
      )}
      <ConfirmDialog open={confirmationAlertes} onOpenChange={setConfirmationAlertes} variant="default" title="Des contrôles sont en alerte"
        description="Vous pouvez injecter les lignes quand même : les alertes restent visibles dans le métré enregistré." confirmLabel="Injecter quand même" cancelLabel="Revenir au relevé" onConfirm={injecter}>
        <ul className="mt-3 space-y-1.5 text-sm text-secondary-800">
          {alertesBloquantes.map((a, i) => <li key={`${a.code}-${i}`} className="flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-primary-700" /><span>{a.message}</span></li>)}
        </ul>
      </ConfirmDialog>
    </CalqueModal>
  );
}
