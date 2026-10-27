// src/apps/artisan/pages/settings/team/PasswordResetSection.jsx
// ============================================================================
// « Réinitialiser le mot de passe » d'un membre (fiche membre, org_admin seul).
// Les e-mails des membres sont souvent factices : le lien « Mot de passe oublié »
// de l'écran de connexion ne leur sert à rien. L'admin saisit ou fait générer un
// mot de passe provisoire, confirme, l'app le pose côté serveur (edge
// member-reset-password) et l'affiche UNE fois pour qu'il soit transmis de vive
// voix. Rien n'est stocké : tout vit dans l'état de ce composant, perdu à la
// fermeture de la fiche.
// ============================================================================
import { useState } from 'react';
import { KeyRound, RefreshCw, Copy, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { generateTemporaryPassword } from '@/lib/temporaryPassword';

const MIN_LENGTH = 8;

/**
 * @param {object} props
 * @param {string} props.memberName
 * @param {(password: string) => Promise<unknown>} props.onReset - rejette en cas de refus
 * @param {boolean} props.isResetting
 */
export function PasswordResetSection({ memberName, onReset, isResetting }) {
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [issued, setIssued] = useState(null); // mot de passe posé, affiché une seule fois
  const [copied, setCopied] = useState(false);

  const tooShort = draft.length < MIN_LENGTH;

  const handleConfirm = async () => {
    try {
      await onReset(draft);
      setIssued(draft);
      setDraft('');
      setCopied(false);
      setConfirming(false);
      toast.success(`Mot de passe de ${memberName} réinitialisé`);
    } catch (err) {
      toast.error(err?.message || 'Erreur lors de la réinitialisation du mot de passe');
    }
  };

  const copyIssued = async () => {
    try {
      await navigator.clipboard.writeText(issued);
      setCopied(true);
      toast.success('Mot de passe copié');
    } catch {
      toast.error('Copie impossible : recopiez le mot de passe à la main');
    }
  };

  return (
    <div className="space-y-3">
      {issued && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <p className="text-xs text-amber-800">
            Mot de passe provisoire de <strong>{memberName}</strong> — à lui transmettre de vive voix.
            Il ne sera plus affiché après la fermeture de cette fiche.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-1.5 rounded-md bg-white border border-amber-200 font-mono text-base tracking-wider text-secondary-900 select-all">
              {issued}
            </code>
            <button
              type="button"
              onClick={copyIssued}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Mot de passe provisoire"
          autoComplete="off"
          spellCheck={false}
          disabled={isResetting}
          aria-label="Mot de passe provisoire"
          className="w-56 px-3 py-1.5 text-sm font-mono border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setDraft(generateTemporaryPassword())}
          disabled={isResetting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-secondary-300 text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4" /> Générer
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={tooShort || isResetting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          Réinitialiser le mot de passe
        </button>
      </div>
      {draft && tooShort && (
        <p className="text-xs text-secondary-400">{MIN_LENGTH} caractères minimum.</p>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => { if (!open && !isResetting) setConfirming(false); }}
        title="Réinitialiser le mot de passe"
        description={`Le mot de passe de ${memberName} sera remplacé par celui saisi et ses sessions ouvertes seront déconnectées. Il vous sera affiché une seule fois, pour le lui transmettre.`}
        confirmLabel="Réinitialiser"
        variant="default"
        onConfirm={handleConfirm}
        loading={isResetting}
      />
    </div>
  );
}

export default PasswordResetSection;
