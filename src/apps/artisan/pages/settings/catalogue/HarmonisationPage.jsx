// src/apps/artisan/pages/settings/catalogue/HarmonisationPage.jsx
// Settings → Fournisseurs → Harmoniser les bases (niveau org, org_admin) : compteurs, « Normaliser les modèles (IA) »
// sur toutes les lignes sans clé, « Proposer les fusions », file des propositions (Proposées / Fusionnées / Refusées,
// « Tout fusionner »), fusion manuelle par recherche. Spec articles Majord'home § 5.6.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sparkles, GitMerge, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useCatalogProposals, useCatalogStats, useCatalogItemMutations } from '@hooks/useCatalogItems';
import { catalogItemsService } from '@services/catalogItems.service';
import { useDebounce } from '@hooks/useDebounce';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import SettingsPage from '../SettingsPage';
import ProposalRow from './ProposalRow';
import ArticleDrawer from './ArticleDrawer';

const ONGLETS = [
  { key: 'propose', label: 'À confirmer' },
  { key: 'fusionne', label: 'Fusionnées' },
  { key: 'refuse', label: 'Refusées' },
];

function Compteur({ label, valeur }) {
  return (
    <div className="card py-3">
      <p className="text-2xl font-semibold text-secondary-900">{valeur ?? '—'}</p>
      <p className="text-xs text-secondary-500">{label}</p>
    </div>
  );
}

