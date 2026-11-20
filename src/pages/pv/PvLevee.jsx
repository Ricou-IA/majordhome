/**
 * PvLevee — le client constate que ses réserves sont levées : nom, signature, bouton.
 * `onSigner({ signataire_nom, signature_png })` rend un message de refus, ou `null` si c'est enregistré.
 */
import { useState } from 'react';
import { PenLine } from 'lucide-react';
import PvSignature from './PvSignature';
import { PvAlerte, PvBouton } from './pvUi';

export default function PvLevee({ client, entreprise, onSigner }) {
  const [nom, setNom] = useState([client?.prenom, client?.nom].filter(Boolean).join(' '));
  const [signature, setSignature] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState(null);

  const signer = async () => {
    setEnvoi(true);
    setRefus(null);
    const message = await onSigner({ signataire_nom: nom, signature_png: signature });
    setEnvoi(false);
    setRefus(message);
  };

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold leading-snug">Levée de vos réserves</h2>
        <p className="text-base leading-relaxed text-secondary-700">
          En signant, vous confirmez que les réserves ci-dessus sont levées. Si quelque chose n’est pas réglé,
          ne signez pas :{' '}
          {entreprise?.phone ? (
            <>appelez-nous au <a href={`tel:${entreprise.phone.replace(/\s/g, '')}`} className="font-medium text-secondary-900 underline underline-offset-2">{entreprise.phone}</a>.</>
          ) : 'appelez votre installateur.'}
        </p>
      </div>

      <PvSignature
        nom={nom} onNom={(v) => { setRefus(null); setNom(v); }}
        onSignature={(image) => { setRefus(null); setSignature(image); }}
        disabled={envoi}
      />

      <p className="text-sm leading-relaxed text-secondary-600">
        En signant, vous constatez que les réserves décrites ci-dessus ont été levées.
      </p>
      {refus && <PvAlerte>{refus}</PvAlerte>}
      <PvBouton onClick={signer} attente={envoi} icone={PenLine}>Je constate que les réserves sont levées</PvBouton>
    </section>
  );
}
