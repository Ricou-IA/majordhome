// src/apps/artisan/pages/settings/communication/TelephonieTab.jsx
// ============================================================================
// Settings → Communication → Agent téléphonique (/settings/telephonie) : relie
// l'agent vocal ElevenLabs de l'organisation à Majord'home.
// `settings.telephonie.elevenlabs_agent_id` est la SEULE source qui dit à l'edge
// agent-verifier-client pour quelle org l'agent répond (l'org n'est jamais lue
// dans la requête d'ElevenLabs). Spec 2026-10-04-agent-telephonique-verifier-client.
// Merge JSONB niveau 1 : on renvoie l'objet `telephonie` COMPLET.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

const AGENT_ID_RE = /^agent_[a-z0-9]+$/;

export default function TelephonieTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [agentId, setAgentId] = useState('');
  const [initial, setInitial] = useState('');

  useEffect(() => {
    const v = settings?.telephonie?.elevenlabs_agent_id ?? '';
    setAgentId(v);
    setInitial(v);
  }, [settings]);

  const valeur = agentId.trim();
  const erreur = useMemo(
    () => (valeur && !AGENT_ID_RE.test(valeur) ? 'Identifiant attendu de la forme agent_xxxxxxxx' : null),
    [valeur],
  );
  const isDirty = valeur !== initial;

  const handleSave = async () => {
    if (erreur) return;
    try {
      await save({ telephonie: { ...(settings?.telephonie || {}), elevenlabs_agent_id: valeur || null } });
      toast.success('Agent téléphonique enregistré');
      setInitial(valeur);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    }
  };

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <div className="card space-y-6">
      <section>
        <h3 className={SECTION_TITLE}>Agent vocal ElevenLabs</h3>
        <label className={LABEL_CLASS} htmlFor="elevenlabs-agent-id">Identifiant de l&apos;agent</label>
        <input
          id="elevenlabs-agent-id"
          type="text"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          placeholder="agent_3101m42037pbepbvh52d81h8nn8w"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
        {erreur && <p className={ERROR_CLASS}>{erreur}</p>}
        <p className={HINT_CLASS}>
          Visible dans ElevenLabs, sur la page de l&apos;agent. Sans cet identifiant, l&apos;agent ne reconnaît aucun
          client : chaque appelant est traité comme un nouveau client.
        </p>
      </section>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !!erreur || isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
