// src/apps/artisan/components/entretiens/GenererAttestationButton.jsx
// « Attestation » sur une carte d'entretien déjà facturée : (re)génère l'attestation d'entretien
// et de ramonage — rattrapage des entretiens facturés avant le 2026-10-24, d'un marquage manuel
// « Facturé », ou d'un certificat corrigé après facturation. Même point d'entrée que la
// facturation (`genererAttestationsIntervention`) ; la facture est citée à la date de `invoiced_at`.
import { useState } from 'react';
import { toast } from 'sonner';
import { FileCheck2, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { certificatKeys } from '@hooks/cacheKeys';
import { equipmentCategoriesService } from '@services/equipmentCategories.service';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { formatDateForInput } from '@/lib/utils';
import { genererAttestationsIntervention } from '../certificat/attestationExport';

/**
 * @param {{ item: object, orgId: string }} p  item = carte de `majordhome_entretien_sav` (facturée)
 */
export default function GenererAttestationButton({ item, orgId }) {
  const { settings } = useOrgSettings();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const handleClick = async (e) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const { data: categories, error: catErr } = await equipmentCategoriesService.getCategories(orgId, { activeOnly: false });
      if (catErr) throw catErr;
      const r = await genererAttestationsIntervention({
        orgId,
        interventionId: item.id,
        client: {
          name: item.client_name || `${item.client_first_name || ''} ${item.client_last_name || ''}`.trim(),
          address: item.client_address,
          postal_code: item.client_postal_code,
          city: item.client_city,
        },
        company: buildCompanyInfo(settings),
        categories: categories || [],
        invoiceDate: formatDateForInput(item.invoiced_at || new Date()),
      });
      if (r.generated.length) {
        toast.success(r.generated.length > 1
          ? `${r.generated.length} attestations d’entretien générées, rangées avec les certificats`
          : 'Attestation d’entretien générée, rangée avec le certificat');
      }
      r.skipped.forEach((sk) => toast.warning(`Attestation non générée : ${sk.message}`, { duration: 12000 }));
      r.warnings.forEach((w) => toast.warning(w, { duration: 12000 }));
      if (!r.generated.length && !r.skipped.length) toast.info('Aucun ramonage sur cet entretien : pas d’attestation à produire');
      queryClient.invalidateQueries({ queryKey: certificatKeys.all(orgId) });
    } catch (err) {
      toast.error(`Attestation non générée : ${err?.message || 'erreur inconnue'}`, { duration: 15000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title="Générer l’attestation d’entretien et de ramonage (remplace celle déjà rangée)"
      className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-md border border-gray-300 text-gray-600 bg-white hover:bg-blue-50 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileCheck2 className="w-3 h-3" />}
      Attestation
    </button>
  );
}
