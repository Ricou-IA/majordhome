// Familles de devis (types de projet) : passage écran ⇄ réglages, partagé par Mon activité (grille et détail).
// ⚠ merge JSONB niveau 1 : on sauve l'objet `devis` COMPLET (réglages existants conservés, seules les familles changent).
import { typeChapitreDeduit } from '@/lib/devisConfig.js';

/** Familles de la config effective, copiées pour l'édition. */
export const depuisConfig = (c) => c.familles.map((f) => ({ ...f, chapitres: f.chapitres.map((ch) => ({ ...ch })), sections: [...f.sections] }));

/** Même normalisation que l'enregistrement du modèle de devis (DevisSettings.versSettings). */
export const versSettings = (familles) => familles.map((f) => {
  const source = f.chapitres || (f.sections || []).map((t) => ({ titre: t, type: typeChapitreDeduit(t) }));
  const chapitres = source.map((c) => ({ titre: String(c.titre || '').trim(), type: c.type })).filter((c) => c.titre);
  return { ...f, label: f.label.trim(), tva: Number(f.tva ?? 10), chapitres, sections: chapitres.map((c) => c.titre) };
});

/** Patch d'enregistrement des familles, réglages `devis` existants conservés. */
export const patchFamilles = (settings, familles) => ({ devis: { ...(settings?.devis || {}), familles: versSettings(familles) } });
