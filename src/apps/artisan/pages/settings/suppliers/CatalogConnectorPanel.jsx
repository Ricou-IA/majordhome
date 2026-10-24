// src/apps/artisan/pages/settings/suppliers/CatalogConnectorPanel.jsx
// Panneau « Connexion catalogue » en tête du catalogue d'un fournisseur connecté (suppliers.connector = plateforme) :
//   - identifiants du compte (Vault, jamais ré-affichés) pour toute plateforme connue, « Actualiser le catalogue »
//     (l'edge se connecte au site et relève), case « Relevé automatique chaque nuit » (auto_sync),
//     « Importer un relevé » (fichier JSON du script de console) en repli ou pour un site derrière Cloudflare ;
//   - deux lignes d'état : dernier relevé réussi, dernière erreur ;
//   - tableau de correspondance des catégories du site (→ Batterie / Photovoltaïque / Borne de recharge / Exclure)
//     avec « Appliquer la correspondance » (jamais appliqué pendant le relevé) ;
//   - « Normaliser les modèles (IA) », « Rapprocher », lien vers la page Rapprochements, « Supprimer les identifiants ».
// Visible org_admin seul. Spec : 2026-10-24-catalogue-photovoltaique-connexion-generique-design.md § 3.1, § 6, § 7.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, RefreshCw, Upload, Loader2, CheckCircle2, AlertTriangle, Sparkles, Link2, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useSuppliers, useSupplierConnector, useSupplierMutations } from '@hooks/useSuppliers';
import { libelleResultat, libelleCodeErreur } from '@/lib/catalogue/syncResult.js';
import { CIBLES, CLE_SANS_CATEGORIE, DEFAUTS_MAPPING, CLE_DEFAUT } from '@/lib/catalogue/mapping.js';
import { formatDateShortFR } from '@/lib/utils';
import { FormField, TextInput } from '../../../components/FormFields';

const PLATEFORMES = {
  suitecommerce: { libelle: 'NetSuite SuiteCommerce (compatible BayWa)', script: 'scripts/catalogue/dump-suitecommerce.browser.js', auto: true },
  woocommerce: { libelle: 'WooCommerce', script: 'scripts/catalogue/dump-woocommerce.browser.js', auto: true },
};
const CIBLE_LABELS = { batterie: 'Batterie', photovoltaique: 'Photovoltaïque', borne_recharge: 'Borne de recharge', exclure: 'Exclure' };

function CredentialsForm({ onSave, isSaving, onCancel }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) { toast.error('E-mail et mot de passe requis'); return; }
    await onSave({ email, password });
    setPassword('');
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
      <FormField label="E-mail du compte fournisseur">
        <TextInput value={email} onChange={setEmail} type="email" placeholder="compte@entreprise.fr" />
      </FormField>
      <FormField label="Mot de passe">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
          className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </FormField>
      <div className="flex gap-2">
        <button type="submit" disabled={isSaving} className="btn-primary btn-sm">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <KeyRound className="w-4 h-4 mr-1" />} Enregistrer
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-secondary btn-sm">Annuler</button>}
      </div>
    </form>
  );
}

/** Cible par défaut d'une clé de catégorie du site (défauts de la plateforme). */
function cibleDefaut(plateforme, cle) {
  const d = DEFAUTS_MAPPING[plateforme] || {};
  return d[cle] || d[CLE_DEFAUT] || 'photovoltaique';
}

