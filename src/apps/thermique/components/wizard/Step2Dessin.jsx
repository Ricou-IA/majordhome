// src/apps/thermique/components/wizard/Step2Dessin.jsx
// Étape 2 du wizard Thermique : dessin du plan. Barre de niveaux (onglets + ajout/duplication/
// hauteur/suppression), barre d'outils (Sélection / Rectangle — la pose d'ouverture vit à
// l'étape 3, le mode 'polygone' n'est pas exposé en v1), PlanCanvas au centre (enveloppé dans
// CanvasErrorBoundary), panneau droit = PieceInspector (pièce sélectionnée) ou liste des
// erreurs/avertissements de valideDessin (recalculée avec debounce 300 ms).
// Le dessin reste la SOURCE UNIQUE : toute mutation remonte en dessin complet via onDessinChange
// (→ SET_DESSIN). Les ops dessinOps qui refusent (erreurs non vides) → toast.error, état inchangé.
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Copy, Layers, MousePointer2, Plus, Square, Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { PlanCanvas } from '../canvas/PlanCanvas';
import CanvasErrorBoundary from './CanvasErrorBoundary';
import PieceInspector from './PieceInspector';
import { typePieceInfo } from '../../lib/thermiqueConfig';
import { validePolygone } from '../../lib/geometryEngine';
import {
  ajouteNiveau, dupliqueNiveau, supprimeNiveau, regleHauteurNiveau, valideDessin,
} from '../../lib/dessinOps';

const HAUTEUR_NIVEAU_DEFAUT = 250; // cm — même défaut que le RDC initial (wizardState.js)

