// src/apps/artisan/pages/settings/webshop/useWebshopReglagesForm.js
// État d'édition des réglages scalaires `settings.webshop` pour un onglet de Settings → Webshop.
// Chaque onglet part de `buildWebshopConfig(settings)`, valide la SAISIE BRUTE (`validerSaisie`)
// et enregistre l'objet `webshop` COMPLET (merge JSONB niveau 1 côté base).
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildWebshopConfig } from '@/lib/webshop/reglages';
import { formDepuisConfig, validerSaisie, webshopAEnregistrer } from '@/lib/webshop/settingsForm';

/**
 * @param {{ depotsUtilises?: string[] }} [ctx]
 */
export function useWebshopReglagesForm(ctx = {}) {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const cfg = useMemo(() => buildWebshopConfig(settings), [settings]);
  const initial = useMemo(() => formDepuisConfig(cfg), [cfg]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);

  const depotsUtilises = ctx.depotsUtilises;
  const erreurs = useMemo(() => validerSaisie(form, { depotsUtilises }), [form, depotsUtilises]);
  const nbErreurs = Object.keys(erreurs).length;
  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);

  /** @param {string} champ @param {any} valeur */
  const set = (champ, valeur) => setForm((f) => ({ ...f, [champ]: valeur }));

  const enregistrer = async () => {
    if (nbErreurs) return;
    try {
      await save({ webshop: webshopAEnregistrer(form, settings?.webshop) });
      toast.success('Réglages du webshop enregistrés');
    } catch (err) {
      toast.error(`Enregistrement impossible : ${err.message}`);
    }
  };

  return {
    cfg, form, set, setForm, erreurs, isDirty, isSaving, isLoading, enregistrer,
    peutEnregistrer: isDirty && nbErreurs === 0 && !isSaving,
    annuler: () => setForm(initial),
  };
}