export default function CatalogConnectorPanel({ supplier, orgId }) {
  const { isOrgAdmin } = useAuth();
  const { suppliers } = useSuppliers(orgId);
  const frais = suppliers.find((s) => s.id === supplier?.id) || supplier;
  const { updateSupplier, isUpdating } = useSupplierMutations(orgId);
  const {
    status, isLoadingStatus, saveCredentials, deleteCredentials, sync, importReleve, applyMapping, normalize, proposeMatches,
    isSaving, isSyncing, isImporting, isApplyingMapping, isNormalizing, isProposing,
  } = useSupplierConnector(orgId, frais);
  const [replacing, setReplacing] = useState(false);
  const [mapping, setMapping] = useState({});
  const fileRef = useRef(null);

  useEffect(() => { setMapping(frais?.category_mapping || {}); }, [frais?.id, frais?.category_mapping]);

  const plateforme = frais?.connector ? PLATEFORMES[frais.connector] : null;
  const categoriesVues = useMemo(() => {
    const vues = frais?.catalog_sync_result?.categories_vues;
    return Array.isArray(vues) ? [...vues].sort((a, b) => (b.nombre || 0) - (a.nombre || 0)) : [];
  }, [frais?.catalog_sync_result]);
  const mappingModifie = JSON.stringify(mapping) !== JSON.stringify(frais?.category_mapping || {});

  if (!isOrgAdmin || !frais?.connector) return null;
  const result = frais.catalog_sync_result;
  const erreur = frais.catalog_sync_error;
  const busy = isSyncing || isImporting || isApplyingMapping || isNormalizing || isProposing;

  const annoncer = (data, verbe) => {
    if (data?.ok) {
      const r = data.resultat || {};
      const m = r.matches ? ` · rapprochements : ${r.matches.confirmes ?? 0} confirmés, ${r.matches.proposes ?? 0} à confirmer` : '';
      toast.success(`${verbe} : ${r.total ?? '?'} articles (${r.inseres ?? 0} nouveaux, ${r.desactives ?? 0} désactivés)${m}`);
    } else {
      toast.error(`Échec : ${libelleCodeErreur(data?.code)}`);
    }
  };
  const handleSave = async (creds) => {
    try { await saveCredentials(creds); setReplacing(false); toast.success('Identifiants enregistrés'); }
    catch (err) { toast.error(err?.message || 'Impossible d\'enregistrer les identifiants'); }
  };
  const handleDelete = async () => {
    if (!window.confirm('Supprimer les identifiants enregistrés pour ce fournisseur ?')) return;
    try { await deleteCredentials(); if (frais.auto_sync) await updateSupplier(frais.id, { autoSync: false }); toast.success('Identifiants supprimés'); }
    catch (err) { toast.error(err?.message || 'Suppression refusée'); }
  };
  const handleSync = async () => {
    try { annoncer(await sync(), 'Catalogue actualisé'); }
    catch (err) { toast.error(err?.message || 'Le relevé a échoué'); }
  };
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try { annoncer(await importReleve(JSON.parse(await file.text())), 'Relevé importé'); }
    catch (err) { toast.error(err?.message || 'Fichier de relevé illisible'); }
  };
  const handleAutoSync = async (coche) => {
    try { await updateSupplier(frais.id, { autoSync: coche }); toast.success(coche ? 'Relevé automatique activé (chaque nuit)' : 'Relevé automatique désactivé'); }
    catch (err) { toast.error(err?.message || 'Réglage refusé'); }
  };
  const handleMapping = async () => {
    try {
      await updateSupplier(frais.id, { categoryMapping: mapping });
      const r = await applyMapping();
      const manuels = r?.ignores_manuels ? `, ${r.ignores_manuels} corrigé${r.ignores_manuels > 1 ? 's' : ''} à la main non touché${r.ignores_manuels > 1 ? 's' : ''}` : '';
      toast.success(`Correspondance appliquée : ${r?.reclasses ?? 0} reclassés, ${r?.exclus ?? 0} exclus, ${r?.reactives ?? 0} réactivés${manuels}`);
    } catch (err) { toast.error(err?.message || 'Application refusée'); }
  };
  const handleNormalize = async () => {
    try {
      const r = await normalize(100);
      if (r?.ok) toast.success(`Modèles IA : ${r.poses} clé${r.poses > 1 ? 's' : ''} posée${r.poses > 1 ? 's' : ''} sur ${r.traites} articles · ${r.restants} encore à soumettre, ${r.sans_cle_apres_ia ?? 0} sans clé après IA (à saisir à la main)`);
      else toast.error(`Échec : ${r?.error || 'normalisation'}`);
    } catch (err) { toast.error(err?.message || 'Normalisation refusée'); }
  };
  const handlePropose = async () => {
    try {
      const r = await proposeMatches();
      const m = r?.resultat || {};
      toast.success(`Rapprochements : ${m.confirmes ?? 0} confirmés d'office, ${m.proposes ?? 0} à confirmer`);
    } catch (err) { toast.error(err?.message || 'Rapprochement refusé'); }
  };

  return (
    <div className="rounded-xl border border-secondary-200 bg-secondary-50/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-secondary-900">Connexion catalogue — {plateforme?.libelle || frais.connector}</h3>
          <p className="text-xs text-secondary-500 mt-0.5">
            {frais.site_url ? <a href={frais.site_url} target="_blank" rel="noreferrer" className="underline">{frais.site_url}</a> : <span className="text-amber-700">Renseignez l&apos;adresse du site dans la fiche fournisseur.</span>}
            {' '}Les prix de vente, libellés, catégories et photos que vous corrigez ne sont jamais écrasés par un relevé.
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          {status?.exists && frais.site_url && (
            <button type="button" onClick={handleSync} disabled={busy} className="btn-primary btn-sm">
              {isSyncing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />} Actualiser le catalogue
            </button>
          )}
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFile} className="hidden" />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn-secondary btn-sm">
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />} Importer un relevé
          </button>
        </div>
      </div>

      {isLoadingStatus ? (
        <p className="text-xs text-secondary-400">Vérification des identifiants…</p>
      ) : status?.exists && !replacing ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary-600">
          <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Identifiants enregistrés{status.updatedAt ? ` le ${formatDateShortFR(status.updatedAt)}` : ''}.</span>
          <button type="button" onClick={() => setReplacing(true)} className="underline text-secondary-500 hover:text-secondary-800">Remplacer</button>
          <button type="button" onClick={handleDelete} className="underline text-secondary-500 hover:text-red-700 inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Supprimer les identifiants</button>
          {plateforme?.auto && (
            <label className="flex items-center gap-1.5 ml-auto">
              <input type="checkbox" checked={!!frais.auto_sync} disabled={isUpdating} onChange={(e) => handleAutoSync(e.target.checked)} />
              Relevé automatique chaque nuit
            </label>
          )}
        </div>
      ) : (
        <CredentialsForm onSave={handleSave} isSaving={isSaving} onCancel={status?.exists ? () => setReplacing(false) : null} />
      )}

      <div className="space-y-0.5">
        <p className="text-xs text-secondary-600">{libelleResultat(result)}</p>
        {erreur && erreur.ok === false && (
          <p className="text-xs text-amber-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {libelleResultat(erreur)}</p>
        )}
      </div>

      {categoriesVues.length > 0 && (
        <details className="rounded-lg border border-secondary-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-secondary-700">
            Correspondance des catégories du site ({categoriesVues.length}) — où ranger chaque rayon
          </summary>
          <div className="px-3 pb-3 space-y-2">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-secondary-400"><th className="py-1 font-medium">Catégorie du site</th><th className="py-1 font-medium text-right">Articles</th><th className="py-1 font-medium pl-3">Rangée en</th></tr></thead>
              <tbody>
                {categoriesVues.map((c) => {
                  const valeur = mapping[c.cle] || '';
                  return (
                    <tr key={c.cle} className="border-t border-secondary-100">
                      <td className="py-1 text-secondary-800">{c.libelle || c.cle}{c.parent ? <span className="text-secondary-400"> · {c.parent}</span> : null}{c.cle === CLE_SANS_CATEGORIE ? <span className="text-secondary-400"> (articles sans rayon)</span> : null}</td>
                      <td className="py-1 text-right text-secondary-500">{c.nombre}</td>
                      <td className="py-1 pl-3">
                        <select value={valeur} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[c.cle] = e.target.value; else delete n[c.cle]; return n; })}
                          className="border border-secondary-300 rounded px-1.5 py-0.5 text-xs">
                          <option value="">Défaut ({CIBLE_LABELS[cibleDefaut(frais.connector, c.cle)]})</option>
                          {CIBLES.map((t) => <option key={t} value={t}>{CIBLE_LABELS[t]}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleMapping} disabled={busy || isUpdating || !mappingModifie && !Object.keys(mapping).length} className="btn-secondary btn-sm">
                {isApplyingMapping ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />} Appliquer la correspondance
              </button>
              <span className="text-[11px] text-secondary-400">Reclasse les articles relevés de ces rayons ; un article corrigé à la main dans un autre rayon n&apos;est pas touché.</span>
            </div>
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={handleNormalize} disabled={busy} className="btn-secondary btn-sm">
          {isNormalizing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />} Normaliser les modèles (IA)
        </button>
        <button type="button" onClick={handlePropose} disabled={busy} className="btn-secondary btn-sm">
          {isProposing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Link2 className="w-3.5 h-3.5 mr-1" />} Rapprocher
        </button>
        <Link to="/settings/suppliers/rapprochements" className="text-xs text-primary-700 hover:underline">Rapprochements à confirmer →</Link>
        <span className="ml-auto text-[11px] text-secondary-400">Relevé manuel : coller <code className="font-mono">{plateforme?.script}</code> dans la console du navigateur connecté, puis importer le fichier.</span>
      </div>
    </div>
  );
}
