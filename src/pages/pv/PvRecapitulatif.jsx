/**
 * PvRecapitulatif — ce que le client a signé (PV, puis levée des réserves), avec ses PDF.
 * `etat` : signe · levee (la signature de la levée vient en `children`) · levee_signee.
 */
import { useState } from 'react';
import { CheckCircle2, Download, Loader2 } from 'lucide-react';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { downloadBlob } from '@/lib/utils';
import { dateLongue, jourDeParis, donneesPdfPv } from '@/lib/pvReception';
import { donneesLeveePourPage } from './pvPageApi';

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
      <button
        type="button" onClick={cliquer} disabled={attente}
        className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-lg border border-secondary-300 bg-white text-base font-medium text-secondary-800 hover:bg-secondary-100 disabled:opacity-60"
      >
        {attente ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
        {libelle}
      </button>
      {erreur && <p className="text-sm text-amber-800">{erreur}</p>}
    </>
  );
}

function ReponseInstallateur({ reserves }) {
  if (!reserves) return null;
  return (
    <div className="rounded-lg border border-secondary-200 bg-white p-4 text-sm space-y-2">
      <p className="font-semibold">La réponse de votre installateur</p>
      {reserves.reponse && <p className="whitespace-pre-line">{reserves.reponse}</p>}
      {reserves.echeance && (
        <p className="font-medium">Engagement : réserves levées avant le {dateLongue(reserves.echeance)}</p>
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
    <section className="mt-8 space-y-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-base font-semibold">{TITRES[etat]}</p>
          <p className="text-sm text-secondary-600">
            {etat === 'levee_signee' && pv.levee?.signed_at
              ? `Constaté le ${dateLongue(jourDeParis(pv.levee.signed_at))} par ${pv.levee.signataire_nom}. `
              : ''}
            Merci{pv.client?.prenom ? ` ${pv.client.prenom}` : ''}. Nous en avons été informés.
          </p>
        </div>
      </div>

      {signature && (
        <dl className="rounded-lg border border-secondary-200 bg-white p-4 text-sm space-y-2">
          <div><dt className="text-secondary-500">Travaux</dt><dd className="font-medium">{pv.objet}</dd></div>
          <div><dt className="text-secondary-500">Signé le</dt><dd className="font-medium">{dateLongue(jourDeParis(signature.signed_at))} par {signature.signataire_nom}</dd></div>
          <div>
            <dt className="text-secondary-500">Réception</dt>
            <dd className="font-medium">{avecReserves ? 'Avec réserves' : 'Sans réserve'}</dd>
          </div>
          {avecReserves && signature.reserves_nature && (
            <div><dt className="text-secondary-500">Réserves signalées</dt><dd className="whitespace-pre-line">{signature.reserves_nature}</dd></div>
          )}
          {avecReserves && signature.reserves_travaux && (
            <div><dt className="text-secondary-500">Travaux à exécuter</dt><dd className="whitespace-pre-line">{signature.reserves_travaux}</dd></div>
          )}
        </dl>
      )}

      {avecReserves && <ReponseInstallateur reserves={pv.reserves} />}
      {etat === 'signe' && avecReserves && !pv.levee?.demandee && (
        <p className="text-sm text-secondary-700">Nous revenons vers vous au sujet de vos réserves.</p>
      )}

      {children}

      {signature && <BoutonPdf libelle="Télécharger mon procès-verbal (PDF)" generer={genererPv} />}
      {etat === 'levee_signee' && signature && (
        <BoutonPdf libelle="Télécharger le procès-verbal de levée des réserves (PDF)" generer={genererLevee} />
      )}
      <p className="text-xs text-secondary-500">Document à conserver 10 ans : il fait courir les garanties légales de votre installation.</p>
    </section>
  );
}
