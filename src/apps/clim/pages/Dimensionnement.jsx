// src/apps/clim/pages/Dimensionnement.jsx
// Page /clim : relevé à gauche, résultat vivant à droite (moteur pur src/lib/clim/). Brouillon
// localStorage par utilisateur. `?lead=<id>` : « Créer le devis » ouvre CreateDevisModal avec les
// lignes de la proposition (famille Climatisation). Spec 2026-10-06-dimensionnement-clim-design.md §4.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, RotateCcw, Snowflake, AlertTriangle } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useProductsByCategory } from '@hooks/useSuppliers';
import { useLead } from '@hooks/useLeads';
import { buildDefaultSections } from '@services/devis.service';
import { buildClimConfig } from '@/lib/clim/config.js';
import { dimensionner, lignesDevis } from '@/lib/clim/dimensionnement.js';
import CreateDevisModal from '@apps/artisan/components/devis/CreateDevisModal';
import ReleveForm from '../components/ReleveForm';
import ResultatPanel from '../components/ResultatPanel';
import { releveInitial, releveVersMoteur, loadDraft, saveDraft, clearDraft } from '../lib/releveState';

const FAMILLE = 'Climatisation';

/** Lignes initiales du devis : sections par défaut de la famille, équipement puis accessoires. */
function lignesInitiales(proposition) {
  const sections = buildDefaultSections(FAMILLE);
  const equipements = lignesDevis(proposition.postes.filter((p) => !p.article.liquide));
  const accessoires = lignesDevis(proposition.postes.filter((p) => p.article.liquide));
  const out = [];
  for (const s of sections) {
    out.push(s);
    if (s.designation === 'ÉQUIPEMENT') out.push(...equipements);
    if (s.designation === 'ACCESSOIRES') out.push(...accessoires);
  }
  return out;
}

export default function Dimensionnement() {
  const { settings, isLoading } = useOrgSettings();
  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="w-6 h-6 text-primary-600 animate-spin" /></div>;
  }
  return <DimensionnementInner cfg={buildClimConfig(settings)} />;
}

function DimensionnementInner({ cfg }) {
  const { user, organization } = useAuth();
  const userId = user?.id;
  const orgId = organization?.id;
  const [searchParams] = useSearchParams();
  const leadId = searchParams.get('lead');
  const { lead } = useLead(leadId);
  // Lecture filtrée côté base : la liste « tous les produits » est plafonnée à 1 000 lignes par PostgREST
  // et Solipac n'y apparaissait jamais derrière les 24 000 articles de fumisterie.
  const { products: produitsClim, isLoading: chargementCatalogue } = useProductsByCategory(orgId, 'climatisation');

  const [releve, setReleve] = useState(() => loadDraft(userId) || releveInitial(cfg.gamme_defaut));
  useEffect(() => { saveDraft(userId, releve); }, [userId, releve]);

  const resultat = useMemo(() => dimensionner(releveVersMoteur(releve), produitsClim, cfg), [releve, produitsClim, cfg]);
  const [modeChoisi, setModeChoisi] = useState(null);
  const mode = modeChoisi || resultat.mode_recommande || 'mono';
  const [devisOuvert, setDevisOuvert] = useState(false);

  const proposition = resultat.ok ? (mode === 'multi' && resultat.multi?.groupe ? resultat.multi : resultat.mono) : null;

  const reinitialiser = () => { clearDraft(userId); setReleve(releveInitial(cfg.gamme_defaut)); setModeChoisi(null); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 flex items-center gap-2"><Snowflake className="w-6 h-6 text-primary-600" /> Dimensionnement climatisation</h1>
          <p className="text-secondary-600">Puissance par pièce, unités du catalogue et liaisons. Le chauffage principal relève d’une étude thermique.</p>
          {lead && <p className="text-sm text-secondary-700 mt-1">Pour le lead <b>{[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.company || lead.email}</b></p>}
        </div>
        <button type="button" onClick={reinitialiser} className="btn-secondary flex items-center gap-2 text-sm"><RotateCcw className="w-4 h-4" /> Nouveau relevé</button>
      </div>

      {!chargementCatalogue && produitsClim.length === 0 && (
        <div className="flex gap-2 rounded-lg bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Aucun produit de catégorie « Climatisation » dans vos fournisseurs : le besoin est calculé, mais aucune unité ne peut être proposée. <Link to="/settings/suppliers" className="underline">Importer un catalogue</Link>.</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
        <ReleveForm releve={releve} gammes={resultat.gammes} onChange={(r) => { setReleve(r); }} />
        <div className="lg:sticky lg:top-4">
          <ResultatPanel resultat={resultat} mode={mode} onMode={setModeChoisi} peutCreerDevis={!!lead} onCreerDevis={() => setDevisOuvert(true)} />
        </div>
      </div>

      {devisOuvert && lead && proposition && (
        <CreateDevisModal lead={lead} initialFamily={FAMILLE} initialLines={lignesInitiales(proposition)} onClose={() => setDevisOuvert(false)} />
      )}
    </div>
  );
}
