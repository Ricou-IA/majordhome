// Utilitaires de lecture des fichiers du logiciel Thermique historique (ANSI/Windows-1252).
import fs from 'node:fs';
import path from 'node:path';

export const SRC_ROOT = process.env.THERMIQUE_SRC || 'C:/Thermique';
export const OUT_DIR = path.join('src', 'apps', 'thermique', 'data');

/** Lit un fichier source ANSI vers string UTF-8 (latin1 couvre les accents FR de Windows-1252). */
export function readSource(relPath) {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'latin1');
}

export function readSourceLines(relPath) {
  return readSource(relPath).split(/\r?\n/);
}

export function unquote(line) {
  const t = String(line).trim();
  const m = t.match(/^"(.*)"$/s);
  return (m ? m[1] : t).trim();
}

// \s + espace insecable (U+00A0) + espace fine insecable (U+202F), utilisees par les
// exports FR du logiciel Thermique (ex. separateur de milliers des DJU : "2 165").
const NUMERIC_WHITESPACE_RE = /[\s\u00A0\u202F]/g;

// Forme numerique FR attendue : signe optionnel, chiffres (avec espaces de milliers,
// insecables comprises), decimales via virgule ou point. Rejette le reste ("0x10", "1e3"...)
// que Number() coercerait silencieusement.
const FR_NUMBER_RE = /^[+-]?\d[\d\s\u00A0\u202F]*([.,]\d+)?$/;

/** "0,036" | "1 000" | "2 165" | "-5,2" -> number ; vide/non-numerique ("0x10") -> null. */
export function parseFrNumber(raw) {
  if (raw == null) return null;
  if (!FR_NUMBER_RE.test(String(raw).trim())) return null;
  const cleaned = String(raw).replace(NUMERIC_WHITESPACE_RE, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Marques diacritiques combinantes Unicode (U+0300-U+036F), retirees apres normalisation NFD.
const COMBINING_DIACRITICS_RE = /[\u0300-\u036f]/g;

export function stripDiacritics(s) {
  return s.normalize('NFD').replace(COMBINING_DIACRITICS_RE, '');
}

/** Ecrit un JSON de data avec _meta en tete. */
export function writeDataJson(fileName, meta, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = { _meta: { convertedAt: new Date().toISOString().slice(0, 10), ...meta }, ...data };
  fs.writeFileSync(path.join(OUT_DIR, fileName), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`✓ ${fileName}`);
}
