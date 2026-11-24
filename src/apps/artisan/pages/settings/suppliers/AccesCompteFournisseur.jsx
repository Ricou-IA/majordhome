/**
 * AccesCompteFournisseur.jsx — Identifiant et mot de passe du compte chez un fournisseur (fiche fournisseur)
 * ============================================================================
 * Demande d'Eric (2026-11-24) : avoir dans l'outil le recueil des accès aux comptes fournisseurs. Rangés dans le
 * Vault (même clé que la connexion catalogue : un fournisseur connecté se relève avec ces accès), écrits et relus par
 * un administrateur seulement (org_secret_set / supplier_credentials_reveal, vérifié en base). Le mot de passe n'est
 * affiché qu'à la demande (« Afficher ») et n'est gardé que dans l'état de ce bloc, jamais dans un cache.
 * Rendu DANS le formulaire de la fiche : aucun <form>, boutons type="button", enregistrement indépendant de la fiche.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Copy, KeyRound, Loader2, Trash2, CheckCircle2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useSupplierAccess } from '@hooks/useSuppliers';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDateShortFR } from '@/lib/utils';
import { FormField, TextInput } from '../../../components/FormFields';

const champClass = 'w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

async function copier(valeur, quoi) {
  try { await navigator.clipboard.writeText(valeur); toast.success(`${quoi} copié`); }
  catch { toast.error('Copie impossible : sélectionnez le texte à la main'); }
}

function Valeur({ libelle, valeur, secret }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-secondary-500 w-24 shrink-0">{libelle}</span>
      <span className={`text-sm text-secondary-900 break-all ${secret ? 'font-mono' : ''}`}>{valeur || '—'}</span>
      {valeur && (
        <button type="button" onClick={() => copier(valeur, libelle)} className="p-1 rounded hover:bg-secondary-100 text-secondary-500 shrink-0" aria-label={`Copier : ${libelle}`}>
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export default function AccesCompteFournisseur({ orgId, supplier }) {
  const { status, statusError, isLoadingStatus, enregistrer, supprimer, reveler, isSaving, isDeleting, isRevealing } = useSupplierAccess(orgId, supplier.id);
  const [affiches, setAffiches] = useState(null); // { identifiant, motDePasse } relus à la demande
  const [edition, setEdition] = useState(false);
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [voirSaisie, setVoirSaisie] = useState(false);
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);

  // Le mot de passe relu ne survit pas à la fermeture de la fiche.
  useEffect(() => () => setAffiches(null), []);

  const afficher = async () => {
    try {
      const v = await reveler();
      if (!v) { toast.info('Aucun accès enregistré pour ce fournisseur'); return; }
      setAffiches(v);
    } catch (err) { toast.error(err?.message?.includes('org_admin') ? 'Réservé à un administrateur' : 'Lecture des accès impossible'); }
  };

  const ouvrirEdition = () => {
    setIdentifiant(affiches?.identifiant || '');
    setMotDePasse('');
    setVoirSaisie(false);
    setEdition(true);
  };

  const enregistrerAcces = async () => {
    if (!identifiant.trim() || !motDePasse) { toast.error('Identifiant et mot de passe requis'); return; }
    try {
      await enregistrer({ email: identifiant, password: motDePasse });
      toast.success('Accès enregistrés');
      setEdition(false);
      setAffiches(null);
      setMotDePasse('');
    } catch (err) { toast.error(err?.message || 'Enregistrement des accès refusé'); }
  };

  const supprimerAcces = async () => {
    try {
      await supprimer();
      setConfirmerSuppression(false);
      setAffiches(null);
      toast.success('Accès supprimés');
    } catch (err) { toast.error(err?.message || 'Suppression refusée'); }
  };

  const enregistres = status?.exists === true;
  const lienSite = /^https?:\/\//.test(supplier.site_url || '') ? supplier.site_url : null;

  return (
    <div className="rounded-lg border border-secondary-200 bg-secondary-50/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-secondary-700 flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> Accès au compte en ligne</p>
        {lienSite && (
          <a href={lienSite} target="_blank" rel="noreferrer" className="text-xs text-primary-700 hover:underline inline-flex items-center gap-1">
            Ouvrir le site <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {isLoadingStatus ? (
        <p className="text-xs text-secondary-400">Vérification des accès…</p>
      ) : statusError ? (
        <p className="text-xs text-amber-700">Impossible de savoir si des accès sont enregistrés : {statusError.message}</p>
      ) : enregistres && !edition ? (
        <div className="space-y-2">
          <p className="text-xs text-secondary-600 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-st-ok" /> Accès enregistrés{status.updatedAt ? ` le ${formatDateShortFR(status.updatedAt)}` : ''}.
          </p>
          {affiches && (
            <div className="space-y-1 rounded-md bg-white border border-secondary-200 px-3 py-2">
              <Valeur libelle="Identifiant" valeur={affiches.identifiant} />
              <Valeur libelle="Mot de passe" valeur={affiches.motDePasse} secret />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {affiches ? (
              <button type="button" onClick={() => setAffiches(null)} className="btn-secondary btn-sm"><EyeOff className="w-4 h-4 mr-1" /> Masquer</button>
            ) : (
              <button type="button" onClick={afficher} disabled={isRevealing} className="btn-secondary btn-sm">
                {isRevealing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Eye className="w-4 h-4 mr-1" />} Afficher
              </button>
            )}
            <button type="button" onClick={ouvrirEdition} className="btn-secondary btn-sm">Modifier</button>
            <button type="button" onClick={() => setConfirmerSuppression(true)} className="btn-ghost btn-sm text-secondary-500 hover:text-red-700">
              <Trash2 className="w-4 h-4 mr-1" /> Supprimer
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Identifiant (e-mail ou n° client)">
              <TextInput value={identifiant} onChange={setIdentifiant} placeholder="compte@entreprise.fr" />
            </FormField>
            <FormField label="Mot de passe">
              <div className="relative">
                <input type={voirSaisie ? 'text' : 'password'} value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
                  autoComplete="new-password" className={`${champClass} pr-9`} />
                <button type="button" onClick={() => setVoirSaisie((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-secondary-400 hover:text-secondary-700"
                  aria-label={voirSaisie ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                  {voirSaisie ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </FormField>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={enregistrerAcces} disabled={isSaving} className="btn-secondary btn-sm">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <KeyRound className="w-4 h-4 mr-1" />} Enregistrer les accès
            </button>
            {enregistres && <button type="button" onClick={() => setEdition(false)} className="btn-ghost btn-sm">Annuler</button>}
          </div>
          <p className="text-xs text-secondary-400">Enregistrés à part de la fiche, dans le coffre chiffré ; seul un administrateur peut les relire.</p>
        </div>
      )}

      <ConfirmDialog
        open={confirmerSuppression}
        onOpenChange={setConfirmerSuppression}
        title="Supprimer les accès"
        description={`L'identifiant et le mot de passe du compte ${supplier.name} seront effacés du coffre.${supplier.connector ? ' Le relevé automatique du catalogue ne pourra plus se connecter.' : ''}`}
        confirmLabel="Supprimer"
        onConfirm={supprimerAcces}
        loading={isDeleting}
      />
    </div>
  );
}
