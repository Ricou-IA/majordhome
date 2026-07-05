// src/apps/thermique/components/wizard/PacSection.jsx
// Volet PAC de l'étape 4 (wizard Thermique) : régime d'eau, source machine (catalogue hplib
// lazy-loadé OU points constructeur saisis), prix kWh — chaque changement remonte via
// onPatchPac (PATCH_PAC), le modèle est recalculé par Step4Resultats (source de calcul unique).
// Résultats (model.pac) : bivalence / appoint / couverture + conso annuelle + graphe Recharts
// (série Besoin via courbeCharge, série PAC via pThAt ou pThManuelle — palette deutan : slate,
// bleu, ambre — jamais rouge/vert, R12). Exporte PacResultats, réutilisé par le mode « étude
// rouverte » (résultats figés R7) de Step4Resultats.
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';
import { Info, AlertTriangle, Loader2, Plus, Trash2, Search } from 'lucide-react';
import { REGIMES_EAU } from '../../lib/thermiqueConfig';
import { pacId } from '../../lib/etudeModel';
import {
  copAt, pThAt, pThManuelle, courbeCharge, pointsManuelsValides,
} from '../../lib/heatPumpEngine';

const fmtInt = (v) => Math.round(v).toLocaleString('fr-FR');
const fmtDec1 = (v) => v.toFixed(1).replace('.', ',');