/** Recherche d'un article pour la fusion manuelle. */
function ChoixArticle({ orgId, label, value, onChange }) {
  const [q, setQ] = useState('');
  const debounced = useDebounce(q, 300);
  const [results, setResults] = useState([]);
  // recherche à la frappe (petit volume : pas de cache React Query)
  useEffect(() => {
    let cancelled = false;
    if (debounced.trim().length < 2) { setResults([]); return undefined; }
    catalogItemsService.searchItems(orgId, debounced.trim(), 8).then(({ data }) => { if (!cancelled) setResults(data || []); });
    return () => { cancelled = true; };
  }, [debounced, orgId]);
  return (
    <div className="flex-1 min-w-[220px] space-y-1">
      <p className="text-xs font-medium text-secondary-600">{label}</p>
      {value ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="truncate text-secondary-900">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} className="text-xs text-secondary-500 underline">changer</button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary-400" />
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Libellé, marque, modèle…" className="w-full pl-8 pr-2 py-1.5 border border-secondary-300 rounded text-sm" />
          </div>
          {results.length > 0 && (
            <div className="border border-secondary-200 rounded divide-y divide-secondary-100 max-h-48 overflow-y-auto">
              {results.map((r) => (
                <button key={r.id} type="button" onClick={() => { onChange(r); setQ(''); setResults([]); }} className="w-full text-left px-2 py-1.5 text-sm hover:bg-secondary-50">
                  <span className="text-secondary-900">{r.name}</span>
                  <span className="text-xs text-secondary-400"> · {[r.brand, `${r.offres_actives} offre${r.offres_actives > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function HarmonisationPage() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const itemOuvert = searchParams.get('item');
  const [onglet, setOnglet] = useState('propose');
  const { stats } = useCatalogStats(orgId);
  const { proposals, isLoading } = useCatalogProposals(orgId, onglet);
  const { normalize, isNormalizing, propose, isProposing, decide, merge, isMerging } = useCatalogItemMutations(orgId);
  const [confirmTout, setConfirmTout] = useState(false);
  const [survivant, setSurvivant] = useState(null);
  const [absorbe, setAbsorbe] = useState(null);

  const ouvrir = (id) => setSearchParams(id ? { item: id } : {});

  const handleNormalize = async () => {
    try {
      const r = await normalize(100);
      if (r?.ok) {
        const m = r.matches || {};
        toast.success(`Modèles IA : ${r.poses} clé${r.poses > 1 ? 's' : ''} posée${r.poses > 1 ? 's' : ''} sur ${r.traites} lignes · ${r.restants} encore à soumettre, ${r.sans_cle_apres_ia ?? 0} sans clé après IA${m.fusionnes != null ? ` · fusions : ${m.fusionnes} d'office, ${m.proposes} à confirmer` : ''}`);
        if (r.matches_error) toast.warning(`Clés posées, mais les fusions n'ont pas été relancées (${r.matches_error}) : cliquez « Proposer les fusions ».`);
      } else toast.error(`Échec : ${r?.error || 'normalisation'}`);
    } catch (err) { toast.error(err?.message || 'Normalisation refusée'); }
  };
  const handlePropose = async () => {
    try {
      const r = await propose();
      const m = r?.resultat || {};
      toast.success(`Fusions : ${m.fusionnes ?? 0} d'office, ${m.proposes ?? 0} à confirmer`);
    } catch (err) { toast.error(err?.message || 'Proposition refusée'); }
  };
  const handleDecide = async (ids, statut) => {
    try {
      const n = await decide(ids, statut);
      toast.success(statut === 'fusionne' ? `${n} fusion${n > 1 ? 's' : ''} effectuée${n > 1 ? 's' : ''}` : `${n} proposition${n > 1 ? 's' : ''} refusée${n > 1 ? 's' : ''}`);
    } catch (err) { toast.error(err?.message || 'Décision refusée'); }
  };
  const handleMergeKeep = async (survivorId, absorbedId) => {
    try { await merge(survivorId, absorbedId); toast.success('Articles fusionnés'); }
    catch (err) { toast.error(err?.message || 'Fusion refusée'); }
  };
  const handleMergeManuel = async () => {
    if (!survivant || !absorbe || survivant.id === absorbe.id) { toast.error('Choisir deux articles différents'); return; }
    try { await merge(survivant.id, absorbe.id); toast.success(`« ${absorbe.name} » fusionné dans « ${survivant.name} »`); setSurvivant(null); setAbsorbe(null); }
    catch (err) { toast.error(err?.message || 'Fusion refusée'); }
  };

  const busy = isMerging || isProposing || isNormalizing;

  return (
    <SettingsPage title="Harmoniser les bases" description="Repérer les articles communs à plusieurs fournisseurs et les fusionner en un seul article Majord'home. Rien n'est modifié dans les catalogues fournisseurs.">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link to="/settings/suppliers" className="text-primary-700 hover:underline">← Fournisseurs</Link>
        <Link to="/settings/suppliers/articles" className="text-primary-700 hover:underline">Articles Majord&apos;home</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Compteur label="articles actifs" valeur={stats?.actifs} />
        <Compteur label="à plusieurs fournisseurs" valeur={stats?.multiOffres} />
        <Compteur label="sans clé modèle" valeur={stats?.sansCle} />
        <Compteur label="fusions à confirmer" valeur={stats?.propositions} />
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleNormalize} disabled={busy} className="btn-secondary btn-sm">
            {isNormalizing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />} Normaliser les modèles (IA)
          </button>
          <button type="button" onClick={handlePropose} disabled={busy} className="btn-secondary btn-sm">
            {isProposing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <GitMerge className="w-3.5 h-3.5 mr-1" />} Proposer les fusions
          </button>
          {onglet === 'propose' && proposals.length > 0 && (
            <button type="button" onClick={() => setConfirmTout(true)} disabled={busy} className="btn-primary btn-sm ml-auto">
              <GitMerge className="w-3.5 h-3.5 mr-1" /> Tout fusionner ({proposals.length})
            </button>
          )}
        </div>
        <p className="text-[11px] text-secondary-400">L&apos;IA lit le libellé et les caractéristiques pour poser la clé « marque + modèle » là où le relevé n&apos;en donne pas (100 lignes par clic, jamais deux fois la même). Une clé franche fusionne d&apos;office ; le reste arrive ici, à confirmer.</p>

        <div className="flex border-b border-secondary-200">
          {ONGLETS.map((o) => (
            <button key={o.key} type="button" onClick={() => setOnglet(o.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${onglet === o.key ? 'border-primary-500 text-primary-700' : 'border-transparent text-secondary-500 hover:text-secondary-700'}`}>
              {o.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary-600" /></div>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-secondary-400 text-center py-8">{onglet === 'propose' ? 'Aucune fusion en attente' : 'Rien ici'}</p>
        ) : (
          <div className="space-y-2">
            {proposals.map((p) => <ProposalRow key={p.id} proposal={p} onDecide={handleDecide} onMergeKeep={handleMergeKeep} onOpenItem={ouvrir} busy={busy} />)}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-secondary-900">Fusion manuelle</h3>
        <p className="text-xs text-secondary-500">Pour deux articles que l&apos;app n&apos;a pas rapprochés (libellés trop différents) : le second est absorbé par le premier, ses lignes fournisseur et ses lignes de devis suivent.</p>
        <div className="flex flex-wrap items-start gap-4">
          <ChoixArticle orgId={orgId} label="Article conservé" value={survivant} onChange={setSurvivant} />
          <ChoixArticle orgId={orgId} label="Article absorbé" value={absorbe} onChange={setAbsorbe} />
          <button type="button" onClick={handleMergeManuel} disabled={!survivant || !absorbe || busy} className="btn-primary btn-sm self-end">
            <GitMerge className="w-3.5 h-3.5 mr-1" /> Fusionner
          </button>
        </div>
      </div>

      <ConfirmDialog open={confirmTout} onOpenChange={setConfirmTout} title="Tout fusionner ?"
        description={`${proposals.length} proposition${proposals.length > 1 ? 's' : ''} : chaque paire est fusionnée en un seul article (le plus ancien survit). Les lignes fournisseur et les lignes de devis suivent. Une fusion se défait ensuite par « Détacher » sur la fiche article.`}
        confirmLabel="Fusionner tout" variant="default" loading={isMerging}
        onConfirm={async () => { await handleDecide(proposals.map((p) => p.id), 'fusionne'); setConfirmTout(false); }} />

      {itemOuvert && <ArticleDrawer orgId={orgId} itemId={itemOuvert} onClose={() => ouvrir(null)} />}
    </SettingsPage>
  );
}
