// src/apps/thermique/components/wizard/PieceInspector.jsx
// Panneau d'édition de la pièce sélectionnée (étape 2 du wizard Thermique). Toutes les
// mutations passent par les réducteurs purs de dessinOps (renommePiece, basculeChauffee,
// regleThetaInt, supprimePiece) via le callback `applique` fourni par Step2Dessin — qui
// committe le dessin (SET_DESSIN) ou toast.error si l'op refuse (état inchangé). Exception
// prévue par dessinOps : le changement de `typePiece` n'a pas d'op dédiée → patch immutable
// direct de la pièce, committé par `onDessinChange`.
// Re-défaut au changement de type : thetaInt (config.theta_int_defauts[type]) et chauffee
// (typePieceInfo(type).chauffeeParDefaut) ne sont ré-appliqués QUE si l'utilisateur n'a pas
// déjà édité ces champs à la main — flags par pièce tenus par Step2Dessin (estTouche/marqueTouche).
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { FormField, TextInput, SelectInput } from '@apps/artisan/components/FormFields';
import { TYPES_PIECE, typePieceInfo } from '../../lib/thermiqueConfig';
import { surfaceCm2 } from '../../lib/geometryEngine';
import { renommePiece, basculeChauffee, regleThetaInt, supprimePiece } from '../../lib/dessinOps';

const TYPE_OPTIONS = TYPES_PIECE.map((t) => ({ value: t.id, label: t.label }));

export default function PieceInspector({
  piece,
  dessin,
  config,
  onDessinChange,
  applique,
  estTouche,
  marqueTouche,
  onSupprimee,
}) {
  // Drafts locaux (commit au blur/Enter) : renommePiece refuse le nom vide et regleThetaInt
  // borne [5, 30] — committer à chaque frappe toasterait sur les saisies intermédiaires.
  const [nomDraft, setNomDraft] = useState(piece.nom);
  const [thetaDraft, setThetaDraft] = useState(piece.thetaInt == null ? '' : String(piece.thetaInt));
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { setNomDraft(piece.nom); }, [piece.id, piece.nom]);
  useEffect(() => {
    setThetaDraft(piece.thetaInt == null ? '' : String(piece.thetaInt));
  }, [piece.id, piece.thetaInt]);

  const commitNom = () => {
    if (nomDraft.trim() === piece.nom) return;
    if (!applique(renommePiece(dessin, piece.id, nomDraft))) setNomDraft(piece.nom);
  };

  const commitTheta = () => {
    // Champ vidé → thetaInt null (accepté par l'op) : la pièce chauffée sans consigne est
    // signalée en erreur (teinte rouge + panneau), plutôt que de forcer une valeur en douce.
    const valeur = thetaDraft.trim() === '' ? null : Number(thetaDraft);
    if (valeur === piece.thetaInt) return;
    marqueTouche(piece.id, 'theta');
    if (!applique(regleThetaInt(dessin, piece.id, valeur))) {
      setThetaDraft(piece.thetaInt == null ? '' : String(piece.thetaInt));
    }
  };

  const handleType = (typeId) => {
    if (!typeId || typeId === piece.typePiece) return;
    const patch = { typePiece: typeId };
    if (!estTouche(piece.id, 'theta')) {
      patch.thetaInt = config.theta_int_defauts[typeId] ?? config.theta_int_defauts.autre;
    }
    if (!estTouche(piece.id, 'chauffee')) {
      patch.chauffee = typePieceInfo(typeId).chauffeeParDefaut;
    }
    onDessinChange({
      ...dessin,
      pieces: dessin.pieces.map((p) => (p.id === piece.id ? { ...p, ...patch } : p)),
    });
  };

  const handleChauffee = () => {
    marqueTouche(piece.id, 'chauffee');
    applique(basculeChauffee(dessin, piece.id));
  };

  const handleDelete = () => {
    setConfirmDelete(false);
    if (applique(supprimePiece(dessin, piece.id))) onSupprimee(piece.id);
  };

  const surfaceM2 = (surfaceCm2(piece.polygone) / 10000).toFixed(1);
  const nbOuvertures = dessin.ouvertures.filter((o) => o.pieceId === piece.id).length;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-secondary-900 text-sm">Pièce sélectionnée</h3>
        <span className="text-xs text-secondary-500">{surfaceM2} m²</span>
      </div>

      <FormField label="Nom">
        <TextInput
          value={nomDraft}
          onChange={setNomDraft}
          onBlur={commitNom}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </FormField>

      <FormField label="Type de pièce">
        <SelectInput value={piece.typePiece} onChange={handleType} options={TYPE_OPTIONS} />
      </FormField>

      <label className="flex items-center gap-2 text-sm text-secondary-700">
        <input
          type="checkbox"
          className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
          checked={piece.chauffee}
          onChange={handleChauffee}
        />
        Pièce chauffée
      </label>

      {piece.chauffee && (
        <FormField label="Température de consigne θint (°C)">
          <TextInput
            type="number"
            inputMode="decimal"
            min={5}
            max={30}
            value={thetaDraft}
            onChange={setThetaDraft}
            onBlur={commitTheta}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </FormField>
      )}

      <div className="pt-2 border-t border-secondary-100">
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg"
        >
          <Trash2 className="w-4 h-4" /> Supprimer la pièce
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Supprimer « ${piece.nom} »`}
        description={nbOuvertures > 0
          ? `La pièce et ses ${nbOuvertures} ouverture${nbOuvertures > 1 ? 's' : ''} seront supprimées.`
          : 'La pièce sera supprimée du plan.'}
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