/** Normalisation de recherche : minuscules sans accents (côté requête ET côté catalogue). */
const normalise = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Résultats PAC (bivalence + conso) — aussi affiché en mode « résultats figés » (R7). */
export function PacResultats({ pacModel }) {
  const { bivalence, conso, consoErreur } = pacModel;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-secondary-200 px-3 py-2.5">
          <p className="text-xs text-secondary-500">Point de bivalence</p>
          <p className="text-lg font-semibold text-secondary-900">{fmtDec1(bivalence.thetaBivalence)} °C</p>
        </div>
        <div className="rounded-lg border border-secondary-200 px-3 py-2.5">
          <p className="text-xs text-secondary-500">Appoint nécessaire (à θe)</p>
          <p className="text-lg font-semibold text-secondary-900">{fmtInt(bivalence.appointNecessaire)} W</p>
        </div>
        <div className="rounded-lg border border-secondary-200 px-3 py-2.5">
          <p className="text-xs text-secondary-500">Taux de couverture</p>
          <p className="text-lg font-semibold text-secondary-900">{Math.round(bivalence.tauxCouverture * 100)} %</p>
        </div>
      </div>

      {bivalence.avertissementChargePartielle && (
        <p className="flex items-start gap-2 text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          Puissances catalogue = points EN 14825 à charge partielle, pas la capacité maximale.
        </p>
      )}

      {consoErreur ? (
        <p className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          Consommation indisponible : {consoErreur}
        </p>
      ) : conso && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-secondary-200 px-3 py-2.5">
            <p className="text-xs text-secondary-500">Besoin de chauffage</p>
            <p className="text-lg font-semibold text-secondary-900">{fmtInt(conso.besoinKwh)} kWh/an</p>
          </div>
          <div className="rounded-lg border border-secondary-200 px-3 py-2.5">
            <p className="text-xs text-secondary-500">Électricité PAC</p>
            <p className="text-lg font-semibold text-secondary-900">{fmtInt(conso.consoElecKwh)} kWh/an</p>
          </div>
          <div className="rounded-lg border border-secondary-200 px-3 py-2.5">
            <p className="text-xs text-secondary-500">Coût estimé</p>
            <p className="text-lg font-semibold text-secondary-900">{fmtInt(conso.coutEuros)} €/an</p>
            <p className="text-xs text-secondary-500">
              fourchette {fmtInt(conso.fourchette.min)}–{fmtInt(conso.fourchette.max)} €
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Graphe de bivalence : Besoin (courbe de charge) vs P_th PAC, ligne verticale à la bivalence. */
function GraphBivalence({ model, pac, machine, config }) {
  const data = useMemo(() => {
    const thetaNC = config.theta_non_chauffage;
    const charge = courbeCharge({ phiTotal: model.bilan.total, thetaBase: model.thetaE, thetaNC });
    const manuels = pac.mode === 'manuelle' ? pointsManuelsValides(pac.points) : null;
    const rows = [];
    for (let t = model.thetaE - 2; t <= thetaNC; t += 1) {
      const pth = manuels
        ? pThManuelle(manuels, t)
        // pThAt lève hors tExt [-30, 45] → clamp (θe − 2 reste largement dedans en métropole)
        : pThAt(machine, Math.min(45, Math.max(-30, t)), pac.regime);
      rows.push({ theta: t, besoin: Math.round(charge(t)), pacW: Math.round(pth) });
    }
    return rows;
  }, [model, pac, machine, config]);

  return (
    <div>
      <p className="text-xs font-medium text-secondary-600 mb-1">Besoin vs puissance PAC (W) selon θ extérieure</p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
          <XAxis
            dataKey="theta"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${v}°`}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            labelFormatter={(v) => `θext ${v} °C`}
            formatter={(value, name) => [`${fmtInt(value)} W`, name]}
          />
          <ReferenceLine
            x={model.pac.bivalence.thetaBivalence}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            label={{ value: 'Bivalence', fontSize: 11, fill: '#b45309', position: 'top' }}
          />
          {/* Sans animation : data recréé à chaque PATCH_PAC → la re-animation 1,5 s ferait
              clignoter le graphe à chaque frappe (jank tablette). */}
          <Line type="monotone" dataKey="besoin" name="Besoin" stroke="#334155" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="pacW" name="PAC" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.pac          state.pac du wizard { regime, mode, pacId, points, scopManuel, prixKwh }
 * @param {Function} props.onPatchPac dispatch PATCH_PAC
 * @param {Object} props.model        modèle live (buildEtudeModel) — model.pac null tant que la
 *   machine n'est pas résolue (catalogue non chargé / < 2 points valides)
 * @param {Object} props.config       buildThermiqueConfig(settings)
 * @param {Object|null} props.pacCatalogue catalogue lazy-loadé (null pendant le chargement)
 * @param {boolean} props.pacLoading  chargement du catalogue en cours
 */
export default function PacSection({ pac, onPatchPac, model, config, pacCatalogue, pacLoading }) {
  const [recherche, setRecherche] = useState('');

  const machine = pac.mode === 'catalogue' && pac.pacId && pacCatalogue
    ? pacCatalogue.pacs.find((p) => pacId(p) === pac.pacId) ?? null
    : null;

  // Index de recherche pré-normalisé UNE fois (NFD + strip accents sur les 9 247 entrées à
  // chaque frappe serait coûteux) ; seule la requête est normalisée au filtrage.
  const indexRecherche = useMemo(
    () => pacCatalogue?.pacs.map((p) => ({ p, cle: normalise(`${p.fabricant} ${p.modele}`) })) ?? null,
    [pacCatalogue],
  );

  // Recherche fabricant + modèle normalisés, génériques en tête, 30 premiers résultats.
  const resultats = useMemo(() => {
    if (!indexRecherche) return [];
    const q = normalise(recherche.trim());
    const liste = (q === '' ? indexRecherche : indexRecherche.filter((e) => e.cle.includes(q)))
      .map((e) => e.p);
    return [...liste.filter((p) => p.generique), ...liste.filter((p) => !p.generique)].slice(0, 30);
  }, [indexRecherche, recherche]);

  const activeManuelle = () => {
    const patch = { mode: 'manuelle' };
    // Amorce 2 lignes aux θ constructeur usuels (−7 / +7 °C) — puissances à compléter.
    if (!Array.isArray(pac.points) || pac.points.length < 2) {
      patch.points = [{ tExt: -7, pTh: null }, { tExt: 7, pTh: null }];
    }
    onPatchPac(patch);
  };

  const setPoint = (i, champ, brut) => {
    const valeur = brut === '' ? null : Number(brut);
    onPatchPac({ points: pac.points.map((pt, j) => (j === i ? { ...pt, [champ]: valeur } : pt)) });
  };

  const numberInputClass = 'px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500';
  const nbPointsValides = pointsManuelsValides(pac.points).length;

  return (
    <div className="space-y-4">
      {/* Régime d'eau */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-secondary-700">Régime d’eau</span>
        <div className="flex items-center gap-1">
          {REGIMES_EAU.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onPatchPac({ regime: r })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                pac.regime === r ? 'bg-primary-50 text-primary-700' : 'text-secondary-600 hover:bg-secondary-100'
              }`}
            >
              {r} °C
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-secondary-600 ml-auto">
          Prix kWh
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.0001"
            value={pac.prixKwh ?? ''}
            onChange={(e) => onPatchPac({ prixKwh: e.target.value === '' ? null : Number(e.target.value) })}
            className={`${numberInputClass} w-24`}
            aria-label="Prix du kWh (€)"
          />
          €
        </label>
      </div>

      {/* Source machine */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPatchPac({ mode: 'catalogue' })}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            pac.mode === 'catalogue' ? 'bg-primary-50 text-primary-700' : 'text-secondary-600 hover:bg-secondary-100'
          }`}
        >
          Catalogue
        </button>
        <button
          type="button"
          onClick={activeManuelle}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            pac.mode === 'manuelle' ? 'bg-primary-50 text-primary-700' : 'text-secondary-600 hover:bg-secondary-100'
          }`}
        >
          Saisie constructeur
        </button>
      </div>

      {pac.mode === 'catalogue' && (
        <div className="space-y-2">
          {machine && (
            <p className="text-sm text-secondary-900 bg-primary-50 border border-primary-100 rounded-lg px-3 py-2">
              <span className="font-medium">{machine.fabricant} — {machine.modele}</span>
              <span className="text-secondary-600"> · COP à +7/35 : {copAt(machine, 7, 35).toFixed(2)}</span>
            </p>
          )}
          {pacLoading ? (
            <p className="flex items-center gap-2 text-sm text-secondary-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement du catalogue…
            </p>
          ) : pacCatalogue && (
            <>
              <div className="relative">
                <Search className="w-4 h-4 text-secondary-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder="Rechercher fabricant ou modèle…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <ul className="border border-secondary-200 rounded-lg divide-y divide-secondary-100 max-h-64 overflow-y-auto">
                {resultats.length === 0 && (
                  <li className="px-3 py-2 text-sm text-secondary-500">Aucune machine ne correspond.</li>
                )}
                {resultats.map((p) => {
                  const id = pacId(p);
                  const active = id === pac.pacId;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => onPatchPac({ mode: 'catalogue', pacId: id })}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                          active ? 'bg-primary-50 text-primary-800' : 'hover:bg-secondary-50 text-secondary-800'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{p.fabricant}</span> — {p.modele}
                          {p.generique && <span className="text-xs text-secondary-500"> (générique)</span>}
                        </span>
                        <span className="text-xs text-secondary-500 flex-shrink-0">
                          COP +7/35 : {copAt(p, 7, 35).toFixed(2)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {pac.mode === 'manuelle' && (
        <div className="space-y-2">
          <p className="text-xs text-secondary-500">
            Points de puissance constructeur (P thermique au régime choisi) — 2 points minimum.
          </p>
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs text-secondary-500">
                <th className="pr-3 pb-1 font-medium">θ ext (°C)</th>
                <th className="pr-3 pb-1 font-medium">P th (W)</th>
                <th className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {pac.points.map((pt, i) => (
                // Index en clé : lignes sans identité propre, réordonnancement impossible (ajout/suppression seulement)
                <tr key={i}>
                  <td className="pr-3 py-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={pt.tExt ?? ''}
                      onChange={(e) => setPoint(i, 'tExt', e.target.value)}
                      className={`${numberInputClass} w-24`}
                      aria-label={`θ extérieure du point ${i + 1} (°C)`}
                    />
                  </td>
                  <td className="pr-3 py-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={pt.pTh ?? ''}
                      onChange={(e) => setPoint(i, 'pTh', e.target.value)}
                      className={`${numberInputClass} w-28`}
                      aria-label={`Puissance thermique du point ${i + 1} (W)`}
                    />
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      onClick={() => onPatchPac({ points: pac.points.filter((_, j) => j !== i) })}
                      disabled={pac.points.length <= 2}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Supprimer le point"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => onPatchPac({ points: [...pac.points, { tExt: null, pTh: null }] })}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-secondary-600 hover:bg-secondary-100 border border-secondary-300 rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" /> Ajouter un point
          </button>
          {nbPointsValides < 2 && (
            <p className="text-xs text-amber-700">
              Complétez au moins 2 points valides (P th &gt; 0) pour calculer la bivalence.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-secondary-700">
            SCOP constructeur
            <input
              type="number"
              inputMode="decimal"
              min={0.1}
              step="0.1"
              value={pac.scopManuel ?? ''}
              onChange={(e) => onPatchPac({ scopManuel: e.target.value === '' ? null : Number(e.target.value) })}
              className={`${numberInputClass} w-24`}
            />
            <span className="text-xs text-secondary-500">obligatoire pour l’estimation de consommation</span>
          </label>
        </div>
      )}

      {/* Résultats + graphe (dès que la machine est résolue par le modèle) */}
      {model.pac && (
        <>
          <PacResultats pacModel={model.pac} />
          <GraphBivalence model={model} pac={pac} machine={machine} config={config} />
        </>
      )}
    </div>
  );
}
