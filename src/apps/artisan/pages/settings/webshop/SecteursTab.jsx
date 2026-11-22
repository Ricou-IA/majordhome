// src/apps/artisan/pages/settings/webshop/SecteursTab.jsx
// Settings → Webshop → Secteurs : liste des secteurs de livraison palette, édition
// (SecteurEditor) et régénération des créneaux à venir.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, RefreshCw } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useWebshopSettingsMutations, useWebshopSettingsSectors } from '@hooks/useWebshopSettings';
import { buildWebshopConfig, depotParCode } from '@/lib/webshop/reglages';
import { JOURS, centsVersEuros, messageErreurWebshop, normaliserRecurrence } from '@/lib/webshop/settingsForm';
import { CARD, Chargement } from './common';
import SecteurEditor from './SecteurEditor';

const jour = (d) => JOURS.find((j) => j.value === d)?.label ?? `j${d}`;
const resumePassages = (rec) => {
  const liste = normaliserRecurrence(rec);
  return liste.length ? liste.map((r) => `S${r.week} ${jour(r.weekday)}`).join(', ') : 'Aucun jour de passage';
};

export default function SecteursTab() {
  const { settings } = useOrgSettings();
  const cfg = useMemo(() => buildWebshopConfig(settings), [settings]);
  const { data: secteurs = [], isLoading, error } = useWebshopSettingsSectors();
  const { regenerateSlots, isRegenerating } = useWebshopSettingsMutations();
  const [edition, setEdition] = useState(null); // null | { secteur: object|null }
  const [confirmer, setConfirmer] = useState(false);
  const [resultat, setResultat] = useState(null);

  const regenerer = async () => {
    try {
      const r = await regenerateSlots();
      setResultat(r);
      toast.success(`Créneaux régénérés : ${r?.supprimes ?? 0} supprimé(s), ${r?.crees ?? 0} créé(s)`);
      setConfirmer(false);
    } catch (err) {
      toast.error(messageErreurWebshop(err));
    }
  };

  if (isLoading) return <Chargement />;
  if (error) return <p className="text-sm text-red-600">Chargement des secteurs impossible : {error.message}</p>;

  if (edition) {
    return (
      <div className="max-w-3xl">
        <SecteurEditor key={edition.secteur?.id ?? 'nouveau'} secteur={edition.secteur} cfg={cfg} onClose={() => setEdition(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-secondary-600">{secteurs.length} secteur{secteurs.length > 1 ? 's' : ''}. Un secteur désactivé ne reçoit plus de nouveaux créneaux.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirmer(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-secondary-300 text-sm text-secondary-700 hover:bg-secondary-50">
            <RefreshCw className="w-4 h-4" /> Régénérer les créneaux à venir
          </button>
          <button type="button" onClick={() => setEdition({ secteur: null })} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700">
            <Plus className="w-4 h-4" /> Nouveau secteur
          </button>
        </div>
      </div>

      {resultat && (
        <p className="text-sm text-secondary-700">
          Dernière régénération : {resultat.supprimes ?? 0} créneau(x) supprimé(s), {resultat.crees ?? 0} créé(s).
        </p>
      )}

      <div className={`${CARD} p-0 divide-y divide-secondary-100`}>
        {secteurs.length === 0 && <p className="p-5 text-sm text-secondary-500">Aucun secteur.</p>}
        {secteurs.map((s) => (
          <div key={s.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 text-sm ${s.is_active ? '' : 'opacity-50'}`}>
            <div className="flex-1 min-w-[14rem]">
              <div className="font-medium text-secondary-900">{s.label} <span className="text-xs text-secondary-400">({s.code})</span>{!s.is_active && <span className="ml-2 text-xs text-secondary-500">inactif</span>}</div>
              <div className="text-xs text-secondary-500">{depotParCode(cfg, s.depot).libelle} · {resumePassages(s.recurrence)}</div>
            </div>
            <span className="text-xs text-secondary-600">{s.max_stops} arrêts · {s.max_km} km · {s.max_minutes} min</span>
            <span className="text-xs font-medium w-24 text-right">{centsVersEuros(s.slot_price_ttc_cents)} € / empl.</span>
            <button type="button" onClick={() => setEdition({ secteur: s })} className="p-1.5 text-secondary-400 hover:text-primary-600" aria-label={`Modifier le secteur ${s.label}`}>
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmer}
        onOpenChange={setConfirmer}
        variant="default"
        title="Régénérer les créneaux à venir"
        description={`Les créneaux ouverts et vides au-delà de la fenêtre de fermeture (J-${cfg.palette.delai_fermeture_jours}) sont supprimés puis recréés d’après les jours de passage actuels. Les créneaux portant une commande, fermés ou dans la fenêtre de fermeture ne bougent pas.`}
        confirmLabel="Régénérer"
        onConfirm={regenerer}
        loading={isRegenerating}
      />
    </div>
  );
}
