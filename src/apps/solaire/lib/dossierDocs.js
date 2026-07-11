// src/apps/solaire/lib/dossierDocs.js
// Modèle PUR de la notice descriptive du dossier PV (déclaration préalable) —
// source unique consommée par NoticePDF.jsx. Aucun import React/Supabase/alias :
// testé via `node --test scripts/dossier-docs.test.mjs`.
import { buildCerfaDescription } from './cerfa16702.js';

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/** Azimut compas 0..360 (0=N, horaire) → point cardinal 8 points. */
export function compassLabel(azimuthCompass) {
  if (azimuthCompass == null || Number.isNaN(Number(azimuthCompass))) return '—';
  const idx = Math.round((((Number(azimuthCompass) % 360) + 360) % 360) / 45) % 8;
  return COMPASS_8[idx];
}

// « 12 bis rue X 81600 Gaillac » (format BAN) → composantes du CERFA. Best effort :
// les champs restent éditables dans la modale de validation, jamais bloquant.
const ADDR_FULL_RE = /^(\d+\s?(?:bis|ter|quater)?)\s+(.+?)\s+(\d{5})\s+(.+)$/i;
const ADDR_CP_RE = /^(.+?)\s+(\d{5})\s+(.+)$/;

export function parseAddressFR(raw) {
  const s = String(raw ?? '').trim();
  const empty = { numero: '', voie: '', lieudit: '', code_postal: '', localite: '' };
  if (!s) return empty;
  const full = ADDR_FULL_RE.exec(s);
  if (full) return { numero: full[1], voie: full[2], lieudit: '', code_postal: full[3], localite: full[4] };
  const cp = ADDR_CP_RE.exec(s);
  if (cp) return { numero: '', voie: cp[1], lieudit: '', code_postal: cp[2], localite: cp[3] };
  return { ...empty, voie: s };
}

const ASPECT_LABELS = {
  full_black: 'noir uniforme (full black), cadre et fond noirs',
  standard: 'standard (cellules sombres, cadre aluminium)',
};

/**
 * Dossier + simulation → modèle de la notice descriptive.
 * Tous les champs ont un fallback propre (jamais « undefined » dans le rendu).
 */
export function buildNoticeModel({ dossier, simulation, config }) {
  const material = dossier?.material ?? {};
  const cadastre = dossier?.cadastre ?? null;
  const abf = dossier?.abf ?? null;

  const kwc = simulation?.results?.selectedKwc
    ?? simulation?.results?.recommendedKwc
    ?? simulation?.inputs?.selectedKwc
    ?? 0;
  const panelPowerWc = config?.panel_power_wc || 500;
  const panels = kwc ? Math.round((kwc * 1000) / panelPowerWc) : 0;

  const materiel = [material.module_marque, material.module_modele].filter(Boolean).join(' ')
    || 'Modules photovoltaïques';
  const aspect = material.module_aspect ?? 'full_black';
  const aspectLabel = ASPECT_LABELS[aspect] ?? ASPECT_LABELS.full_black;

  const parcelles = (cadastre?.parcelles ?? []).map((p) => ({
    ref: [p.section, p.numero].filter(Boolean).join(' '),
    prefixe: p.prefixe ?? '',
    superficie_m2: p.superficie_m2 ?? null,
  }));
  const superficieTotaleM2 = parcelles.length && parcelles.every((p) => p.superficie_m2 != null)
    ? parcelles.reduce((s, p) => s + Math.round(p.superficie_m2), 0)
    : null;

  const pans = dossier?.roof_geometry?.source === 'drawn_pans' && dossier.roof_geometry.pans?.length
    ? dossier.roof_geometry.pans.map((p) => ({
        pitchDeg: p.pitchDeg != null ? Math.round(p.pitchDeg) : null,
        orientation: compassLabel(p.azimuthCompass),
        slopeAreaM2: p.slopeAreaM2 != null ? Math.round(p.slopeAreaM2) : null,
      }))
    : null;

  const description = buildCerfaDescription({
    kwc, panels,
    marque: material.module_marque ?? '',
    modele: material.module_modele ?? '',
    aspect,
  });

  const abfProtege = Boolean(abf?.secteur_protege);
  const protectionsLabel = (abf?.protections ?? []).map((p) => p.nom).filter(Boolean).join(' · ');
  const paragraphs = [
    `Les modules seront posés en surimposition, parallèlement au plan de la toiture existante, sans dépassement du faîtage et avec une épaisseur totale inférieure à 15 cm. La couverture existante est conservée sur le reste du versant.`,
    `L'aspect des modules est ${aspectLabel}, disposés en calepinage régulier pour limiter l'impact visuel. Les câbles et coffrets techniques cheminent sous couverture ou en combles — aucun élément technique apparent en façade.`,
    ...(abfProtege
      ? [`Le terrain se situe en secteur protégé (${protectionsLabel || 'périmètre patrimonial'}). Le choix de modules d'aspect ${aspectLabel} et la pose au plan de la couverture visent une insertion discrète, en cohérence avec les prescriptions patrimoniales applicables. Le dossier est susceptible d'être transmis à l'Architecte des Bâtiments de France pour avis.`]
      : []),
  ];

  return {
    client: {
      name: simulation?.client_name ?? '',
      address: simulation?.client_address ?? '',
    },
    terrain: {
      adresse: simulation?.client_address ?? '',
      commune: cadastre ? `${cadastre.nom_com ?? ''} (${cadastre.commune_insee ?? ''})`.trim() : '',
      parcelles,
      superficieTotaleM2,
    },
    projet: {
      kwc,
      panels,
      materiel,
      aspectLabel,
      surfaceM2: simulation?.inputs?.roof?.surfaceM2 ?? null,
      pans,
      description,
    },
    insertion: {
      abfProtege,
      protectionsLabel,
      paragraphs,
    },
  };
}
