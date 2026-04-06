/**
 * CertificatSignaturePad.jsx - Certificat d'Entretien
 * ============================================================================
 * Wrapper react-signature-canvas adapté au certificat.
 * Retourne la signature en base64 (data:image/png;base64,...).
 * Inclut le texte légal réglementaire.
 *
 * Optimisé tablette : grande zone, boutons tactiles.
 * ============================================================================
 */

import { useRef, useState, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Eraser, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CertificatSignaturePad({
  onSign,
  onClear,
  signataireNom,
  onSignataireNomChange,
  disabled = false,
  isSaving = false,
  existingSignature = null,
  disclaimerText = null,
}) {
  const sigCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [confirmed, setConfirmed] = useState(!!existingSignature);

  // Resize canvas quand le container change de taille
  useEffect(() => {
    if (!containerRef.current || !sigCanvasRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      const canvas = sigCanvasRef.current;
      if (canvas) {
        // react-signature-canvas ne supporte pas bien le resize natif,
        // on laisse le CSS gérer via width: 100%
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const handleClear = () => {
    if (sigCanvasRef.current) {
      sigCanvasRef.current.clear();
      setIsEmpty(true);
      setConfirmed(false);
      onClear?.();
    }
  };

  const handleEnd = () => {
    if (sigCanvasRef.current) {
      setIsEmpty(sigCanvasRef.current.isEmpty());
    }
  };

  const handleConfirm = () => {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return;
    if (!signataireNom?.trim()) return;

    const dataUrl = sigCanvasRef.current.getTrimmedCanvas().toDataURL('image/png');
    onSign?.(dataUrl);
    setConfirmed(true);
  };

  // Affichage si signature existante confirmée
  if (confirmed && existingSignature) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-lg border-2 border-green-200 p-6 text-center">
          <img
            src={existingSignature}
            alt="Signature client"
            className="max-h-40 mx-auto"
          />
          <p className="text-sm text-gray-600 mt-3">
            Signé par <strong>{signataireNom}</strong>
          </p>
        </div>
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            className="min-h-[48px] text-base"
          >
            <Eraser className="h-4 w-4 mr-2" />
            Refaire la signature
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Texte légal */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
        {disclaimerText || "En signant, le technicien certifie avoir effectué l'entretien conformément à l'arrêté du 15/09/2009, art. 8."}
      </div>

      {/* Nom du signataire */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Nom du technicien <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={signataireNom || ''}
          onChange={(e) => onSignataireNomChange?.(e.target.value)}
          placeholder="Nom du technicien"
          disabled={disabled || isSaving}
          className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
      </div>

      {/* Zone de signature */}
      <div ref={containerRef} className="relative">
        <p className="text-sm font-medium text-gray-700 mb-1">
          Signature du technicien <span className="text-red-500">*</span>
        </p>
        <div
          className={`border-2 rounded-lg bg-white ${
            disabled ? 'border-gray-200 opacity-50' : 'border-dashed border-gray-400'
          }`}
        >
          <SignatureCanvas
            ref={sigCanvasRef}
            onEnd={handleEnd}
            penColor="#1B4F72"
            canvasProps={{
              className: 'w-full rounded-lg',
              style: { height: '250px', width: '100%', touchAction: 'none' },
            }}
          />
        </div>

        {/* Placeholder */}
        {isEmpty && !disabled && (
          <p className="absolute inset-0 flex items-center justify-center text-gray-400 text-base pointer-events-none mt-6">
            Demandez au client de signer ici
          </p>
        )}
      </div>

      {/* Boutons */}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handleClear}
          disabled={disabled || isEmpty || isSaving}
          className="min-h-[48px] text-base flex-1"
        >
          <Eraser className="h-4 w-4 mr-2" />
          Effacer
        </Button>
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={disabled || isEmpty || !signataireNom?.trim() || isSaving}
          className="min-h-[48px] text-base flex-1 bg-green-600 hover:bg-green-700 text-white"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Check className="h-4 w-4 mr-2" />
          )}
          {isSaving ? 'Enregistrement...' : 'Valider la signature'}
        </Button>
      </div>
    </div>
  );
}