export default function Step2Dessin({ dessin, config, onDessinChange }) {
  const [mode, setMode] = useState('rectangle');
  const [niveauActifId, setNiveauActifId] = useState(dessin.niveaux[0]?.id ?? null);
  const [selection, setSelection] = useState(null);
  const [confirmNiveau, setConfirmNiveau] = useState(false);
  // Flags « édité à la main » par pièce (theta/chauffee) — pilotent le re-défaut au changement
  // de type dans PieceInspector. Ref (pas state) : ne déclenche aucun render, volatil par design
  // (perdu au démontage de l'étape — un champ re-défauté se ré-édite en un geste).
  const touchedRef = useRef({});

  const niveauActif = dessin.niveaux.find((n) => n.id === niveauActifId) ?? null;

  // Niveau actif toujours valide (suppression, restauration de brouillon, LOAD_STUDY…).
  useEffect(() => {
    if (!dessin.niveaux.some((n) => n.id === niveauActifId)) {
      setNiveauActifId(dessin.niveaux[0]?.id ?? null);
      setSelection(null);
    }
  }, [dessin.niveaux, niveauActifId]);

  // Draft hauteur (commit au blur/Enter — regleHauteurNiveau refuse les saisies intermédiaires).
  const [hauteurDraft, setHauteurDraft] = useState(niveauActif ? String(niveauActif.hauteur) : '');
  const hauteurActive = niveauActif?.hauteur;
  useEffect(() => {
    setHauteurDraft(hauteurActive == null ? '' : String(hauteurActive));
  }, [niveauActifId, hauteurActive]);

  // Validation live du dessin, debounce 300 ms (valideDessin re-déduit toutes les parois —
  // inutile de la relancer à chaque frame d'un drag).
  const [check, setCheck] = useState(() => valideDessin(dessin));
  useEffect(() => {
    const t = setTimeout(() => setCheck(valideDessin(dessin)), 300);
    return () => clearTimeout(t);
  }, [dessin]);

  // Pièces en erreur pour la teinte rouge du canevas — approximation honnête (polygone invalide
  // ∪ chauffée sans θint fini) ; les messages détaillés restent dans le panneau de droite.
  const piecesEnErreur = useMemo(() => {
    const ids = new Set();
    for (const p of dessin.pieces) {
      if (validePolygone(p.polygone).length > 0 || (p.chauffee && !Number.isFinite(p.thetaInt))) {
        ids.add(p.id);
      }
    }
    return ids;
  }, [dessin.pieces]);

  /** Committe le résultat d'une op dessinOps, ou toast.error si refusée. Retourne true si commit. */
  const applique = (resultat) => {
    if (resultat.erreurs.length > 0) {
      toast.error(resultat.erreurs[0]);
      return false;
    }
    onDessinChange(resultat.dessin);
    return true;
  };

  // --- Création de pièce routée (R1) : PlanCanvas ajoute la pièce brute en mode 'rectangle'
  // (id crypto.randomUUID, nom 'Pièce', thetaInt null) — on détecte l'id nouveau, on applique
  // les défauts AVANT de committer, puis on la sélectionne (ouvre l'inspecteur).
  const handleCanvasChange = (next) => {
    const idsAvant = new Set(dessin.pieces.map((p) => p.id));
    const ajoutee = next.pieces.find((p) => !idsAvant.has(p.id));
    if (!ajoutee) {
      onDessinChange(next);
      return;
    }
    const pieceRoutee = {
      ...ajoutee,
      nom: `Pièce ${next.pieces.length}`,
      typePiece: 'autre',
      chauffee: typePieceInfo('autre').chauffeeParDefaut,
      thetaInt: config.theta_int_defauts.autre,
    };
    onDessinChange({
      ...next,
      pieces: next.pieces.map((p) => (p.id === ajoutee.id ? pieceRoutee : p)),
    });
    setSelection({ type: 'piece', id: ajoutee.id });
  };

  // --- Niveaux ---
  const handleAjouteNiveau = () => {
    const id = crypto.randomUUID();
    if (applique(ajouteNiveau(dessin, {
      id, nom: `Niveau ${dessin.niveaux.length + 1}`, hauteur: HAUTEUR_NIVEAU_DEFAUT,
    }))) {
      setNiveauActifId(id);
      setSelection(null);
    }
  };

  const handleDuplique = () => {
    if (!niveauActif) return;
    const nouvelId = crypto.randomUUID();
    if (applique(dupliqueNiveau(dessin, niveauActifId, { nouvelId }))) {
      setNiveauActifId(nouvelId);
      setSelection(null);
    }
  };

  const piecesNiveauActif = dessin.pieces.filter((p) => p.niveauId === niveauActifId);

  const handleSupprimeNiveau = () => {
    setConfirmNiveau(false);
    applique(supprimeNiveau(dessin, niveauActifId));
    // Le repointage du niveau actif est géré par l'effect de cohérence ci-dessus.
  };

  const commitHauteur = () => {
    if (!niveauActif) return;
    const valeur = Number(hauteurDraft);
    if (valeur === niveauActif.hauteur) return;
    if (!applique(regleHauteurNiveau(dessin, niveauActifId, valeur))) {
      setHauteurDraft(String(niveauActif.hauteur));
    }
  };

  const pieceSelectionnee = selection?.type === 'piece'
    ? dessin.pieces.find((p) => p.id === selection.id) ?? null
    : null;

  return (
    <div className="space-y-3">
      {/* Barre de niveaux */}
      <div className="card py-3 flex items-center gap-2 flex-wrap">
        <Layers className="w-4 h-4 text-secondary-400 flex-shrink-0" />
        <div className="flex items-center gap-1 flex-wrap">
          {dessin.niveaux.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => { setNiveauActifId(n.id); setSelection(null); }}
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
        <button
          type="button"
          onClick={handleAjouteNiveau}
          className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium text-secondary-600 hover:bg-secondary-100 rounded-lg"
        >
          <Plus className="w-4 h-4" /> Niveau
        </button>
        <button
          type="button"
          onClick={handleDuplique}
          disabled={!niveauActif}
          className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium text-secondary-600 hover:bg-secondary-100 rounded-lg disabled:opacity-50"
          title="Dupliquer le niveau actif (pièces et ouvertures copiées)"
        >
          <Copy className="w-4 h-4" /> Dupliquer
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-sm text-secondary-600 flex items-center gap-1.5">
            Hauteur
            <input
              type="number"
              inputMode="numeric"
              min={180}
              max={500}
              value={hauteurDraft}
              onChange={(e) => setHauteurDraft(e.target.value)}
              onBlur={commitHauteur}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              disabled={!niveauActif}
              className="w-20 px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
            />
            cm
          </label>
          <button
            type="button"
            onClick={() => (piecesNiveauActif.length > 0 ? setConfirmNiveau(true) : handleSupprimeNiveau())}
            disabled={dessin.niveaux.length <= 1 || !niveauActif}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            title="Supprimer le niveau actif"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 items-stretch">
        {/* Canevas + barre d'outils */}
        <div className="flex-1 min-w-0 card p-0 overflow-hidden flex flex-col">
          <div className="flex items-center gap-1 p-2 border-b border-secondary-100">
            <button
              type="button"
              onClick={() => setMode('selection')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                mode === 'selection' ? 'bg-primary-50 text-primary-700' : 'text-secondary-600 hover:bg-secondary-100'
              }`}
            >
              <MousePointer2 className="w-4 h-4" /> Sélection
            </button>
            <button
              type="button"
              onClick={() => setMode('rectangle')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                mode === 'rectangle' ? 'bg-primary-50 text-primary-700' : 'text-secondary-600 hover:bg-secondary-100'
              }`}
            >
              <Square className="w-4 h-4" /> Rectangle
            </button>
            <p className="ml-auto text-xs text-secondary-400 pr-1 hidden sm:block">
              {mode === 'rectangle' ? 'Glissez pour tracer une pièce' : 'Touchez pour éditer · glissez une pièce pour la déplacer'}
            </p>
          </div>
          <div className="flex items-center gap-4 px-3 py-1.5 border-b border-secondary-100 text-xs text-secondary-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-1.5 rounded-full bg-amber-500" /> Mur extérieur
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-1 rounded-full bg-slate-400" /> Mur mitoyen
            </span>
          </div>
          <div className="h-[460px]">
            <CanvasErrorBoundary>
              <PlanCanvas
                dessin={dessin}
                niveauActifId={niveauActifId}
                selection={selection}
                mode={mode}
                onChange={handleCanvasChange}
                onSelect={setSelection}
                piecesEnErreur={piecesEnErreur}
              />
            </CanvasErrorBoundary>
          </div>
        </div>

        {/* Panneau droit : inspecteur ou validation */}
        <div className="w-full lg:w-80 flex-shrink-0">
          {pieceSelectionnee ? (
            <PieceInspector
              piece={pieceSelectionnee}
              dessin={dessin}
              config={config}
              onDessinChange={onDessinChange}
              applique={applique}
              estTouche={(pieceId, champ) => !!touchedRef.current[pieceId]?.[champ]}
              marqueTouche={(pieceId, champ) => {
                touchedRef.current[pieceId] = { ...touchedRef.current[pieceId], [champ]: true };
              }}
              onSupprimee={(pieceId) => {
                delete touchedRef.current[pieceId];
                setSelection(null);
              }}
            />
          ) : (
            <div className="card space-y-3">
              <h3 className="font-semibold text-secondary-900 text-sm">Validation du plan</h3>
              {check.erreurs.length === 0 && check.avertissements.length === 0 ? (
                <p className="flex items-start gap-2 text-sm text-secondary-600">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  {dessin.pieces.length === 0
                    ? 'Tracez une première pièce avec l’outil Rectangle.'
                    : 'Aucun problème détecté.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {check.erreurs.map((e, i) => (
                    <li key={`err-${i}`} className="flex items-start gap-2 text-sm text-red-700">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{e}</span>
                    </li>
                  ))}
                  {check.avertissements.map((a, i) => (
                    <li key={`warn-${i}`} className="flex items-start gap-2 text-sm text-amber-700">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-secondary-400">
                Sélectionnez une pièce sur le plan pour la renommer, changer son type ou sa consigne.
              </p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmNiveau}
        onOpenChange={setConfirmNiveau}
        title={`Supprimer « ${niveauActif?.nom ?? ''} »`}
        description={`Ce niveau contient ${piecesNiveauActif.length} pièce${piecesNiveauActif.length > 1 ? 's' : ''} — elles seront supprimées avec leurs ouvertures.`}
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleSupprimeNiveau}
      />
    </div>
  );
}
