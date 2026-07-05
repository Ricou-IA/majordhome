// src/apps/thermique/components/wizard/Step3OuverturesCompositions.jsx
// Étape 3 du wizard Thermique : pose des ouvertures + compositions des parois.
// — Ouvertures : PlanCanvas mode 'ouverture' (contrat vérifié : le canevas N'AJOUTE RIEN, il émet
//   onSelect({type:'pose-ouverture', pieceId, segmentIndex, position}) au tap près d'un mur) →
//   cette étape applique ajouteOuverture(dessinOps) avec le type/dimensions choisis dans la barre.
//   Position via positionOuvertureSnappee (canvasGeometry) : snap grille 10 cm + clamp
//   [0, longueur − largeur] — un tap en fin de mur ne crée pas d'ouverture qui dépasse ;
//   null (ouverture plus large que le mur) → toast + abandon de la pose. Barre de
//   niveaux ALLÉGÉE (onglets seulement — l'édition des niveaux vit à l'étape 2). Suppression
//   directe sans ConfirmDialog (non destructif au-delà de l'ouverture) + purge de son exception U.
// — Compositions : 3 × CompositionFamille (murs / plancher bas / plafond-toiture) + 3 U
//   menuiseries (fenêtre / porte-fenêtre / porte) avec UwHelperModal sur fenêtre et porte-fenêtre.
// — Exceptions par pièce : tableau replié <details>, clés `${pieceId}:${famille}` avec familles
//   EXACTEMENT 'murs'|'plancherBas'|'plafondToiture' (contrat uPour d'assembleBatiment).
// Le panneau de validation réaffiche dessinCheck (calculé par le wizard — les erreurs de pose
// « dépasse du mur / chevauche » vivent dans valideDessin, pas ici).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Calculator, Layers, Trash2,
} from 'lucide-react';
import { PlanCanvas } from '../canvas/PlanCanvas';
import CanvasErrorBoundary from './CanvasErrorBoundary';
import CompositionFamille, { InputU } from './CompositionFamille';
import UwHelperModal from './UwHelperModal';
import { DIMENSIONS_OUVERTURES } from '../../lib/thermiqueConfig';
import { ajouteOuverture, supprimeOuverture } from '../../lib/dessinOps';
import { positionOuvertureSnappee } from '../../lib/canvasGeometry';
import { segmentsDe, normalisePolygone } from '../../lib/geometryEngine';

const TYPES_OUVERTURE = [
  { id: 'fenetre', label: 'Fenêtre' },
  { id: 'porte-fenetre', label: 'Porte-fenêtre' },
  { id: 'porte', label: 'Porte' },
];
const LABEL_TYPE = Object.fromEntries(TYPES_OUVERTURE.map((t) => [t.id, t.label]));

// type d'ouverture (dessin) → famille de compositions (U menuiserie hérité).
const FAMILLE_PAR_TYPE = { fenetre: 'fenetre', 'porte-fenetre': 'porteFenetre', porte: 'porte' };

const CHAMPS_MENUISERIES = [
  { cle: 'fenetre', label: 'Fenêtre', proposer: true },
  { cle: 'porteFenetre', label: 'Porte-fenêtre', proposer: true },
  { cle: 'porte', label: 'Porte', proposer: false },
];

const FAMILLES_EXCEPTIONS = [
  { cle: 'murs', label: 'Murs' },
  { cle: 'plancherBas', label: 'Plancher' },
  { cle: 'plafondToiture', label: 'Plafond' },
];

