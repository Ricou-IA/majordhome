// src/apps/thermique/components/wizard/PiecesTable.jsx
// Tableau éditable de pièces paramétriques (étape 2, saisie parametrique) — un <tr> par pièce du
// niveau actif. Chaque édition produit une nouvelle `saisie` (immuable) remontée via onChange.
// Ouvertures MULTIPLES par pièce (2026-07-15) : la colonne « Ouvertures » ouvre une sous-ligne
// dépliable listant les menuiseries { type, surface, U } — U éditable par ouverture (vide = défaut
// global du type). Re-défaut θint/chauffée au changement de type (v1 : re-défaute θint si vide).
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { TYPES_PIECE, TYPES_MENUISERIE, typePieceInfo, normaliseOuvertures, LNC_PRESETS } from '../../lib/thermiqueConfig';
import { InputU } from './CompositionFamille';

const num = (v) => (v === '' || v == null ? null : Number(v));
const fmt1 = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');

// Classes locales SANS `w-full` (contrairement à inputClass/selectClass de FormFields, dont le
// `w-full` écrasait les largeurs de colonne w-16/w-20/…) + padding dense adapté à une table.
// Spinners des inputs number masqués ([appearance:textfield] + pseudo-éléments webkit) → gain de
// largeur, saisie numérique conservée. Sans effet sur l'input texte (Nom) qui n'a pas de spinner.
const champ = 'px-2 py-1 text-sm bg-white border border-secondary-300 rounded-lg text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:[-webkit-appearance:none] [&::-webkit-outer-spin-button]:[-webkit-appearance:none]';
const champSelect = `${champ} appearance-none`;

const NB_COLONNES = 12;   // colSpan des lignes pleine largeur (sous-ligne ouvertures, ligne vide)

