import { useParams } from 'react-router-dom';
import { Eye, Loader2 } from 'lucide-react';
import { useChantierGaillacPartage } from '../useChantierGaillac';
import GaillacBoard from '../components/GaillacBoard';

/**
 * /gaillac/:token — suivi du chantier Gaillac en LECTURE SEULE pour un tiers, sans compte.
 * Filtres disponibles, aucune saisie. Les colonnes internes (durées, achats, observations,
 * commentaires) ne sont pas envoyées par la base (RPC chantier_gaillac_partage_lire).
 */
export default function ChantierGaillacPartage() {
  const { token } = useParams();
  const { data, isLoading, error, isFetching, dataUpdatedAt } = useChantierGaillacPartage(token);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Chantier Gaillac – Préconisations P2</h1>
            <p className="mt-1 text-sm text-slate-600">Mayer Énergie pour Veolia · devis D-2026-09452 et D-2026-09411</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1565C0] bg-[#E3EEFB] px-3 py-1 text-xs font-semibold text-[#0D47A1]">
            <Eye className="h-3.5 w-3.5" aria-hidden />Consultation seule
          </span>
        </header>

        {isLoading ? (
          <div className="flex items-center gap-2 py-12 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Chargement du suivi…
          </div>
        ) : error || !data ? (
          <div role="alert" className="rounded-xl border border-[#F5C542] bg-[#FFF4D1] p-4 text-sm text-[#6B4E00]">
            Ce lien n’est pas valide ou a été désactivé. Demandez un nouveau lien à Mayer Énergie.
          </div>
        ) : (
          <GaillacBoard
            readOnly
            taches={data.taches || []}
            planning={data.planning || []}
            techniciens={data.techniciens || []}
            isFetching={isFetching}
            dataUpdatedAt={dataUpdatedAt}
          />
        )}
      </div>
    </div>
  );
}
