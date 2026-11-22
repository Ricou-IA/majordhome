// src/apps/artisan/pages/settings/CommunicationSettings.jsx
// Réglages → E-mails & SMS (/settings/communication) : tout ce que l'entreprise envoie à ses clients,
// rangé en chapitres dans un menu à gauche (Eric 2026-11-22 : « la configuration des e-mails doit être
// en chapitre du paramétrage ») — Expéditeur et domaine, Habillage, E-mails automatiques, Séquences,
// SMS & WhatsApp. Chapitre choisi par `?tab=` ; la liste et les liens n'ont qu'une définition,
// `src/lib/chapitresCommunication.js`. Les anciennes adresses /settings/emails et /settings/sms y renvoient.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AtSign, Palette, MailCheck, Repeat, MessageSquare } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useAuth } from '@contexts/AuthContext';
import { moduleActif } from '@/lib/modules';
import { chapitresOuverts, chapitreActif, parametresDuChapitre } from '@/lib/chapitresCommunication';
import SettingsPage from './SettingsPage';
import ExpediteurTab from './communication/ExpediteurTab';
import HabillageSection from './communication/HabillageSection';
import EmailsAutomatiquesTab from './communication/EmailsAutomatiquesTab';
import SequencesSection from './communication/SequencesSection';
import SmsTab from './communication/SmsTab';

const ICONES = { expediteur: AtSign, habillage: Palette, automatiques: MailCheck, sequences: Repeat, sms: MessageSquare };

export default function CommunicationSettings() {
  const [params, setParams] = useSearchParams();
  const { settings } = useOrgSettings();
  const { organization } = useAuth();
  const communicationOuverte = moduleActif(settings, 'communication');

  const chapitres = useMemo(
    () => chapitresOuverts(communicationOuverte).map((c) => ({ key: c.key, label: c.label, icon: ICONES[c.key] })),
    [communicationOuverte],
  );
  const chapitre = chapitreActif(params.get('tab'), chapitres);

  return (
    <SettingsPage
      title="E-mails & SMS"
      description="Ce que votre entreprise envoie à ses clients : d'où partent vos e-mails, leur allure, leurs textes, vos SMS."
      tabs={chapitres}
      tab={chapitre}
      onTabChange={(key) => setParams(parametresDuChapitre(key), { replace: true })}
      disposition="menu"
    >
      {chapitre === 'expediteur' && <ExpediteurTab />}
      {chapitre === 'habillage' && <HabillageSection />}
      {chapitre === 'automatiques' && <EmailsAutomatiquesTab />}
      {chapitre === 'sequences' && (
        <div className="card">
          <SequencesSection orgId={organization?.id} />
        </div>
      )}
      {chapitre === 'sms' && <SmsTab />}
    </SettingsPage>
  );
}
