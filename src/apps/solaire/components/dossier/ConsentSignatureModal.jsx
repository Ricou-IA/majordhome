// src/apps/solaire/components/dossier/ConsentSignatureModal.jsx
// Recueil sur tablette du consentement client + signature manuscrite (par dossier PV).
// Générique : piloté par une liste de consentements. Réutilise CertificatSignaturePad
// (react-signature-canvas, sortie base64 PNG). Ne connaît ni le CERFA ni l'ENEDIS.
import { useState, useEffect, useRef } from 'react';
import { X, FileSignature } from 'lucide-react';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';
import { CertificatSignaturePad } from '@apps/artisan/components/certificat/CertificatSignaturePad';

export default function ConsentSignatureModal({
  open, onClose, onSubmit, isSubmitting, consentItems, initialConsent, signataireDefaut, lieuDefaut,
}) {
  const [accepted, setAccepted] = useState({});
  const [signataireNom, setSignataireNom] = useState('');
  const [lieu, setLieu] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);

  // Init à la transition fermé→ouvert seulement (props objets recréés à chaque render du parent).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const init = initialConsent?.items ?? {};
      setAccepted(Object.fromEntries(consentItems.map((c) => [c.key, Boolean(init[c.key]?.accepted)])));
      setSignataireNom(initialConsent?.signataire_nom || signataireDefaut || '');
      setLieu(initialConsent?.lieu || lieuDefaut || '');
      setSignatureDataUrl(null);
    }
    wasOpen.current = open;
  }, [open, initialConsent, consentItems, signataireDefaut, lieuDefaut]);

  if (!open) return null;

  const allRequired = consentItems.filter((c) => c.required).every((c) => accepted[c.key]);
  const canSubmit = allRequired && signataireNom.trim() && lieu.trim() && signatureDataUrl && !isSubmitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const now = new Date().toISOString();
    const items = Object.fromEntries(
      consentItems.map((c) => [c.key, { accepted: Boolean(accepted[c.key]), at: accepted[c.key] ? now : null }]),
    );
    onSubmit({ signataire_nom: signataireNom.trim(), lieu: lieu.trim(), signed_at: now, items }, signatureDataUrl);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-secondary-900 flex items-center gap-2">
            <FileSignature className="w-4 h-4" /> Consentement & signature du client
          </h3>
          <button onClick={onClose} className="p-1 rounded-md text-secondary-400 hover:bg-secondary-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Consentements */}
        <div className="space-y-2">
          {consentItems.map((c) => (
            <label
              key={c.key}
              className="flex items-start gap-2 text-sm text-secondary-700 cursor-pointer border border-secondary-200 rounded-lg p-3"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={Boolean(accepted[c.key])}
                onChange={(e) => setAccepted((a) => ({ ...a, [c.key]: e.target.checked }))}
              />
              <span>
                <span className="font-medium text-secondary-900 block">
                  {c.label}{c.required && <span className="text-[#B45309]"> *</span>}
                </span>
                <span className="text-xs text-secondary-500">{c.legalText}</span>
              </span>
            </label>
          ))}
        </div>

        <FormField label="Lieu">
          <input
            className={inputClass}
            value={lieu}
            onChange={(e) => setLieu(e.target.value)}
            placeholder="Commune de signature"
          />
        </FormField>

        {/* Pad de signature (gère nom + tracé, sortie base64) — c'est le CLIENT qui signe la DP */}
        <CertificatSignaturePad
          signataireNom={signataireNom}
          onSignataireNomChange={setSignataireNom}
          onSign={setSignatureDataUrl}
          onClear={() => setSignatureDataUrl(null)}
          isSaving={isSubmitting}
          nomLabel="Nom du client"
          signatureLabel="Signature du client"
          disclaimerText="En signant, le client accepte les autorisations ci-dessus et atteste l'exactitude des informations de la déclaration préalable."
        />

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-secondary-200 text-secondary-700 font-medium hover:bg-secondary-50"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <FileSignature className="w-4 h-4" /> Enregistrer le consentement
          </button>
        </div>
      </div>
    </div>
  );
}
