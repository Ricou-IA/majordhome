/**
 * PvFormulaire — le procès-verbal à lire et à signer, dans l'ordre : travaux et devis, ce que
 * déclare l'installateur, la décision, ce que le client confirme, les garanties, la signature.
 */
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { CertificatSignaturePad } from '@apps/artisan/components/certificat/CertificatSignaturePad';
import { periodeDePose, dateLongue } from '@/lib/pvReception';
import PvDeclaration from './PvDeclaration';
import PvPointsClient from './PvPointsClient';

const CHOIX = [
  { valeur: 'sans_reserves', titre: 'Je réceptionne les travaux sans réserve', aide: 'Les travaux sont terminés et conformes.' },
  { valeur: 'avec_reserves', titre: 'Je réceptionne les travaux avec des réserves', aide: 'Des points restent à corriger : je les décris ci-dessous.' },
];

const CHAMP = 'w-full px-3 py-2 border border-secondary-300 rounded-lg text-base bg-white';

export default function PvFormulaire({ pv, reponse, maj, envoi, refus, onSigner }) {
  const c = pv.client || {};
  const adresse = [c.adresse, [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const pose = periodeDePose(pv.poses);
  const avecReserves = reponse.reception_type === 'avec_reserves';

  return (
    <section className="mt-6 space-y-6">
      <div className="space-y-2">
        <p className="text-base">Bonjour{c.prenom ? ` ${c.prenom}` : ''},</p>
        <p className="text-base">
          Votre installation est terminée. Merci de confirmer la réception des travaux : votre signature
          fait courir les garanties.
        </p>
      </div>

      <dl className="rounded-lg border border-secondary-200 bg-white p-4 text-sm space-y-2">
        <div><dt className="text-secondary-500">Travaux</dt><dd className="font-medium">{pv.objet}</dd></div>
        {pose && <div><dt className="text-secondary-500">Réalisés</dt><dd className="font-medium">{pose}</dd></div>}
        {adresse && <div><dt className="text-secondary-500">Adresse</dt><dd className="font-medium">{adresse}</dd></div>}
        {pv.devis?.map((d, i) => (
          <div key={`${i}-${d.libelle}`}><dd className="font-medium">Devis {d.libelle} du {dateLongue(d.date)}</dd></div>
        ))}
      </dl>

      <PvDeclaration declaration={pv.declaration} />

      <fieldset className="space-y-3" disabled={envoi}>
        <legend className="text-sm font-semibold mb-1">Votre décision</legend>
        {CHOIX.map((choix) => (
          <label
            key={choix.valeur}
            className={`flex items-start gap-3 p-3 min-h-[48px] rounded-lg border bg-white cursor-pointer ${
              reponse.reception_type === choix.valeur ? 'border-secondary-900 ring-1 ring-secondary-900' : 'border-secondary-300'
            }`}
          >
            <input
              type="radio" name="reception_type" className="mt-1 h-5 w-5 shrink-0"
              checked={reponse.reception_type === choix.valeur}
              onChange={() => maj({ reception_type: choix.valeur })}
            />
            <span>
              <span className="block text-base font-medium">{choix.titre}</span>
              <span className="block text-sm text-secondary-600">{choix.aide}</span>
            </span>
          </label>
        ))}

        {avecReserves && (
          <div className="space-y-3">
            <label className="block">
              <span className="block text-sm font-medium mb-1">Vos réserves <span className="text-red-600">*</span></span>
              <textarea
                rows={3} maxLength={2000} value={reponse.reserves_nature}
                onChange={(e) => maj({ reserves_nature: e.target.value })}
                placeholder="Décrivez ce qui ne va pas" className={CHAMP}
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">Ce que vous attendez</span>
              <textarea
                rows={2} maxLength={2000} value={reponse.reserves_travaux}
                onChange={(e) => maj({ reserves_travaux: e.target.value })}
                placeholder="Travaux à reprendre ou à terminer (facultatif)" className={CHAMP}
              />
            </label>
          </div>
        )}
      </fieldset>

      <PvPointsClient
        points={pv.points_client} confirmes={reponse.points_confirmes} disabled={envoi}
        onChange={(points_confirmes) => maj({ points_confirmes })}
      />

      {pv.garanties?.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Vos garanties</h2>
          <ul className="list-disc pl-5 text-sm text-secondary-700 space-y-1">
            {pv.garanties.map((g) => <li key={g}>{g}</li>)}
          </ul>
        </section>
      )}

      <CertificatSignaturePad
        onSign={(image) => maj({ signature_png: image })}
        onClear={() => maj({ signature_png: null })}
        signataireNom={reponse.signataire_nom}
        onSignataireNomChange={(nom) => maj({ signataire_nom: nom })}
        existingSignature={reponse.signature_png}
        isSaving={envoi}
        nomLabel="Votre nom et prénom"
        signatureLabel="Votre signature"
        placeholder="Signez ici, au doigt"
        disclaimerText="En signant, vous reconnaissez avoir réceptionné les travaux dans les conditions décrites ci-dessus."
      />

      {refus && (
        <p className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {refus}
        </p>
      )}

      <button
        type="button" onClick={onSigner} disabled={envoi}
        className="w-full min-h-[52px] inline-flex items-center justify-center gap-2 rounded-lg text-base font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: pv.entreprise?.accent_color || '#334155' }}
      >
        {envoi ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
        {envoi ? 'Enregistrement…' : 'Signer le procès-verbal'}
      </button>
    </section>
  );
}
