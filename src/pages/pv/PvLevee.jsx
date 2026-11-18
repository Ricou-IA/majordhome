/**
 * PvLevee — le client constate que ses réserves sont levées : nom, signature, bouton.
 * `onSigner({ signataire_nom, signature_png })` rend un message de refus, ou `null` si c'est enregistré.
 */
import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { CertificatSignaturePad } from '@apps/artisan/components/certificat/CertificatSignaturePad';

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
    <section className="space-y-4">
      <p className="text-sm text-secondary-800">
        En signant, vous confirmez que les réserves ci-dessus sont levées. Si quelque chose n’est pas réglé,
        ne signez pas :{' '}
        {entreprise?.phone ? (
          <>appelez-nous au <a href={`tel:${entreprise.phone.replace(/\s/g, '')}`} className="font-medium underline">{entreprise.phone}</a>.</>
        ) : 'appelez votre installateur.'}
      </p>

      <CertificatSignaturePad
        onSign={(image) => { setRefus(null); setSignature(image); }}
        onClear={() => setSignature(null)}
        signataireNom={nom}
        onSignataireNomChange={(v) => { setRefus(null); setNom(v); }}
        existingSignature={signature}
        isSaving={envoi}
        nomLabel="Votre nom et prénom"
        signatureLabel="Votre signature"
        placeholder="Signez ici, au doigt"
        disclaimerText="En signant, vous constatez que les réserves décrites ci-dessus ont été levées."
      />

      {refus && (
        <p className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {refus}
        </p>
      )}

      <button
        type="button"
        onClick={signer}
        disabled={envoi}
        className="w-full min-h-[52px] inline-flex items-center justify-center gap-2 rounded-lg text-base font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: entreprise?.accent_color || '#334155' }}
      >
        {envoi ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
        {envoi ? 'Enregistrement…' : 'Je constate que les réserves sont levées'}
      </button>
    </section>
  );
}
