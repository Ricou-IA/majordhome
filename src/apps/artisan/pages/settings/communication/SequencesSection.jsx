/**
 * SequencesSection.jsx — « E-mails envoyés tout seuls à vos prospects » (Réglages → E-mails & SMS)
 * ============================================================================
 * Une ligne par séquence de `src/lib/sequencesEmails.js` : interrupteur, délai en
 * jours, « Envoyer un essai », « Modifier le texte ». Allumer crée la campagne
 * automatique et son segment (ou reprend ceux que l'entreprise a déjà) ; le cron
 * `mailing-scheduler` envoie. L'état se lit dans les listes de campagnes et de
 * segments : tant qu'elles sont inconnues (chargement, échec), rien n'est modifiable
 * — on ne crée pas une seconde campagne sur une lecture ratée.
 * ============================================================================
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useMailCampaigns, mailCampaignKeys } from '@hooks/useMailCampaigns';
import { useMailSegments, mailSegmentKeys } from '@hooks/useMailSegments';
import { useLeadStatuses } from '@hooks/useLeads';
import { SEQUENCES_EMAILS, etatSequence, phraseDelai, lireSaisieDelai, DELAI_MIN_JOURS, DELAI_MAX_JOURS } from '@/lib/sequencesEmails';
import EmailAutoLigne from './EmailAutoLigne';
import { allumerSequence, eteindreSequence, reglerDelaiSequence } from './sequencesActions';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

function LigneSequence({ orgId, sequence, campagnes, segments, statutId, pret, apresEcriture }) {
  const campagne = campagnes.find((c) => c.key === sequence.gabarit.key && !c.is_archived) ?? null;
  const segment = segments.find((s) => s.id === campagne?.auto_segment_id) ?? null;
  const etat = etatSequence(sequence, campagne, segment);
  const [saisie, setSaisie] = useState(null); // délai en cours de frappe ; null = valeur enregistrée
  const [enCours, setEnCours] = useState(false);
  const delaiAffiche = saisie ?? (etat.delai ?? '');
  const bloque = !pret || enCours || !statutId;

  const ecrire = async (geste, message) => {
    setEnCours(true);
    try {
      await geste();
      await apresEcriture();
      toast.success(message);
    } catch (err) {
      toast.error(err.message || 'Enregistrement échoué');
    } finally {
      setEnCours(false);
    }
  };

  const basculer = () => {
    if (bloque) return;
    if (etat.allumee) return ecrire(() => eteindreSequence(campagne), `« ${sequence.titre} » : arrêté`);
    const delai = sequence.repere ? lireSaisieDelai(delaiAffiche) : null;
    if (sequence.repere && delai === null) {
      toast.error(`Le délai est un nombre de jours, de ${DELAI_MIN_JOURS} à ${DELAI_MAX_JOURS}.`);
      return undefined;
    }
    return ecrire(
      () => allumerSequence({ orgId, sequence, campagnes, segments, statutId, delai }),
      `« ${sequence.titre} » : activé`,
    );
  };

  const validerDelai = () => {
    if (saisie === null) return;
    const delai = lireSaisieDelai(saisie);
    if (delai === null) {
      toast.error(`Le délai est un nombre de jours, de ${DELAI_MIN_JOURS} à ${DELAI_MAX_JOURS}.`);
      setSaisie(null);
      return;
    }
    // Sans segment (jamais allumée), le délai saisi sert à l'allumage : rien à enregistrer encore.
    if (!segment || delai === etat.delai) return;
    ecrire(() => reglerDelaiSequence(sequence, segment, delai), 'Délai enregistré').then(() => setSaisie(null));
  };

  return (
    <EmailAutoLigne
      orgId={orgId}
      gabarit={sequence.gabarit}
      titre={sequence.titre}
      description={`${sequence.description} ${phraseDelai(sequence, lireSaisieDelai(delaiAffiche) ?? etat.delai)}`}
      controle={(
        <>
          {sequence.repere && (
            <label className="flex items-center gap-1 text-xs text-secondary-600 whitespace-nowrap">
              <input
                type="number"
                min={DELAI_MIN_JOURS}
                max={DELAI_MAX_JOURS}
                value={delaiAffiche}
                onChange={(e) => setSaisie(e.target.value)}
                onBlur={validerDelai}
                disabled={!pret || enCours}
                aria-label={`Délai en jours — ${sequence.titre}`}
                className="w-14 px-2 py-1 border border-secondary-300 rounded-md text-sm text-right disabled:opacity-50"
              />
              jours
            </label>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={etat.allumee}
            aria-label={sequence.titre}
            onClick={basculer}
            disabled={bloque}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${etat.allumee ? 'bg-primary-700' : 'bg-secondary-300'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${etat.allumee ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </>
      )}
    />
  );
}

export default function SequencesSection({ orgId }) {
  const queryClient = useQueryClient();
  const campagnes = useMailCampaigns(orgId, { includeArchived: true });
  const segments = useMailSegments(orgId, { includeArchived: true });
  const { statuses, isLoading: statutsEnCharge, error: statutsErreur } = useLeadStatuses();

  const enEchec = Boolean(campagnes.error || segments.error || statutsErreur);
  const pret = Boolean(orgId) && !enEchec && !campagnes.isLoading && !segments.isLoading && !statutsEnCharge;

  const apresEcriture = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: mailCampaignKeys.all(orgId) }),
    queryClient.invalidateQueries({ queryKey: mailSegmentKeys.all(orgId) }),
  ]);

  return (
    <section>
      <h3 className={SECTION_TITLE}>E-mails envoyés tout seuls à vos prospects</h3>
      <p className={HINT_CLASS}>
        Éteints tant que vous ne les activez pas. Chaque prospect ne reçoit chacun de ces e-mails qu&apos;une fois,
        et peut se désinscrire d&apos;un clic.
      </p>
      {enEchec && (
        <p className="mt-2 text-sm text-red-600">
          L&apos;état de ces e-mails n&apos;a pas pu être lu : rechargez la page avant de les modifier.
        </p>
      )}
      {SEQUENCES_EMAILS.map((sequence) => (
        <LigneSequence
          key={sequence.gabarit.key}
          orgId={orgId}
          sequence={sequence}
          campagnes={campagnes.campaigns}
          segments={segments.segments}
          statutId={statuses.find((s) => s.label === sequence.statut)?.id ?? null}
          pret={pret}
          apresEcriture={apresEcriture}
        />
      ))}
    </section>
  );
}
