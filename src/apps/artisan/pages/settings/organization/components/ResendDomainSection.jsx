/**
 * ResendDomainSection.jsx
 * ============================================================================
 * Onboarding du domaine d'envoi d'une org dans le compte Resend partagé
 * (app-level). Le domaine est dérivé de settings.from_email (org-level).
 *
 * Flux : Configurer (crée le domaine côté Resend → records DNS) → l'admin
 * publie les records chez son registrar → Vérifier (Resend valide le DNS).
 *
 * L'edge `resend-domain-onboard` est un proxy mince ; ce composant persiste
 * le résultat dans settings.resend via useOrgSettings().save() (cache d'affichage).
 * ============================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Copy, Check, RefreshCw, ShieldCheck, AlertTriangle, Globe } from 'lucide-react';
import { supabase } from '@lib/supabaseClient';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-1';
const HINT_CLASS = 'text-xs text-secondary-500';

const STATUS_META = {
  not_started: { label: 'Non configuré', cls: 'bg-secondary-100 text-secondary-600' },
  pending: { label: 'En attente de vérification', cls: 'bg-amber-100 text-amber-700' },
  verified: { label: 'Vérifié', cls: 'bg-green-100 text-green-700' },
  failed: { label: 'Échec de vérification', cls: 'bg-red-100 text-red-700' },
  temporary_failure: { label: 'Échec temporaire', cls: 'bg-amber-100 text-amber-700' },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.pending;
}

/**
 * Appelle l'edge `resend-domain-onboard` et remonte le message d'erreur
 * détaillé (le corps de la réponse non-2xx est dans error.context).
 */
async function callResendDomain(action, orgId) {
  const { data, error } = await supabase.functions.invoke('resend-domain-onboard', {
    body: { action, org_id: orgId },
  });
  if (error) {
    let detail = error.message;
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        if (body?.error) detail = body.error;
      }
    } catch {
      /* garde le message générique */
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copie impossible');
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 p-1 text-secondary-400 hover:text-primary-600 transition-colors"
      title="Copier"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function RecordsTable({ records }) {
  if (!records?.length) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-secondary-200">
      <table className="w-full text-xs">
        <thead className="bg-secondary-50 text-secondary-500">
          <tr>
            <th className="text-left font-medium px-3 py-2">Type</th>
            <th className="text-left font-medium px-3 py-2">Nom / Hôte</th>
            <th className="text-left font-medium px-3 py-2">Valeur</th>
            <th className="text-left font-medium px-3 py-2">Priorité</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-secondary-100">
          {records.map((r, i) => (
            <tr key={`${r.type}-${r.name}-${i}`} className="align-top">
              <td className="px-3 py-2 whitespace-nowrap font-mono text-secondary-700">{r.type}</td>
              <td className="px-3 py-2">
                <div className="flex items-start gap-1">
                  <span className="font-mono break-all text-secondary-700">{r.name}</span>
                  <CopyButton value={r.name} />
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-start gap-1">
                  <span className="font-mono break-all text-secondary-700">{r.value}</span>
                  <CopyButton value={r.value} />
                </div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-secondary-500">{r.priority ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ResendDomainSection() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { settings, save } = useOrgSettings();

  const fromEmail = (settings.from_email || '').trim();
  const domain = fromEmail.includes('@') ? fromEmail.split('@')[1].toLowerCase() : '';

  const [data, setData] = useState(settings.resend || null);
  const [busy, setBusy] = useState(null); // 'setup' | 'verify' | 'status' | null
  const [err, setErr] = useState(null);
  const mountChecked = useRef(false);

  // Resync l'affichage quand le cache settings.resend change (save / refetch)
  useEffect(() => {
    setData(settings.resend || null);
  }, [settings.resend]);

  const run = useCallback(
    async (action, { persist = false } = {}) => {
      if (!orgId) return;
      setBusy(action);
      setErr(null);
      try {
        const res = await callResendDomain(action, orgId);
        setData(res);
        if (persist) {
          await save({ resend: { ...res, checked_at: new Date().toISOString() } });
        }
        if (action === 'setup') {
          toast.success('Domaine ajouté — publie les records DNS ci-dessous puis vérifie.');
        } else if (action === 'verify') {
          if (res.status === 'verified') toast.success('Domaine vérifié ✓');
          else toast('Vérification lancée — la propagation DNS peut prendre quelques minutes.');
        }
      } catch (e) {
        setErr(e.message);
        toast.error(e.message);
      } finally {
        setBusy(null);
      }
    },
    [orgId, save],
  );

  // Au montage : rafraîchir le statut si déjà configuré (affichage seul, pas de save)
  useEffect(() => {
    if (mountChecked.current) return;
    mountChecked.current = true;
    if (settings.resend?.id && domain && orgId) {
      run('status');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, domain]);

  const status = data?.status || 'not_started';
  const meta = statusMeta(status);
  const isVerified = status === 'verified';
  const isConfigured = !!data?.id;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-secondary-400" />
          <h3 className={SECTION_TITLE + ' mb-0'}>Domaine d'envoi (Resend)</h3>
        </div>
        {domain && (
          <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${meta.cls}`}>
            {meta.label}
          </span>
        )}
      </div>

      {!domain ? (
        <p className={HINT_CLASS}>
          Renseigne et enregistre d'abord l'<strong>email expéditeur</strong> ci-dessus. Le domaine
          d'envoi en sera dérivé, puis tu pourras le vérifier ici.
        </p>
      ) : (
        <>
          <p className={HINT_CLASS}>
            Pour envoyer des emails depuis <span className="font-mono">@{domain}</span>, ce domaine
            doit être vérifié dans Resend (DKIM/SPF). Configure-le, publie les enregistrements DNS
            chez ton registrar (OVH, Gandi, Cloudflare…), puis lance la vérification.
          </p>

          {/* Domaine vérifié */}
          {isVerified && (
            <div className="flex items-start gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
              <ShieldCheck className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <p className="text-xs text-green-800">
                <strong>{domain}</strong> est vérifié — l'org peut envoyer ses campagnes.
              </p>
            </div>
          )}

          {/* Pas encore configuré → bouton Configurer */}
          {!isConfigured && (
            <button
              type="button"
              onClick={() => run('setup', { persist: true })}
              disabled={busy != null}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {busy === 'setup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
              Configurer {domain}
            </button>
          )}

          {/* Configuré mais pas vérifié → records + actions */}
          {isConfigured && !isVerified && (
            <div className="space-y-3">
              <p className={HINT_CLASS}>
                Ajoute ces enregistrements DNS, puis clique « Vérifier ». La propagation DNS peut
                prendre de quelques minutes à 48 h.
              </p>
              <RecordsTable records={data.records} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => run('verify', { persist: true })}
                  disabled={busy != null}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {busy === 'verify' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Vérifier
                </button>
                <button
                  type="button"
                  onClick={() => run('status', { persist: true })}
                  disabled={busy != null}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50"
                >
                  {busy === 'status' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Rafraîchir
                </button>
              </div>
            </div>
          )}

          {/* Re-vérifier même si vérifié (au cas où le DNS change) */}
          {isVerified && (
            <button
              type="button"
              onClick={() => run('status', { persist: true })}
              disabled={busy != null}
              className="inline-flex items-center gap-1.5 text-xs text-secondary-500 hover:text-secondary-700"
            >
              {busy === 'status' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Rafraîchir le statut
            </button>
          )}

          {err && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-xs text-red-700">{err}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
