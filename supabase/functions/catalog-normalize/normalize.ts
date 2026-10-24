// supabase/functions/catalog-normalize/normalize.ts
// Logique pure de la normalisation des modèles par l'IA : prompt par lot, lecture tolérante de la réponse, seuil.
// Testée dans normalize.test.ts. La clé normalisée est celle de _shared/catalogue/modelKey.js (même règle que la
// clé dérivée des libellés au relevé) : un modèle trouvé par l'IA et un modèle lu dans un libellé se rejoignent.

export const SEUIL_CONFIANCE = 0.9;
export const TAILLE_LOT = 50;

export interface ArticleAPrompt {
  reference: string;
  name: string;
  brand?: string | null;
  gamme?: string | null;
  specs?: { canonical?: Record<string, unknown> } | null;
}

export interface ModeleTrouve { reference: string; brand: string | null; model: string | null; confiance: number }

/** Clés de specs.canonical utiles pour identifier un modèle (le stock, les liens, les dates n'aident pas). */
const SPECS_UTILES = ["mpn", "fabricant", "energie_utile_kwh", "puissance_wc", "type_batterie", "technologie_cellules", "categories", "description_courte", "attributs", "slug"];

function specsUtiles(a: ArticleAPrompt): string {
  const c = a.specs?.canonical || {};
  const parts: string[] = [];
  for (const k of SPECS_UTILES) {
    const v = c[k];
    if (v == null || v === "") continue;
    parts.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join(" ; ").slice(0, 400);
}

/** Prompt d'un lot : une ligne par article, sortie JSON stricte. */
export function construirePrompt(articles: ArticleAPrompt[]): string {
  const lignes = articles.map((a) => {
    const champs = [`reference=${a.reference}`, `nom=${a.name}`];
    if (a.brand) champs.push(`marque=${a.brand}`);
    if (a.gamme) champs.push(`gamme=${a.gamme}`);
    const s = specsUtiles(a);
    if (s) champs.push(`specs=${s}`);
    return `- ${champs.join(" | ")}`;
  });
  return [
    "Tu es un acheteur spécialisé en matériel photovoltaïque, onduleurs, batteries de stockage et bornes de recharge.",
    "Pour chaque article de catalogue grossiste ci-dessous, identifie la MARQUE (fabricant) et le MODÈLE FABRICANT exact",
    "tel qu'il figure sur la fiche technique du constructeur (ex. « LUNA2000-7-E1 », « SUN2000-5K-LB0 », « HMS-1000-2T »,",
    "« IQ Battery 5P », « Powerwall 3 »). Le modèle est la référence commerciale du constructeur, pas la référence du",
    "grossiste, pas une famille seule (« SUN2000 » n'est pas un modèle) et pas une caractéristique (« 5 kWh »).",
    "Un accessoire (câble, support, kit) a son propre modèle s'il en a un ; sinon model = null.",
    "Indique une confiance entre 0 et 1 : 0.95+ si le modèle est lisible tel quel, 0.5 si tu le déduis, 0.2 si tu devines.",
    "",
    "Réponds UNIQUEMENT par un tableau JSON, sans commentaire, une entrée par article, dans l'ordre :",
    '[{"reference": "…", "brand": "…", "model": "…" ou null, "confiance": 0.0}]',
    "",
    "Articles :",
    ...lignes,
  ].join("\n");
}

/** Lecture tolérante de la réponse : JSON brut, ou entouré de texte / ```json ; entrées invalides ignorées. */
export function parseNormalizeResponse(text: string): ModeleTrouve[] {
  const brut = String(text || "");
  const debut = brut.indexOf("[");
  const fin = brut.lastIndexOf("]");
  if (debut < 0 || fin <= debut) return [];
  let arr: unknown;
  try { arr = JSON.parse(brut.slice(debut, fin + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: ModeleTrouve[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const reference = typeof o.reference === "string" ? o.reference.trim() : "";
    if (!reference) continue;
    const confiance = Number(o.confiance);
    if (!Number.isFinite(confiance) || confiance < 0 || confiance > 1) continue;
    const model = typeof o.model === "string" && o.model.trim() ? o.model.trim() : null;
    const brand = typeof o.brand === "string" && o.brand.trim() ? o.brand.trim() : null;
    out.push({ reference, brand, model, confiance });
  }
  return out;
}
