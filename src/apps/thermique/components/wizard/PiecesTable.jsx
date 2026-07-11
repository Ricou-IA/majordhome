// src/apps/thermique/components/wizard/PiecesTable.jsx
// Tableau éditable de pièces paramétriques (étape 2, saisie parametrique) — un <tr> par pièce du
// niveau actif. Chaque édition produit une nouvelle `saisie` (immuable) remontée via onChange.
// Re-défaut θint/chauffée au changement de type (v1 simple : re-défaute θint seulement si vide).
import { Plus, Trash2 } from 'lucide-react';
import { TYPES_PIECE, typePieceInfo, LNC_PRESETS } from '../../lib/thermiqueConfig';

const MENUISERIES = [
  { id: 'fenetre', label: 'Fenêtre' }, { id: 'porteFenetre', label: 'Porte-fenêtre' }, { id: 'porte', label: 'Porte' },
];
const num = (v) => (v === '' || v == null ? null : Number(v));

// Classes locales SANS `w-full` (contrairement à inputClass/selectClass de FormFields, dont le
// `w-full` écrasait les largeurs de colonne w-16/w-20/…) + padding dense adapté à une table.
// Spinners des inputs number masqués ([appearance:textfield] + pseudo-éléments webkit) → gain de
// largeur, saisie numérique conservée. Sans effet sur l'input texte (Nom) qui n'a pas de spinner.
const champ = 'px-2 py-1 text-sm bg-white border border-secondary-300 rounded-lg text-secondary-900 outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:[-webkit-appearance:none] [&::-webkit-outer-spin-button]:[-webkit-appearance:none]';
const champSelect = `${champ} appearance-none`;

export default function PiecesTable({ saisie, config, onChange, niveauActifId }) {
  const niveau = saisie.niveaux.find((n) => n.id === niveauActifId);
  const pieces = saisie.pieces.filter((p) => p.niveauId === niveauActifId);

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
      mlMurExterieur: 0, mlMurLocalNonChauffe: 0, bLocalNonChauffe: 0.6, surfaceOuverture: 0, typeMenuiserie: 'fenetre',
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
              <th className="py-1.5 pr-2 font-medium">Ouverture (m²)</th>
              <th className="py-1.5 pr-2 font-medium">Menuiserie</th>
              <th className="py-1.5 pr-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {pieces.map((p) => (
              <tr key={p.id}>
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
                  <input
                    type="number" value={p.surfaceOuverture ?? ''} min={0} step={0.1}
                    onChange={(e) => majPiece(p.id, { surfaceOuverture: num(e.target.value) })}
                    className={`${champ} w-16 text-right`}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <select
                    value={p.typeMenuiserie} onChange={(e) => majPiece(p.id, { typeMenuiserie: e.target.value })}
                    className={`${champSelect} w-32`}
                  >
                    {MENUISERIES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
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
            ))}
            {pieces.length === 0 && (
              <tr>
                <td colSpan={13} className="py-4 text-center text-xs text-secondary-400">
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
