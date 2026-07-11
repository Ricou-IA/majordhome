// src/apps/solaire/lib/fillCerfa.js
// Remplissage runtime du CERFA 16702*03 (AcroForm) via pdf-lib, depuis le PDF officiel
// commité en asset (version figée — pas de fetch service-public à la volée).
// Le field map est pur et testé dans cerfa16702.js ; ici : I/O + pdf-lib uniquement.
import { PDFDocument, TextAlignment } from 'pdf-lib';
import { logger } from '@lib/logger';
import cerfaUrl from '../assets/cerfa_16702-03.pdf?url';
import { sanitizeWinAnsi, CERFA_RIGHT_ALIGNED } from './cerfa16702';

const RIGHT_ALIGNED = new Set(CERFA_RIGHT_ALIGNED);

/**
 * Remplit puis aplatit le CERFA. Un champ introuvable/récalcitrant ne bloque pas les
 * autres (warn + compteur) — mais le caller DOIT surfacer `missedFields` s'il y en a
 * (échec silencieux interdit).
 * @param {{ text: Record<string,string>, checks: string[] }} fields
 * @returns {Promise<{ blob: Blob, missedFields: string[] }>}
 */
export async function fillCerfa16702(fields) {
  const res = await fetch(cerfaUrl);
  if (!res.ok) throw new Error(`Chargement du formulaire CERFA impossible (HTTP ${res.status})`);
  const doc = await PDFDocument.load(await res.arrayBuffer());
  const form = doc.getForm();
  const missedFields = [];

  for (const [name, value] of Object.entries(fields.text ?? {})) {
    try {
      const field = form.getTextField(name);
      const safe = sanitizeWinAnsi(value);
      const max = field.getMaxLength();
      field.setText(max != null && safe.length > max ? safe.slice(0, max) : safe);
      if (RIGHT_ALIGNED.has(name)) field.setAlignment(TextAlignment.Right);
    } catch (err) {
      missedFields.push(name);
      logger.warn(`[cerfa] champ texte non rempli : ${name}`, err);
    }
  }
  for (const name of fields.checks ?? []) {
    try {
      form.getCheckBox(name).check();
    } catch (err) {
      missedFields.push(name);
      logger.warn(`[cerfa] case non cochée : ${name}`, err);
    }
  }

  form.flatten();
  const bytes = await doc.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), missedFields };
}
