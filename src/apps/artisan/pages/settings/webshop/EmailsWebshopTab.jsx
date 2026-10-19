// src/apps/artisan/pages/settings/webshop/EmailsWebshopTab.jsx
// Settings → Webshop → E-mails : les 7 gabarits du webshop (`WEBSHOP_EMAIL_DEFAULTS`), rangés dans
// `majordhome_mail_campaigns` (transactionnels). Création et lien vers Mailing → Éditeur par la même
// ligne que Settings → Communication → Emails (`GabaritTransactionnel`).
import { WEBSHOP_EMAIL_DEFAULTS, WEBSHOP_EMAIL_KEYS, WEBSHOP_EMAIL_PLACEHOLDERS } from '@/lib/webshop/emailTemplates';
import { buildWebshopConfig } from '@/lib/webshop/reglages';
import { gabaritsManquants } from '@/lib/webshop/settingsForm';
import { useOrgSettings } from '@hooks/useOrgSettings';
import GabaritTransactionnel from '../communication/GabaritTransactionnel';
import { useGabaritsExistants } from './useWebshopReglagesForm';
import { Avertissement, CARD, Chargement, SECTION_TITLE } from './common';

const DESTINATAIRE = { client: 'client', transporteur: 'transporteur', prestataire: 'prestataire colis' };

export default function EmailsWebshopTab() {
  const { settings } = useOrgSettings();
  const gabarits = useGabaritsExistants();
  const manquants = gabaritsManquants(buildWebshopConfig(settings).process, gabarits.cles);

  return (
    <div className="space-y-6 max-w-3xl">
      {manquants && manquants.length > 0 && (
        <Avertissement>
          Le Process enregistré utilise des gabarits absents ou archivés :{' '}
          {manquants.map((k) => WEBSHOP_EMAIL_DEFAULTS[k]?.label ?? k).join(', ')}.
        </Avertissement>
      )}
      <section className={CARD}>
        <h2 className={SECTION_TITLE}>Gabarits d’e-mail de la boutique</h2>
        <p className="text-xs text-secondary-500 mb-2">
          Créés avec un texte par défaut, puis modifiables dans Mailing → Éditeur. Envoyés quel que soit le module Communication (e-mails de vente).
        </p>
        {/* État inconnu (pas d'org, chargement, erreur) : jamais de bouton « Créer » à tort. */}
        {gabarits.error ? (
          <Avertissement>Impossible de vérifier les gabarits existants ({gabarits.error.message}). Réessayez plus tard.</Avertissement>
        ) : gabarits.cles === undefined ? (
          <Chargement>Vérification des gabarits…</Chargement>
        ) : WEBSHOP_EMAIL_KEYS.map((key) => {
          // `destinataire` n'est pas une colonne de mail_campaigns : on ne l'insère pas.
          const { destinataire, ...gabarit } = WEBSHOP_EMAIL_DEFAULTS[key];
          const court = gabarit.label.replace(/^Boutique — /, '').replace(/ \([^)]*\)$/, '');
          return (
            <GabaritTransactionnel
              key={key}
              orgId={gabarits.orgId}
              gabarit={gabarit}
              placeholders={[...WEBSHOP_EMAIL_PLACEHOLDERS[key]]}
              titre={`${court.charAt(0).toUpperCase()}${court.slice(1)} (au ${DESTINATAIRE[destinataire] ?? destinataire})`}
            />
          );
        })}
      </section>
    </div>
  );
}
