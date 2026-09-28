// src/apps/artisan/components/devis/metre/MetreFumisterie.jsx
// Métré assisté (plein écran, au-dessus de CreateDevisModal) : qualification → relevé → validation.
// Les lignes validées sont injectées dans la section FUMISTERIE du devis ; le métré (relevé +
// résultat FIGÉ + engine_version) est rendu à l'appelant, qui l'enregistre après création du devis.
import { useMemo, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useFumConfigurations, useFumBundle, useFumSupplier, useFumArticles } from '@hooks/useFumisterie';
import { buildFumisterieConfig } from '@/lib/fumisterie/config.js';
import { calculerMetre } from '@/lib/fumisterie/index.js';
import QualificationStep from './QualificationStep';
import ReleveStep from './ReleveStep';
import { useMetreDraft } from './useMetreDraft';
import { releveInitial, versLignesDevis } from './metreModel';

export default function MetreFumisterie({ orgId, leadId, onClose, onValidate }) {
  const { user } = useAuth();
  const { settings } = useOrgSettings();
  const reglages = useMemo(() => buildFumisterieConfig(settings), [settings]);
  const { draft, setDraft, clear } = useMetreDraft(user?.id);
  const [etape, setEtape] = useState(draft?.etape ?? 0);
  const [criteres, setCriteres] = useState(draft?.criteres ?? { projet: null, appareil: null, combustible: null, zone: null, prise_air: null });
  const [configurationId, setConfigurationId] = useState(draft?.configurationId ?? null);
  const [releve, setReleveState] = useState(draft?.releve ?? null);
  const setReleve = (r) => { setReleveState(r); setDraft({ etape, criteres, configurationId, releve: r }); };

  const { data: configurations = [], isLoading: loadingConfs } = useFumConfigurations(orgId);
  const { data: bundle, isLoading: loadingBundle } = useFumBundle(orgId, configurationId);
  const { data: supplier } = useFumSupplier(orgId);
  const gammes = useMemo(() => [...new Set((bundle?.mapping || []).map((m) => m.gamme_tarif))], [bundle]);
  const { data: articles = [], isLoading: loadingArticles } = useFumArticles(orgId, supplier?.id, gammes, releve?.diametre);

  const allerAuReleve = () => {
    if (!bundle?.gabarit) { toast.error('Cette configuration n\'a pas encore de gabarit de métré'); return; }
    const r = releve || releveInitial(bundle.gabarit, reglages);
    setReleveState(r);
    setEtape(1);
    setDraft({ etape: 1, criteres, configurationId, releve: r });
  };
  const valider = () => {
    const resultat = calculerMetre({ ...bundle, articles, reglages, releve });
    if (resultat.alertes.some((a) => a.niveau === 'warn' && a.code !== 'article_manquant')) {
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
        {etape === 0 && (loadingConfs ? <Loader2 className="w-6 h-6 animate-spin text-secondary-500" /> : <QualificationStep configurations={configurations} criteres={criteres} setCriteres={setCriteres} selectedId={configurationId} onSelect={setConfigurationId} />)}
        {etape === 1 && bundle && releve && (loadingArticles && articles.length === 0 ? <Loader2 className="w-6 h-6 animate-spin text-secondary-500" /> : <ReleveStep bundle={bundle} articles={articles} reglages={reglages} releve={releve} setReleve={setReleve} />)}
      </main>
      <footer className="flex items-center justify-between px-4 py-3 bg-white border-t border-secondary-200">
        <button type="button" onClick={() => (etape === 0 ? onClose() : setEtape(0))} className="btn-secondary"><ArrowLeft className="w-4 h-4 mr-1" />{etape === 0 ? 'Annuler' : 'Qualification'}</button>
        {etape === 0
          ? <button type="button" disabled={!configurationId || loadingBundle} onClick={allerAuReleve} className="btn-primary">Relevé <ArrowRight className="w-4 h-4 ml-1" /></button>
          : <button type="button" disabled={!bundle || !releve} onClick={valider} className="btn-primary"><Check className="w-4 h-4 mr-1" /> Injecter dans le devis</button>}
      </footer>
    </div>
  );
}
