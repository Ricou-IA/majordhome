// src/apps/artisan/pages/settings/communication/EmailsAutomatiquesTab.jsx
// ============================================================================
// Réglages → E-mails & SMS → chapitre « E-mails automatiques » : les e-mails que l'application envoie
// d'elle-même (proposition de contrat, facture, rendez-vous, PV…). La liste vient du registre
// `src/lib/emailsAutomatiques.js` ; chaque ligne ouvre son texte et envoie un essai (`EmailAutoLigne`).
// ============================================================================
import { Link } from 'react-router-dom';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useAuth } from '@contexts/AuthContext';
import { moduleActif } from '@/lib/modules';
import { emailsAffiches } from '@/lib/emailsAutomatiques';
import { leadWelcomeSettings } from '@/lib/leadWelcomeEmail';
import { lienChapitre } from '@/lib/chapitresCommunication';
import EmailAutoLigne from './EmailAutoLigne';
import AccueilLeadMetaSection from './AccueilLeadMetaSection';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

export default function EmailsAutomatiquesTab() {
  const { settings, isLoading } = useOrgSettings();
  const { organization } = useAuth();
  const orgId = organization?.id;

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  const emails = emailsAffiches((cle) => moduleActif(settings, cle), { accueilMetaActif: leadWelcomeSettings(settings).enabled });

  return (
    <div className="card">
      <section>
        <h3 className={SECTION_TITLE}>E-mails envoyés automatiquement</h3>
        <p className={HINT_CLASS}>
          Chaque e-mail part avec un texte par défaut tant que vous ne l&apos;avez pas modifié. Un essai arrive à
          l&apos;adresse qui reçoit les réponses de vos clients, réglée dans{' '}
          <Link to={lienChapitre('expediteur')} className="text-primary-700 hover:underline">Expéditeur et domaine</Link>.
        </p>
        {emails.map((email) => (
          email.interrupteur === 'lead_welcome_email'
            ? <AccueilLeadMetaSection key={email.gabarit.key} orgId={orgId} />
            : (
              <EmailAutoLigne
                key={email.gabarit.key}
                orgId={orgId}
                gabarit={email.gabarit}
                titre={email.titre}
                description={email.description}
              />
            )
        ))}
      </section>
    </div>
  );
}
