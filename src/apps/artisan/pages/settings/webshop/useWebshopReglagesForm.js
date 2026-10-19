// src/apps/artisan/pages/settings/webshop/useWebshopReglagesForm.js
// État d'édition des réglages scalaires `settings.webshop` pour un onglet de Settings → Webshop.
// Chaque onglet part de `buildWebshopConfig(settings)`, valide la SAISIE BRUTE (`validerSaisie`)
// et enregistre l'objet `webshop` COMPLET (merge JSONB niveau 1 côté base).
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useAuth } from '@contexts/AuthContext';
import { useMailCampaigns } from '@hooks/useMailCampaigns';
import { buildWebshopConfig } from '@/lib/webshop/reglages';
import {
  formDepuisConfig, validerSaisie, webshopAEnregistrer, processVersForm, webshopAvecProcess,
} from '@/lib/webshop/settingsForm';

/**
 * @param {{ depotsUtilises: string[]|undefined }} [ctx] seulement pour l'onglet qui édite les
 *   dépôts ; `depotsUtilises` undefined (secteurs non chargés) bloque l'enregistrement.
 */
export function useWebshopReglagesForm(ctx) {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const cfg = useMemo(() => buildWebshopConfig(settings), [settings]);
  const initial = useMemo(() => formDepuisConfig(cfg, settings?.webshop), [cfg, settings]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);

  const avecCtx = ctx !== undefined;
  const depotsUtilises = ctx?.depotsUtilises;
  const erreurs = useMemo(
    () => validerSaisie(form, avecCtx ? { depotsUtilises } : undefined),
    [form, avecCtx, depotsUtilises],
  );
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

/**
 * Onglet Process : édite `settings.webshop.process` seul ; l'enregistrement repose `process` sur
 * `settings.webshop` tel qu'en base (objet COMPLET, autres clés intactes).
 */
export function useWebshopProcessForm() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const cfg = useMemo(() => buildWebshopConfig(settings), [settings]);
  const initial = useMemo(() => processVersForm(cfg.process), [cfg]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);

  const enregistrer = async () => {
    try {
      await save({ webshop: webshopAvecProcess(form, settings?.webshop) });
      toast.success('Process du webshop enregistré');
    } catch (err) {
      toast.error(`Enregistrement impossible : ${err.message}`);
    }
  };

  return {
    cfg, form, setForm, isDirty, isSaving, isLoading, enregistrer,
    peutEnregistrer: isDirty && !isSaving,
    annuler: () => setForm(initial),
  };
}

/**
 * Gabarits actifs (non archivés) de l'org dans `majordhome_mail_campaigns` : l'edge du process
 * traite un gabarit archivé comme absent. `cles` vaut undefined tant que l'état est inconnu
 * (chargement ou erreur) — ne jamais en déduire « à créer ».
 */
export function useGabaritsExistants() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  // Même liste que Mailing → Éditeur (non archivés, filtrée par org, `enabled: !!orgId`).
  const q = useMailCampaigns(orgId);
  // `campaigns` vaut [] pendant le chargement, en erreur ou sans org : on ne s'y fie pas.
  const inconnu = !orgId || q.isLoading || !!q.error;
  const cles = useMemo(() => (inconnu ? undefined : q.campaigns.map((c) => c.key)), [inconnu, q.campaigns]);
  return { orgId, cles, isLoading: q.isLoading, error: q.error };
}