export default function Step3OuverturesCompositions({
  dessin,
  compositions,
  annee,
  dessinCheck,
  onDessinChange,
  onPatchCompositions,
  onExceptionParoi,
  onExceptionOuverture,
}) {
  const [niveauActifId, setNiveauActifId] = useState(dessin.niveaux[0]?.id ?? null);
  const [typeOuverture, setTypeOuverture] = useState('fenetre');
  const [largeur, setLargeur] = useState(String(DIMENSIONS_OUVERTURES.fenetre.largeur));
  const [hauteur, setHauteur] = useState(String(DIMENSIONS_OUVERTURES.fenetre.hauteur));
  const [uwTarget, setUwTarget] = useState(null); // null | 'fenetre' | 'porteFenetre'

  // Niveau actif toujours valide (restauration de brouillon, LOAD_STUDY…).
  useEffect(() => {
    if (!dessin.niveaux.some((n) => n.id === niveauActifId)) {
      setNiveauActifId(dessin.niveaux[0]?.id ?? null);
    }
  }, [dessin.niveaux, niveauActifId]);

  const handleType = (id) => {
    setTypeOuverture(id);
    setLargeur(String(DIMENSIONS_OUVERTURES[id].largeur));
    setHauteur(String(DIMENSIONS_OUVERTURES[id].hauteur));
  };

  // Tap sur un mur (onSelect du canevas) → pose immédiate avec le type/dims de la barre.
  const handlePose = (sel) => {
    if (sel?.type !== 'pose-ouverture') return;
    const l = Number(largeur);
    const h = Number(hauteur);
    if (!Number.isInteger(l) || l <= 0 || !Number.isInteger(h) || h <= 0) {
      toast.error('Largeur et hauteur doivent être des entiers positifs (cm)');
      return;
    }
    // Segment porteur (même parcours normalisé que le canevas) → position snappée grille 10 cm
    // et clampée [0, longueur − largeur] pour que l'ouverture tienne ENTIÈREMENT dans le mur.
    const piece = dessin.pieces.find((p) => p.id === sel.pieceId);
    const segment = piece ? segmentsDe(normalisePolygone(piece.polygone))[sel.segmentIndex] : null;
    if (!segment) {
      // Pièce/segment introuvables (dessin modifié entre tap et pose) — échouer fort, pas en silence.
      toast.error('Mur introuvable — reposez l’ouverture');
      return;
    }
    const position = positionOuvertureSnappee(segment, sel.position, l);
    if (position === null) {
      toast.error('Ouverture plus large que le mur');
      return;
    }
    const resultat = ajouteOuverture(dessin, {
      id: crypto.randomUUID(),
      pieceId: sel.pieceId,
      segmentIndex: sel.segmentIndex,
      type: typeOuverture,
      largeur: l,
      hauteur: h,
      position,
    });
    if (resultat.erreurs.length > 0) {
      toast.error(resultat.erreurs[0]);
      return;
    }
    onDessinChange(resultat.dessin);
  };

  const handleSupprime = (ouverture) => {
    const resultat = supprimeOuverture(dessin, ouverture.id);
    if (resultat.erreurs.length > 0) {
      toast.error(resultat.erreurs[0]);
      return;
    }
    onDessinChange(resultat.dessin);
    // Retire aussi son exception U le cas échéant (sinon entrée orpheline dans le state persisté).
    if (compositions.exceptions.ouvertures[ouverture.id]) onExceptionOuverture(ouverture.id, null);
  };

  const piecesNiveauActif = dessin.pieces.filter((p) => p.niveauId === niveauActifId);
  const idsPiecesNiveau = new Set(piecesNiveauActif.map((p) => p.id));
  const ouverturesNiveau = dessin.ouvertures.filter((o) => idsPiecesNiveau.has(o.pieceId));
  const pieceDe = (pieceId) => dessin.pieces.find((p) => p.id === pieceId);

  const piecesChauffees = dessin.pieces.filter((p) => p.chauffee);
  const nomNiveau = (niveauId) => dessin.niveaux.find((n) => n.id === niveauId)?.nom ?? '';

  return (
    <div className="space-y-5">
      {/* ===== Volet ouvertures ===== */}
      <div className="space-y-3">
        {/* Barre de niveaux allégée : onglets seulement (édition des niveaux à l'étape 2) */}
        <div className="card py-3 flex items-center gap-2 flex-wrap">
          <Layers className="w-4 h-4 text-secondary-400 flex-shrink-0" />
          <div className="flex items-center gap-1 flex-wrap">
            {dessin.niveaux.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setNiveauActifId(n.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  n.id === niveauActifId
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-secondary-600 hover:bg-secondary-100'
                }`}
              >
                {n.nom}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-3 items-stretch">
          {/* Canevas + sélecteur de type/dimensions */}
          <div className="flex-1 min-w-0 card p-0 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 p-2 border-b border-secondary-100 flex-wrap">
              <div className="flex items-center gap-1">
                {TYPES_OUVERTURE.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleType(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                      typeOuverture === t.id
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-secondary-600 hover:bg-secondary-100'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1 text-sm text-secondary-600">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={largeur}
                  onChange={(e) => setLargeur(e.target.value)}
                  className="w-16 px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  aria-label="Largeur (cm)"
                />
                ×
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={hauteur}
                  onChange={(e) => setHauteur(e.target.value)}
                  className="w-16 px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  aria-label="Hauteur (cm)"
                />
                cm
              </label>
              <p className="ml-auto text-xs text-secondary-400 pr-1 hidden sm:block">
                Touchez un mur pour poser l’ouverture
              </p>
            </div>
            <div className="h-[420px]">
              <CanvasErrorBoundary>
                <PlanCanvas
                  dessin={dessin}
                  niveauActifId={niveauActifId}
                  selection={null}
                  mode="ouverture"
                  onChange={onDessinChange}
                  onSelect={handlePose}
                />
              </CanvasErrorBoundary>
            </div>
          </div>

          {/* Panneau droit : liste des ouvertures du niveau + validation */}
          <div className="w-full lg:w-80 flex-shrink-0 space-y-3">
            <div className="card space-y-2">
              <h3 className="font-semibold text-secondary-900 text-sm">
                Ouvertures du niveau ({ouverturesNiveau.length})
              </h3>
              {ouverturesNiveau.length === 0 ? (
                <p className="text-sm text-secondary-500">
                  Aucune ouverture — choisissez un type puis touchez un mur.
                </p>
              ) : (
                <ul className="divide-y divide-secondary-100">
                  {ouverturesNiveau.map((o) => {
                    const uHerite = compositions.familles[FAMILLE_PAR_TYPE[o.type]]?.u;
                    return (
                      <li key={o.id} className="py-2 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-secondary-900 truncate">
                              {LABEL_TYPE[o.type] ?? o.type} {o.largeur}×{o.hauteur} cm
                            </p>
                            <p className="text-xs text-secondary-500 truncate">
                              {pieceDe(o.pieceId)?.nom ?? o.pieceId}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSupprime(o)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0"
                            title="Supprimer l’ouverture"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-secondary-600">
                          U forcé
                          <InputU
                            value={compositions.exceptions.ouvertures[o.id]?.u ?? null}
                            onCommit={(u) => onExceptionOuverture(o.id, u)}
                            placeholder={uHerite != null ? String(uHerite) : ''}
                            className="w-20"
                          />
                          <span className="text-secondary-400">vide = U menuiserie</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Validation du plan (les erreurs de pose vivent dans valideDessin) */}
            <div className="card space-y-3">
              <h3 className="font-semibold text-secondary-900 text-sm">Validation du plan</h3>
              {dessinCheck.erreurs.length === 0 && dessinCheck.avertissements.length === 0 ? (
                <p className="flex items-start gap-2 text-sm text-secondary-600">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  Aucun problème détecté.
                </p>
              ) : (
                <ul className="space-y-2">
                  {dessinCheck.erreurs.map((e, i) => (
                    <li key={`err-${i}`} className="flex items-start gap-2 text-sm text-red-700">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{e}</span>
                    </li>
                  ))}
                  {dessinCheck.avertissements.map((a, i) => (
                    <li key={`warn-${i}`} className="flex items-start gap-2 text-sm text-amber-700">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===== Compositions par famille ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <CompositionFamille
          famille="murs"
          label="Murs"
          valeur={compositions.familles.murs}
          annee={annee}
          onPatch={(patch) => onPatchCompositions({ murs: patch })}
        />
        <CompositionFamille
          famille="plancherBas"
          label="Plancher bas"
          valeur={compositions.familles.plancherBas}
          annee={annee}
          onPatch={(patch) => onPatchCompositions({ plancherBas: patch })}
        />
        <CompositionFamille
          famille="plafondToiture"
          label="Plafond / toiture"
          valeur={compositions.familles.plafondToiture}
          annee={annee}
          onPatch={(patch) => onPatchCompositions({ plafondToiture: patch })}
        />
      </div>

      {/* ===== Menuiseries (U des ouvertures) ===== */}
      <div className="card space-y-4">
        <h3 className="font-semibold text-secondary-900 text-sm">Menuiseries — U W/(m²·K)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CHAMPS_MENUISERIES.map(({ cle, label, proposer }) => (
            <div key={cle} className="space-y-1">
              <label className="block text-sm font-medium text-secondary-700">{label}</label>
              <div className="flex items-center gap-1.5">
                <InputU
                  value={compositions.familles[cle]?.u ?? null}
                  onCommit={(u) => onPatchCompositions({ [cle]: { u } })}
                  allowEmpty={false}
                  className="w-24"
                />
                {proposer && (
                  <button
                    type="button"
                    onClick={() => setUwTarget(cle)}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-secondary-600 hover:bg-secondary-100 border border-secondary-300 rounded-lg"
                    title="Proposer depuis les composants (vitrage × menuiserie × volet)"
                  >
                    <Calculator className="w-3.5 h-3.5" /> Proposer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== Exceptions par pièce ===== */}
      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold text-secondary-900">
          Exceptions par pièce (avancé)
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-secondary-500">
            Le U saisi remplace le réglage global pour cette pièce. Vider le champ retire l’exception.
          </p>
          {piecesChauffees.length === 0 ? (
            <p className="text-sm text-secondary-500">Aucune pièce chauffée dans le dessin.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-secondary-500 border-b border-secondary-100">
                    <th className="py-2 pr-3 font-medium">Pièce</th>
                    {FAMILLES_EXCEPTIONS.map((f) => (
                      <th key={f.cle} className="py-2 pr-3 font-medium">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-100">
                  {piecesChauffees.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-3 text-secondary-900">
                        {p.nom}
                        {dessin.niveaux.length > 1 && (
                          <span className="text-xs text-secondary-500"> — {nomNiveau(p.niveauId)}</span>
                        )}
                      </td>
                      {FAMILLES_EXCEPTIONS.map((f) => (
                        <td key={f.cle} className="py-2 pr-3">
                          <InputU
                            value={compositions.exceptions.parois[`${p.id}:${f.cle}`]?.u ?? null}
                            onCommit={(u) => onExceptionParoi(`${p.id}:${f.cle}`, u)}
                            placeholder="—"
                            className="w-24"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      {/* Modale Uw — montée conditionnellement : état interne remis à zéro à chaque ouverture */}
      {uwTarget != null && (
        <UwHelperModal
          champLabel={uwTarget === 'porteFenetre' ? 'Porte-fenêtre' : 'Fenêtre'}
          onApply={(u) => {
            onPatchCompositions({ [uwTarget]: { u } });
            setUwTarget(null);
          }}
          onClose={() => setUwTarget(null)}
        />
      )}
    </div>
  );
}
