// src/apps/artisan/components/devis/metre/MetreFumisterie.jsx
// Métré assisté (plein écran, au-dessus de CreateDevisModal) : qualification → relevé → validation.
// Les lignes validées sont injectées dans la section FUMISTERIE du devis ; le métré (relevé +
// résultat FIGÉ + engine_version) est rendu à l'appelant, qui l'enregistre après création du devis.
import { useMemo, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Check, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useFumConfigurations, useFumBundle, useFumSupplier, useFumArticles } from '@hooks/useFumisterie';
import { buildFumisterieConfig } from '@/lib/fumisterie/config.js';
import { logger } from '@lib/logger';
import QualificationStep from './QualificationStep';
import ReleveStep from './ReleveStep';
import { useMetreDraft } from './useMetreDraft';
import { releveInitial, versLignesDevis, calculerMetreSurEcran } from './metreModel';

const EMPTY = [];
const Spinner = () => <Loader2 className="w-6 h-6 animate-spin text-secondary-500" />;

/** Blocage explicite (erreur de requête, fournisseur absent) : jamais un écran vide. */
function Blocage({ titre, message }) {
  return (
    <div role="alert" className="flex items-start gap-3 max-w-2xl p-4 rounded-xl border-l-4 border-primary-500 bg-primary-50 text-secondary-800">
      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-primary-800" />
      <div><p className="font-semibold">{titre}</p>{message && <p className="text-sm text-secondary-600 mt-1">{message}</p>}</div>
    </div>
  );
}

export default function MetreFumisterie({ orgId, leadId, onClose, onValidate }) {
  const { user } = useAuth();
  const { settings } = useOrgSettings();
  const reglages = useMemo(() => buildFumisterieConfig(settings), [settings]);
  const { draft, setDraft, clear } = useMetreDraft(user?.id, leadId);
  const [etape, setEtape] = useState(draft?.etape ?? 0);
  const [criteres, setCriteres] = useState(draft?.criteres ?? { projet: null, appareil: null, combustible: null, zone: null, prise_air: null });
  const [configurationId, setConfigurationId] = useState(draft?.configurationId ?? null);
  const [releve, setReleveState] = useState(draft?.releve ?? null);
  const setReleve = (r) => { setReleveState(r); setDraft({ etape, criteres, configurationId, releve: r }); };

  const confsQ = useFumConfigurations(orgId);
  const bundleQ = useFumBundle(orgId, configurationId);
  const supplierQ = useFumSupplier(orgId);
  const configurations = confsQ.data ?? EMPTY;
  const bundle = bundleQ.data;
  const supplier = supplierQ.data;
  const gammes = useMemo(() => [...new Set((bundle?.mapping || []).map((m) => m.gamme_tarif))], [bundle]);
  const articlesQ = useFumArticles(orgId, supplier?.id, gammes, releve?.diametre);
  const articles = articlesQ.data ?? EMPTY;

  // Une requête en erreur n'est JAMAIS présentée comme un catalogue vide.
  const erreurRequete = [confsQ, bundleQ, supplierQ, articlesQ].find((q) => q.isError)?.error;
  const sansFournisseur = supplierQ.isSuccess && !supplier;

  // Calcul UNIQUE : ce qui s'affiche est ce qui sera injecté.
  const resultat = useMemo(
    () => (etape === 1 && bundle && releve ? calculerMetreSurEcran({ ...bundle, articles, reglages, releve }) : null),
    [etape, bundle, articles, reglages, releve],
  );
  // Articles d'un autre Ø affichés le temps du fetch (placeholder) : on n'injecte pas ça.
  const injectable = !!resultat && !resultat.erreur && !articlesQ.isPlaceholderData && !sansFournisseur && !erreurRequete;

  const allerAuReleve = () => {
    if (!bundle?.gabarit) { toast.error('Cette configuration n\'a pas encore de gabarit de métré'); return; }
    const r = releve || releveInitial(bundle.gabarit, reglages);
    setReleveState(r);
    setEtape(1);
    setDraft({ etape: 1, criteres, configurationId, releve: r });
  };
  const valider = () => {
    if (!resultat || resultat.erreur) {
      const message = resultat?.erreur || 'Calcul du métré indisponible';
      logger.error('[MetreFumisterie] calcul moteur', message);
      toast.error(`Métré non injecté : ${message}`);
      return;
    }
    if (resultat.alertes.some((a) => a.niveau === 'warn' && a.code !== 'article_manquant' && a.code !== 'article_ambigu')) {
      if (!window.confirm('Des contrôles sont en alerte (zone, dévoiement, buse…). Injecter quand même les lignes dans le devis ?')) return;
    }
    onValidate({
      lignesDevis: versLignesDevis(resultat.lignes, supplier?.id, supplier?.name),
      metre: { configurationId, gabaritCode: bundle.gabarit.code, diametre: releve.diametre, finition: releve.finition, releve, resultat, engineVersion: resultat.engine_version, leadId },
    });
    clear();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-secondary-100 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-secondary-200">
        <div><p className="text-xs uppercase tracking-wide text-secondary-500">Métré assisté · fumisterie</p><h2 className="text-lg font-semibold text-secondary-900">{etape === 0 ? 'Qualifier le projet' : bundle?.configuration?.titre}</h2></div>
        <button type="button" onClick={() => { if (window.confirm('Quitter le métré ? La saisie en cours reste en brouillon.')) onClose(); }} className="p-2 rounded hover:bg-secondary-100" aria-label="Fermer"><X className="w-5 h-5" /></button>
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        {erreurRequete ? <Blocage titre="Chargement du catalogue fumisterie impossible" message={erreurRequete.message || String(erreurRequete)} />
          : sansFournisseur ? <Blocage titre="Aucun fournisseur de fumisterie configuré (MODINOX / ALTEMA) — importer le tarif" />
          : etape === 0 ? (confsQ.isLoading ? <Spinner /> : <QualificationStep configurations={configurations} criteres={criteres} setCriteres={setCriteres} selectedId={configurationId} onSelect={setConfigurationId} />)
          : (!bundle || !releve || articlesQ.isLoading || !resultat) ? <Spinner />
          : (
            <div className="space-y-4">
              {/* Relevé incomplet / hors plage : blocage visible au-dessus du formulaire (l'injection est désactivée). */}
              {resultat.erreur && <Blocage titre="Métré non calculable — corrigez le relevé" message={resultat.erreur} />}
              <ReleveStep bundle={bundle} reglages={reglages} releve={releve} setReleve={setReleve} resultat={resultat} />
            </div>
          )}
      </main>
      <footer className="flex items-center justify-between px-4 py-3 bg-white border-t border-secondary-200">
        <button type="button" onClick={() => (etape === 0 ? onClose() : setEtape(0))} className="btn-secondary"><ArrowLeft className="w-4 h-4 mr-1" />{etape === 0 ? 'Annuler' : 'Qualification'}</button>
        {etape === 0
          ? <button type="button" disabled={!configurationId || bundleQ.isLoading || sansFournisseur || !!erreurRequete} onClick={allerAuReleve} className="btn-primary">Relevé <ArrowRight className="w-4 h-4 ml-1" /></button>
          : <button type="button" disabled={!injectable} onClick={valider} className="btn-primary"><Check className="w-4 h-4 mr-1" /> Injecter dans le devis</button>}
      </footer>
    </div>
  );
}
