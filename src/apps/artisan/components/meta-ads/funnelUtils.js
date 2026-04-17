/**
 * Utilitaires partagés entre MetaAdsFunnel et MetaAdsCommercialFunnels.
 */

// Benchmarks sectoriels CVC / habitat B2C Lead Ads
export const FUNNEL_BENCHMARKS = {
  pipelineToPlanified: {
    label: 'Pipeline → Planifié',
    good: 50,
    avg: 35,
    hint: 'Taux de joignabilité + qualification. CVC B2C Lead Ads : 35-55% typique. Sous 30%, le ciblage attire trop de spam / faux numéros.',
  },
  planifiedToQuoted: {
    label: 'Planifié → Devis',
    good: 80,
    avg: 65,
    hint: 'Conversion du RDV en devis. CVC : 65-85% typique (si le RDV est qualifié, un devis est presque systématique).',
  },
  quotedToWon: {
    label: 'Devis → Gagné',
    good: 30,
    avg: 20,
    hint: 'Taux de closing. CVC B2C : 15-30% typique. Sous 15%, problème de qualif amont ou de prix/argumentaire.',
  },
  pipelineToWon: {
    label: 'Pipeline → Gagné',
    good: 10,
    avg: 5,
    hint: 'Taux de conversion global sur les leads ingérés. CVC : 5-12% typique.',
  },
};

export const STEP_COLORS = {
  blue: 'bg-blue-50 border-blue-200 text-blue-900',
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-900',
  violet: 'bg-violet-50 border-violet-200 text-violet-900',
  rose: 'bg-rose-50 border-rose-200 text-rose-900',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
};

export function computeRate(numerator, denominator) {
  if (!denominator || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

export function rateColor(rate, benchmark) {
  if (rate == null) return 'text-secondary-400';
  if (rate >= benchmark.good) return 'text-emerald-700';
  if (rate >= benchmark.avg) return 'text-amber-700';
  return 'text-red-700';
}
