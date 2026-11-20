/**
 * PvRecapitulatif — ce que le client a signé (PV, puis levée des réserves), avec ses PDF.
 * `etat` : signe · levee (la signature de la levée vient en `children`) · levee_signee.
 */
import { useState } from 'react';
import { Download } from 'lucide-react';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { downloadBlob } from '@/lib/utils';
import { dateLongue, jourDeParis, donneesPdfPv } from '@/lib/pvReception';
import { prenomLisible } from '@/lib/pagePublique';
import { donneesLeveePourPage } from './pvPageApi';
import { PageAlerte, PageBoutonSecondaire, PageCoche, PageFiche } from '../public/pageUi';

/** Bouton de téléchargement : react-pdf, lourd, n'est chargé qu'au clic. */
function BoutonPdf({ libelle, generer }) {
  const [attente, setAttente] = useState(false);
  const [erreur, setErreur] = useState(null);
  const cliquer = async () => {
    setAttente(true);
    setErreur(null);
    try {
      const { blob, nom } = await generer();
      downloadBlob(blob, nom);
    } catch {
      setErreur('Le PDF n’a pas pu être préparé. Votre signature est bien enregistrée : demandez-nous une copie.');
    } finally {
      setAttente(false);
    }
  };
  return (
    <>
      <PageBoutonSecondaire onClick={cliquer} attente={attente} icone={Download}>{libelle}</PageBoutonSecondaire>
      {erreur && <PageAlerte>{erreur}</PageAlerte>}
    </>
  );
}

function ReponseInstallateur({ reserves }) {
  if (!reserves) return null;
  return (
    <div className="space-y-2 rounded-2xl bg-secondary-100 p-5">
      <p className="text-base font-semibold">La réponse de votre installateur</p>
      {reserves.reponse && <p className="whitespace-pre-line text-base leading-relaxed text-secondary-800">{reserves.reponse}</p>}
      {reserves.echeance && (
        <p className="text-base font-medium">Engagement : réserves levées avant le {dateLongue(reserves.echeance)}</p>
      )}
    </div>
  );
}

const TITRES = {
  signe: 'Votre procès-verbal de réception est signé.',
  levee: 'Votre procès-verbal de réception est signé.',
  levee_signee: 'Les réserves sont levées.',
};

export default function PvRecapitulatif({ pv, etat = 'signe', children }) {
  const signature = pv.signature;
  const avecReserves = signature?.reception_type === 'avec_reserves';
  const prenom = prenomLisible(pv.client?.prenom);
  const nomEntreprise = () => buildCompanyInfo(pv.entreprise).name;

  const genererPv = async () => {
    const company = buildCompanyInfo(pv.entreprise);
    const { generatePvReceptionPdfBlob } = await import('@apps/artisan/components/chantiers/PvReceptionPDF');
    const blob = await generatePvReceptionPdfBlob(donneesPdfPv({
      chantierId: pv.chantier_id, client: pv.client, objet: pv.objet, entreprise: company.name, signature,
    }), company);
    return { blob, nom: 'PV_de_reception.pdf' };
  };

  const genererLevee = async () => {
    const company = buildCompanyInfo(pv.entreprise);
    const { generatePvLeveePdfBlob } = await import('@apps/artisan/components/chantiers/PvLeveeReservesPDF');
    const blob = await generatePvLeveePdfBlob(donneesLeveePourPage(pv, nomEntreprise()), company);
    return { blob, nom: 'PV_de_levee_des_reserves.pdf' };
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageCoche />
        <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{TITRES[etat]}</h1>
        <p className="text-base leading-relaxed text-secondary-700">
          {etat === 'levee_signee' && pv.levee?.signed_at
            ? `Constaté le ${dateLongue(jourDeParis(pv.levee.signed_at))} par ${pv.levee.signataire_nom}. `
            : ''}
          Merci{prenom ? ` ${prenom}` : ''}. Nous en avons été informés.
        </p>
      </div>

      {signature && (
        <PageFiche
          titre={pv.objet}
          lignes={[
            { libelle: 'Signé le', valeur: `${dateLongue(jourDeParis(signature.signed_at))} par ${signature.signataire_nom}` },
            { libelle: 'Réception', valeur: avecReserves ? 'Avec réserves' : 'Sans réserve' },
            avecReserves && { libelle: 'Réserves signalées', valeur: signature.reserves_nature, multiligne: true },
            avecReserves && { libelle: 'Travaux à exécuter', valeur: signature.reserves_travaux, multiligne: true },
          ]}
        />
      )}

      {avecReserves && <ReponseInstallateur reserves={pv.reserves} />}
      {etat === 'signe' && avecReserves && !pv.levee?.demandee && (
        <p className="text-base text-secondary-700">Nous revenons vers vous au sujet de vos réserves.</p>
      )}

      {children}

      <div className="space-y-3">
        {signature && <BoutonPdf libelle="Télécharger mon procès-verbal (PDF)" generer={genererPv} />}
        {etat === 'levee_signee' && signature && (
          <BoutonPdf libelle="Télécharger le procès-verbal de levée des réserves (PDF)" generer={genererLevee} />
        )}
        <p className="text-sm leading-relaxed text-secondary-600">
          Document à conserver 10 ans : il fait courir les garanties légales de votre installation.
        </p>
      </div>
    </div>
  );
}