export default function PiecesTable({ saisie, config, compositions, onChange, niveauActifId }) {
  const niveau = saisie.niveaux.find((n) => n.id === niveauActifId);
  const pieces = saisie.pieces.filter((p) => p.niveauId === niveauActifId);
  const [depliees, setDepliees] = useState(() => new Set());

  const majPiece = (id, patch) => onChange({
    ...saisie,
    pieces: saisie.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  });
  const ajoute = () => onChange({
    ...saisie,
    pieces: [...saisie.pieces, {
      id: crypto.randomUUID(), niveauId: niveauActifId, nom: `Pièce ${saisie.pieces.length + 1}`,
      typePiece: 'autre', chauffee: typePieceInfo('autre').chauffeeParDefaut, thetaInt: config.theta_int_defauts.autre,
      longueur: 400, largeur: 300, hauteur: niveau?.hauteur ?? 250,
      mlMurExterieur: 0, mlMurLocalNonChauffe: 0, bLocalNonChauffe: 0.6, ouvertures: [],
    }],
  });
  const supprime = (id) => onChange({ ...saisie, pieces: saisie.pieces.filter((p) => p.id !== id) });
  const majType = (id, typePiece) => {
    const p = saisie.pieces.find((x) => x.id === id);
    const patch = { typePiece };
    if (p.thetaInt == null) patch.thetaInt = config.theta_int_defauts[typePiece] ?? config.theta_int_defauts.autre;
    patch.chauffee = typePieceInfo(typePiece).chauffeeParDefaut;
    majPiece(id, patch);
  };

  const toggleDeplie = (id) => setDepliees((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // --- Ouvertures d'une pièce (liste immuable) ---
  const majOuvertures = (piece, ouvertures) => majPiece(piece.id, { ouvertures });
  const ajouteOuverture = (piece) => {
    const ouvertures = normaliseOuvertures(piece);
    majOuvertures(piece, [...ouvertures, { id: crypto.randomUUID(), type: 'fenetre', surface: 1, u: null }]);
  };
  const majOuverture = (piece, ouvId, patch) => majOuvertures(
    piece,
    normaliseOuvertures(piece).map((o) => (o.id === ouvId ? { ...o, ...patch } : o)),
  );
  const supprimeOuverture = (piece, ouvId) => majOuvertures(
    piece,
    normaliseOuvertures(piece).filter((o) => o.id !== ouvId),
  );
  const uDefautType = (type) => compositions?.familles?.[type]?.u ?? null;

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-secondary-900 text-sm">Pièces — {niveau?.nom ?? niveauActifId}</h3>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs text-secondary-500 border-b border-secondary-100 whitespace-nowrap">
              <th className="py-1.5 pr-2 font-medium">Nom</th>
              <th className="py-1.5 pr-2 font-medium">Type</th>
              <th className="py-1.5 pr-2 font-medium text-center">Chauffée</th>
              <th className="py-1.5 pr-2 font-medium">θint</th>
              <th className="py-1.5 pr-2 font-medium">L (cm)</th>
              <th className="py-1.5 pr-2 font-medium">l (cm)</th>
              <th className="py-1.5 pr-2 font-medium">H (cm)</th>
              <th className="py-1.5 pr-2 font-medium">ml mur ext</th>
              <th className="py-1.5 pr-2 font-medium">ml mur LNC</th>
              <th className="py-1.5 pr-2 font-medium">b LNC</th>
              <th className="py-1.5 pr-2 font-medium">Ouvertures</th>
              <th className="py-1.5 pr-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {pieces.map((p) => {
              const ouvertures = normaliseOuvertures(p);
              const surfaceTotale = ouvertures.reduce((s, o) => s + (Number.isFinite(o.surface) ? o.surface : 0), 0);
              const estDepliee = depliees.has(p.id);
              return (
                <Fragment key={p.id}>
                  <tr>
                    <td className="py-1.5 pr-2">
                      <input
                        type="text" value={p.nom} onChange={(e) => majPiece(p.id, { nom: e.target.value })}
                        className={`${champ} w-28`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <select
                        value={p.typePiece} onChange={(e) => majType(p.id, e.target.value)}
                        className={`${champSelect} w-32`}
                      >
                        {TYPES_PIECE.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2 text-center">
                      <input
                        type="checkbox" checked={p.chauffee}
                        onChange={(e) => majPiece(p.id, { chauffee: e.target.checked })}
                        className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      {p.chauffee ? (
                        <input
                          type="number" value={p.thetaInt ?? ''} min={5} max={30}
                          onChange={(e) => majPiece(p.id, { thetaInt: num(e.target.value) })}
                          className={`${champ} w-14 text-right`}
                        />
                      ) : (
                        <span className="text-xs text-secondary-400">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number" value={p.longueur ?? ''} min={0} step={10}
                        onChange={(e) => majPiece(p.id, { longueur: num(e.target.value) })}
                        className={`${champ} w-16 text-right`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number" value={p.largeur ?? ''} min={0} step={10}
                        onChange={(e) => majPiece(p.id, { largeur: num(e.target.value) })}
                        className={`${champ} w-16 text-right`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number" value={p.hauteur ?? ''} min={0} step={10}
                        onChange={(e) => majPiece(p.id, { hauteur: num(e.target.value) })}
                        className={`${champ} w-16 text-right`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number" value={p.mlMurExterieur ?? ''} min={0} step={10}
                        onChange={(e) => majPiece(p.id, { mlMurExterieur: num(e.target.value) })}
                        className={`${champ} w-16 text-right`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number" value={p.mlMurLocalNonChauffe ?? ''} min={0} step={10}
                        onChange={(e) => majPiece(p.id, { mlMurLocalNonChauffe: num(e.target.value) })}
                        className={`${champ} w-16 text-right`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1">
                        <select
                          value={LNC_PRESETS.find((preset) => preset.b === p.bLocalNonChauffe)?.id ?? ''}
                          onChange={(e) => {
                            const preset = LNC_PRESETS.find((x) => x.id === e.target.value);
                            if (preset) majPiece(p.id, { bLocalNonChauffe: preset.b });
                          }}
                          className={`${champSelect} w-24`}
                        >
                          <option value="">Perso</option>
                          {LNC_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                        </select>
                        <input
                          type="number" value={p.bLocalNonChauffe ?? ''} min={0} max={1} step={0.05}
                          onChange={(e) => majPiece(p.id, { bLocalNonChauffe: num(e.target.value) })}
                          className={`${champ} w-14 text-right`}
                        />
                      </div>
                    </td>
                    <td className="py-1.5 pr-2">
                      <button
                        type="button" onClick={() => toggleDeplie(p.id)}
                        className="flex items-center gap-1 px-2 py-1 text-sm text-secondary-700 hover:bg-secondary-100 rounded-lg whitespace-nowrap"
                        title="Éditer les ouvertures de la pièce"
                      >
                        {estDepliee ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {ouvertures.length === 0
                          ? <span className="text-secondary-400">aucune</span>
                          : <span>{ouvertures.length} · {fmt1(surfaceTotale)} m²</span>}
                      </button>
                    </td>
                    <td className="py-1.5 pr-1">
                      <button
                        type="button" onClick={() => supprime(p.id)} title="Supprimer la pièce"
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  {estDepliee && (
                    <tr className="bg-secondary-50/60">
                      <td colSpan={NB_COLONNES} className="py-2 px-2">
                        <div className="pl-3 border-l-2 border-primary-200 space-y-2">
                          <p className="text-xs font-medium text-secondary-600">
                            Ouvertures de « {p.nom} » — U vide = défaut du type
                          </p>
                          {ouvertures.length === 0 && (
                            <p className="text-xs text-secondary-400">Aucune ouverture — le mur extérieur est plein.</p>
                          )}
                          {ouvertures.map((o) => (
                            <div key={o.id} className="flex items-center gap-2 flex-wrap">
                              <select
                                value={o.type} onChange={(e) => majOuverture(p, o.id, { type: e.target.value })}
                                className={`${champSelect} w-36`}
                              >
                                {TYPES_MENUISERIE.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                              </select>
                              <label className="flex items-center gap-1 text-xs text-secondary-600">
                                Surface
                                <input
                                  type="number" value={o.surface ?? ''} min={0} step={0.1}
                                  onChange={(e) => majOuverture(p, o.id, { surface: num(e.target.value) })}
                                  className={`${champ} w-20 text-right`}
                                />
                                m²
                              </label>
                              <label className="flex items-center gap-1 text-xs text-secondary-600">
                                U
                                <InputU
                                  value={Number.isFinite(o.u) ? o.u : null}
                                  onCommit={(u) => majOuverture(p, o.id, { u })}
                                  allowEmpty
                                  placeholder={uDefautType(o.type) != null ? String(uDefautType(o.type)) : '—'}
                                  className="w-20"
                                />
                              </label>
                              <button
                                type="button" onClick={() => supprimeOuverture(p, o.id)}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Supprimer l'ouverture"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button" onClick={() => ajouteOuverture(p)}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg"
                          >
                            <Plus className="w-3.5 h-3.5" /> Ajouter une ouverture
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {pieces.length === 0 && (
              <tr>
                <td colSpan={NB_COLONNES} className="py-4 text-center text-xs text-secondary-400">
                  Aucune pièce sur ce niveau.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button" onClick={ajoute}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg"
      >
        <Plus className="w-4 h-4" /> Ajouter une pièce
      </button>
    </div>
  );
}
