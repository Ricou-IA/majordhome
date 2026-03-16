/**
 * CertificatLink.jsx — Bouton intelligent certificat
 * ============================================================================
 * Si le certificat est signé + PDF uploadé → ouvre le PDF dans un nouvel onglet.
 * Sinon → navigue vers le wizard /certificat/:interventionId.
 * ============================================================================
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Loader2 } from 'lucide-react';
import { certificatsService } from '@services/certificats.service';

export function CertificatLink({
  interventionId,
  isRealise = false,
  label,
  className,
  onClick,
  children,
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const defaultLabel = isRealise ? 'Voir certificat' : 'Remplir';

  const handleClick = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Call parent onClick if provided (e.g. close modal)
    onClick?.();

    // If not realized, always go to wizard
    if (!isRealise) {
      navigate(`/certificat/${interventionId}`);
      return;
    }

    // Try to fetch the certificat and open PDF directly
    setLoading(true);
    try {
      const { data: cert } = await certificatsService.getCertificatByIntervention(interventionId);

      if (cert?.pdf_storage_path) {
        const { data: signedUrl } = await certificatsService.getSignedUrl(cert.pdf_storage_path);
        if (signedUrl) {
          window.open(signedUrl, '_blank');
          setLoading(false);
          return;
        }
      }

      // Fallback: no PDF yet → go to wizard page
      navigate(`/certificat/${interventionId}`);
    } catch (err) {
      console.error('[CertificatLink] error:', err);
      navigate(`/certificat/${interventionId}`);
    } finally {
      setLoading(false);
    }
  }, [interventionId, isRealise, navigate, onClick]);

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={className || `inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
        isRealise
          ? 'bg-green-600 text-white hover:bg-green-700'
          : 'bg-[#1B4F72] text-white hover:bg-[#154360]'
      } disabled:opacity-70`}
    >
      {children ? (
        children
      ) : (
        <>
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
          {label || defaultLabel}
        </>
      )}
    </button>
  );
}
