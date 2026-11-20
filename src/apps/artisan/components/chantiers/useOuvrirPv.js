/**
 * useOuvrirPv — ouvre le PV de réception ou le PV de levée des réserves d'un chantier.
 * ============================================================================
 * Un seul geste pour la fiche chantier et la fiche client : le fichier archivé s'il
 * existe (signé sur tablette, ou déjà produit) ; sinon le PDF est produit depuis
 * l'ENREGISTREMENT de la signature en ligne, puis archivé. Ce qui n'a pas pu être
 * fait (archivage, logo, signature de l'entreprise) est dit à l'écran.
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useChantierPvMutations } from '@hooks/useChantiers';
import { chantiersService } from '@services/chantiers.service';
import { buildCompanyInfo } from '@/lib/orgBranding';

const TEXTES = {
  pv: {
    illisible: 'Impossible de charger le PV',
    nonArchive: 'Le PV s’ouvre, mais il n’a pas pu être archivé : rouvrez-le plus tard.',
    echec: 'Le PV n’a pas pu être produit',
  },
  levee: {
    illisible: 'Impossible de charger le PV de levée',
    nonArchive: 'Le PV de levée s’ouvre, mais il n’a pas pu être archivé : rouvrez-le plus tard.',
    echec: 'Le PV de levée n’a pas pu être produit',
  },
};

/**
 * @param {{ onUpdated?: () => void }} [options] appelé après une production (le chantier porte alors son fichier)
 * @returns {{ ouvrirPv: (chantier: Object) => Promise<void>, ouvrirLevee: (chantier: Object) => Promise<void>, enCours: boolean }}
 */
export function useOuvrirPv({ onUpdated } = {}) {
  const { settings } = useOrgSettings();
  const company = useMemo(() => buildCompanyInfo(settings), [settings]);
  const { genererPdfPv, genererPdfLeveePv, isPdfPv, isPdfLeveePv } = useChantierPvMutations();
  const [ouverture, setOuverture] = useState(false);

  const ouvrir = async ({ chemin, produire, textes, chantier }) => {
    if (chemin) {
      setOuverture(true);
      const { url, error } = await chantiersService.getPvReceptionUrl(chemin);
      setOuverture(false);
      if (error || !url) { toast.error(textes.illisible); return; }
      window.open(url, '_blank');
      return;
    }
    try {
      const res = await produire({ chantier, company });
      window.open(URL.createObjectURL(res.blob), '_blank');
      if (!res.archive) toast.warning(textes.nonArchive);
      res.avertissements?.forEach((message) => toast.warning(message));
      onUpdated?.();
    } catch (err) {
      toast.error(err?.message || textes.echec);
    }
  };

  return {
    ouvrirPv: (chantier) => ouvrir({ chemin: chantier.pv_reception_path, produire: genererPdfPv, textes: TEXTES.pv, chantier }),
    ouvrirLevee: (chantier) => ouvrir({ chemin: chantier.pv_levee_path, produire: genererPdfLeveePv, textes: TEXTES.levee, chantier }),
    enCours: ouverture || isPdfPv || isPdfLeveePv,
  };
}
