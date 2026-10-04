// src/apps/artisan/pages/settings/communication/TelephonieTab.jsx
// ============================================================================
// Settings → Communication → Agent téléphonique (/settings/telephonie) : relie
// l'agent vocal ElevenLabs de l'organisation à Majord'home.
// `settings.telephonie.elevenlabs_agent_id` est la SEULE source qui dit aux edges de
// l'agent pour quelle org il répond (l'org n'est jamais lue dans la requête d'ElevenLabs).
// Spec 2026-10-04-agent-telephonique-verifier-client.
// `settings.telephonie.message_accueil` : premier message de l'agent, que le webhook
// d'accueil (edge agent-accueil) personnalise pour un appel Twilio en remplaçant son
// « Bonjour » initial par « Bonjour Jean Dupont » (spec 2026-10-04 reconnaissance par
// numéro). Vide → accueil toujours neutre.
// Merge JSONB niveau 1 : on renvoie l'objet `telephonie` COMPLET.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500';
const TEXTAREA_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

const AGENT_ID_RE = /^agent_[a-z0-9]+$/;
// Même règle que messageAccueilPersonnalise (src/lib/agentTelephonique.js) : le message
// doit commencer par le mot « Bonjour », que le webhook remplace par la salutation.
const COMMENCE_PAR_BONJOUR = /^Bonjour(?![\p{L}])/u;

/** Proposition quand rien n'est saisi : à aligner sur le premier message de l'agent. */
function messageSuggere(settings) {
  const marque = settings?.brand_name?.trim();
  return `Bonjour, ${marque || 'votre entreprise'}, je suis l'assistante virtuelle. Cet appel peut être enregistré pour le suivi de votre demande. Quel est l'objet de votre appel ?`;
}

export default function TelephonieTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [agentId, setAgentId] = useState('');
  const [message, setMessage] = useState('');
  const [initial, setInitial] = useState({ agentId: '', message: '' });

  useEffect(() => {
    const id = settings?.telephonie?.elevenlabs_agent_id ?? '';
    const msg = settings?.telephonie?.message_accueil ?? '';
    setAgentId(id);
    setMessage(msg || messageSuggere(settings));
    setInitial({ agentId: id, message: msg });
  }, [settings]);

  const valeur = agentId.trim();
  const texteAccueil = message.trim();
  const erreur = useMemo(
    () => (valeur && !AGENT_ID_RE.test(valeur) ? 'Identifiant attendu de la forme agent_xxxxxxxx' : null),
    [valeur],
  );
  const erreurMessage = useMemo(
    () => (texteAccueil && !COMMENCE_PAR_BONJOUR.test(texteAccueil) ? 'Le message doit commencer par « Bonjour »' : null),
    [texteAccueil],
  );
  const isDirty = valeur !== initial.agentId || texteAccueil !== initial.message;

  const handleSave = async () => {
    if (erreur || erreurMessage) return;
    try {
      await save({
        telephonie: {
          ...(settings?.telephonie || {}),
          elevenlabs_agent_id: valeur || null,
          message_accueil: texteAccueil || null,
        },
      });
      toast.success('Agent téléphonique enregistré');
      setInitial({ agentId: valeur, message: texteAccueil });
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

      <section>
        <h3 className={SECTION_TITLE}>Accueil personnalisé</h3>
        <label className={LABEL_CLASS} htmlFor="message-accueil">Message d&apos;accueil</label>
        <textarea
          id="message-accueil"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={TEXTAREA_CLASS}
        />
        {erreurMessage && <p className={ERROR_CLASS}>{erreurMessage}</p>}
        <p className={HINT_CLASS}>
          Recopiez ici le premier message de l&apos;agent dans ElevenLabs, à l&apos;identique. Quand un client appelle
          depuis le numéro de sa fiche, « Bonjour » devient « Bonjour Jean Dupont » (ou « Bonjour Madame, Monsieur
          Dupont » pour un couple). Vide : l&apos;accueil reste neutre.
        </p>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !!erreur || !!erreurMessage || isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
