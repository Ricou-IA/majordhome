// src/apps/artisan/pages/settings/suppliers/CatalogConnectorPanel.jsx
// Panneau « Connexion catalogue » en tête du catalogue d'un fournisseur connecté (suppliers.connector) :
//   - baywa : identifiants du compte (Vault, jamais ré-affichés), « Actualiser le catalogue » (l'edge se connecte
//     et relève l'API BayWa), « Importer un relevé » en repli si BayWa refuse la connexion serveur ;
//   - domos : « Importer un relevé » seul (site derrière Cloudflare : relevé depuis le navigateur connecté).
// Visible org_admin seul. Résultat du dernier relevé = suppliers.catalog_sync_result (libelleResultat).
// Spec : docs/superpowers/specs/2026-10-24-module-batterie-catalogue-baywa-design.md § 7.
import { useRef, useState } from 'react';
import { KeyRound, RefreshCw, Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useSuppliers, useSupplierConnector } from '@hooks/useSuppliers';
import { libelleResultat, libelleCodeErreur } from '@/lib/catalogue/syncResult.js';
import { formatDateShortFR } from '@/lib/utils';
import { FormField, TextInput } from '../../../components/FormFields';

const SCRIPTS_RELEVE = {
  baywa: 'scripts/catalogue/dump-baywa.browser.js',
  domos: 'scripts/catalogue/dump-domos.browser.js',
};

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
      <FormField label="E-mail du compte BayWa">
        <TextInput value={email} onChange={setEmail} type="email" placeholder="compte@entreprise.fr" />
      </FormField>
      <FormField label="Mot de passe">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </FormField>
      <div className="flex gap-2">
        <button type="submit" disabled={isSaving} className="btn-primary btn-sm">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <KeyRound className="w-4 h-4 mr-1" />}
          Enregistrer
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-secondary btn-sm">Annuler</button>}
      </div>
    </form>
  );
}

export default function CatalogConnectorPanel({ supplier, orgId }) {
  const { isOrgAdmin } = useAuth();
  // La liste est invalidée après chaque relevé : on y relit le fournisseur (catalog_sync_result frais),
  // l'objet reçu en prop est celui sélectionné avant le relevé.
  const { suppliers } = useSuppliers(orgId);
  const frais = suppliers.find((s) => s.id === supplier?.id) || supplier;
  const { status, isLoadingStatus, saveCredentials, sync, importReleve, isSaving, isSyncing, isImporting } = useSupplierConnector(orgId, frais);
  const [replacing, setReplacing] = useState(false);
  const fileRef = useRef(null);

  if (!isOrgAdmin || !frais?.connector) return null;
  const connector = frais.connector;
  const estBaywa = connector === 'baywa';
  const result = frais.catalog_sync_result;

  const handleSave = async (creds) => {
    try {
      await saveCredentials(creds);
      setReplacing(false);
      toast.success('Identifiants enregistrés');
    } catch (err) {
      toast.error(err?.message || 'Impossible d\'enregistrer les identifiants');
    }
  };

  const annoncer = (data, verbe) => {
    if (data?.ok) {
      const r = data.resultat || {};
      toast.success(`${verbe} : ${r.total ?? '?'} articles (${r.inseres ?? 0} nouveaux, ${r.desactives ?? 0} désactivés)`);
    } else {
      toast.error(`Échec : ${libelleCodeErreur(data?.code)}`);
    }
  };

  const handleSync = async () => {
    try {
      annoncer(await sync(), 'Catalogue actualisé');
    } catch (err) {
      toast.error(err?.message || 'Le relevé a échoué');
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try {
      const releve = JSON.parse(await file.text());
      annoncer(await importReleve(releve), 'Relevé importé');
    } catch (err) {
      toast.error(err?.message || 'Fichier de relevé illisible');
    }
  };

  const busy = isSyncing || isImporting;

  return (
    <div className="rounded-xl border border-secondary-200 bg-secondary-50/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-secondary-900">
            Connexion catalogue — {estBaywa ? 'BayWa r.e. (relevé automatique)' : 'Domos Industries (relevé manuel)'}
          </h3>
          <p className="text-xs text-secondary-500 mt-0.5">
            {estBaywa
              ? 'Le catalogue est relevé chaque nuit avec les identifiants du compte BayWa. Les prix de vente saisis ici ne sont jamais écrasés.'
              : 'Le site Domos est protégé par Cloudflare : relevez le catalogue depuis votre navigateur connecté, puis importez le fichier.'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {estBaywa && status?.exists && (
            <button type="button" onClick={handleSync} disabled={busy} className="btn-primary btn-sm">
              {isSyncing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
              Actualiser le catalogue
            </button>
          )}
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFile} className="hidden" />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn-secondary btn-sm">
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
            Importer un relevé
          </button>
        </div>
      </div>

      {estBaywa && (
        isLoadingStatus ? (
          <p className="text-xs text-secondary-400">Vérification des identifiants…</p>
        ) : status?.exists && !replacing ? (
          <p className="text-xs text-secondary-600 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Identifiants enregistrés{status.updatedAt ? ` le ${formatDateShortFR(status.updatedAt)}` : ''}.
            <button type="button" onClick={() => setReplacing(true)} className="underline text-secondary-500 hover:text-secondary-800">Remplacer</button>
          </p>
        ) : (
          <CredentialsForm onSave={handleSave} isSaving={isSaving} onCancel={status?.exists ? () => setReplacing(false) : null} />
        )
      )}

      <p className={`text-xs flex items-center gap-1.5 ${result && result.ok === false ? 'text-amber-700' : 'text-secondary-600'}`}>
        {result && result.ok === false ? <AlertTriangle className="w-3.5 h-3.5" /> : null}
        {libelleResultat(result)}
      </p>
      <p className="text-[11px] text-secondary-400">
        Relevé manuel : coller <code className="font-mono">{SCRIPTS_RELEVE[connector]}</code> dans la console du navigateur une fois connecté au site du fournisseur, puis importer le fichier téléchargé.
      </p>
    </div>
  );
}
