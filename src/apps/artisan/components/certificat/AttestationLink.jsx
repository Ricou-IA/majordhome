// src/apps/artisan/components/certificat/AttestationLink.jsx
// « Voir l'attestation » : second PDF rangé à côté du certificat d'une intervention (attestation
// d'entretien et de ramonage générée à la facturation, cf. attestationExport.js). N'affiche rien
// tant qu'aucune attestation n'existe pour l'intervention.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileCheck2, Loader2 } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { certificatsService } from '@services/certificats.service';
import { certificatKeys } from '@/shared/hooks/cacheKeys';
import { unwrapResult } from '@/lib/serviceHelpers';

/**
 * @param {{ interventionId: string, label?: string, className?: string, onClick?: () => void }} p
 */
export function AttestationLink({ interventionId, label = 'Voir l’attestation', className, onClick }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const [opening, setOpening] = useState(false);
  const { data: path } = useQuery({
    queryKey: certificatKeys.attestation(orgId, interventionId),
    queryFn: () => unwrapResult(certificatsService.findAttestationPath(interventionId)),
    enabled: !!orgId && !!interventionId,
    staleTime: 60_000,
  });

  if (!path) return null;

  const open = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.();
    const win = window.open('', '_blank');
    setOpening(true);
    const { data: url, error } = await certificatsService.getSignedUrl(path);
    setOpening(false);
    if (error || !url) {
      win?.close();
      toast.error('Attestation introuvable');
      return;
    }
    if (win) win.location.href = url; else window.location.href = url;
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={opening}
      className={className || 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-secondary-300 bg-white text-secondary-700 hover:bg-secondary-50 transition-colors disabled:opacity-70'}
    >
      {opening ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileCheck2 className="w-3 h-3" />}
      {label}
    </button>
  );
}
