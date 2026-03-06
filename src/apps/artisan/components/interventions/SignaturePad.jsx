/**
 * SignaturePad.jsx - Majord'home Artisan
 * ============================================================================
 * Wrapper react-signature-canvas pour signature client sur tablette.
 * Export en PNG → upload Storage, champ nom signataire.
 *
 * @version 1.0.0 - Sprint 3 Outil Terrain Tablette
 * ============================================================================
 */

import { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Eraser, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * @param {Object} props
 * @param {string} props.signedByName - Nom du signataire (contrôlé)
 * @param {Function} props.onSignedByNameChange - Callback changement nom
 * @param {Function} props.onConfirm - (blob: Blob, name: string) => Promise — appelé quand le client confirme
 * @param {string|null} props.existingSignatureUrl - URL d'une signature existante
 * @param {boolean} props.disabled - Désactiver le pad
 * @param {boolean} props.isSaving - Loading sauvegarde
 */
export function SignaturePad({
  signedByName = '',
  onSignedByNameChange,
  onConfirm,
  existingSignatureUrl = null,
  disabled = false,
  isSaving = false,
}) {
  const sigCanvasRef = useRef(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [confirmed, setConfirmed] = useState(!!existingSignatureUrl);

  // Vider le canvas
  const handleClear = () => {
    if (sigCanvasRef.current) {
      sigCanvasRef.current.clear();
      setIsEmpty(true);
      setConfirmed(false);
    }
  };

  // Détecter fin de trait
  const handleEnd = () => {
    if (sigCanvasRef.current) {
      setIsEmpty(sigCanvasRef.current.isEmpty());
    }
  };

  // Confirmer la signature
  const handleConfirm = async () => {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return;
    if (!signedByName.trim()) return;

    try {
      // Exporter en PNG Blob
      const dataUrl = sigCanvasRef.current.getTrimmedCanvas().toDataURL('image/png');
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      if (onConfirm) {
        await onConfirm(blob, signedByName.trim());
      }

      setConfirmed(true);
    } catch (err) {
      console.error('[SignaturePad] Erreur confirmation:', err);
    }
  };

  // Si une signature existe déjà et est confirmée
  if (confirmed && existingSignatureUrl) {
    return (
      <div className="space-y-3">
        <Label className="text-base font-medium">Signature client</Label>
        <div className="bg-white rounded-lg border p-4 text-center">
          <img
            src={existingSignatureUrl}
            alt="Signature client"
            className="max-h-32 mx-auto"
          />
          <p className="text-sm text-gray-600 mt-2">
            Signé par <strong>{signedByName}</strong>
          </p>
        </div>
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            className="min-h-[44px] text-base"
          >
            <Eraser className="h-4 w-4 mr-2" />
            Refaire la signature
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Label className="text-base font-medium">Signature client</Label>

      {/* Champ nom signataire */}
      <div>
        <Label htmlFor="signed_by_name" className="text-sm text-gray-600">
          Nom du signataire
        </Label>
        <Input
          id="signed_by_name"
          value={signedByName}
          onChange={(e) => onSignedByNameChange?.(e.target.value)}
          placeholder="Nom et prénom du client"
          disabled={disabled || isSaving}
          className="min-h-[44px] text-base mt-1"
        />
      </div>

      {/* Zone de signature */}
      <div className="relative">
        <div
          className={`border-2 rounded-lg bg-white ${
            disabled ? 'border-gray-200 opacity-50' : 'border-gray-300'
          }`}
        >
          <SignatureCanvas
            ref={sigCanvasRef}
            onEnd={handleEnd}
            penColor="black"
            canvasProps={{
              className: 'w-full rounded-lg',
              style: { height: '200px', width: '100%', touchAction: 'none' },
            }}
          />
        </div>

        {/* Texte guide */}
        {isEmpty && !disabled && (
          <p className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
            Signez ici avec le doigt
          </p>
        )}
      </div>

      {/* Boutons */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleClear}
          disabled={disabled || isEmpty || isSaving}
          className="min-h-[44px] text-base flex-1"
        >
          <Eraser className="h-4 w-4 mr-2" />
          Effacer
        </Button>
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={disabled || isEmpty || !signedByName.trim() || isSaving}
          className="min-h-[44px] text-base flex-1"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Check className="h-4 w-4 mr-2" />
          )}
          {isSaving ? 'Sauvegarde...' : 'Confirmer la signature'}
        </Button>
      </div>
    </div>
  );
}

export default SignaturePad;
