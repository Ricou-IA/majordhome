/**
 * PvSignature — le nom du signataire et sa signature tracée au doigt ou à la souris.
 * La signature est prise à chaque trait : pas d'étape « valider la signature » avant le
 * bouton de la page. `onSignature(image | null)` reçoit un PNG (data URL) ou `null` après
 * « Effacer ». Le cadre n'est jamais remonté pendant la saisie : il garde ses traits.
 */
import { useEffect, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Eraser } from 'lucide-react';

const CHAMP = 'w-full rounded-xl border border-secondary-300 bg-white px-4 py-3 text-base text-secondary-900 placeholder:text-secondary-400 focus:border-secondary-900 focus:outline-none focus:ring-1 focus:ring-secondary-900 disabled:opacity-60';

export default function PvSignature({ nom, onNom, onSignature, disabled = false }) {
  const cadre = useRef(null);
  const [vide, setVide] = useState(true);
  const rappel = useRef(onSignature);
  useEffect(() => { rappel.current = onSignature; });

  // Le cadre ne se vide pas quand la fenêtre change de hauteur (barre d'adresse d'un téléphone
  // qui se replie au défilement). S'il change de LARGEUR (téléphone tourné), les traits ne
  // tomberaient plus sous le doigt : on le remet à la bonne taille et la signature est à refaire.
  useEffect(() => {
    const pad = cadre.current;
    const canvas = pad?.getCanvas();
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    let largeur = canvas.offsetWidth;
    const observateur = new ResizeObserver(() => {
      if (canvas.offsetWidth === 0 || canvas.offsetWidth === largeur) return;
      largeur = canvas.offsetWidth;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext('2d').scale(ratio, ratio);
      pad.clear();
      setVide(true);
      rappel.current(null);
    });
    observateur.observe(canvas);
    return () => observateur.disconnect();
  }, []);

  const prendre = () => {
    const pad = cadre.current;
    if (!pad || pad.isEmpty()) return;
    setVide(false);
    onSignature(pad.getTrimmedCanvas().toDataURL('image/png'));
  };

  const effacer = () => {
    cadre.current?.clear();
    setVide(true);
    onSignature(null);
  };

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-secondary-700">Votre nom et prénom</span>
        <input
          type="text" autoComplete="name" value={nom || ''} disabled={disabled}
          onChange={(e) => onNom(e.target.value)} className={CHAMP}
        />
      </label>

      <div>
        <p className="mb-1.5 text-sm font-medium text-secondary-700">Votre signature</p>
        <div
          className={`relative overflow-hidden rounded-2xl border-2 bg-white transition-colors ${
            vide ? 'border-dashed border-secondary-300' : 'border-solid border-[color:var(--pv-accent)]'
          } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
        >
          <SignatureCanvas
            ref={cadre}
            onEnd={prendre}
            penColor="#0f172a"
            clearOnResize={false}
            canvasProps={{ className: 'block h-48 w-full touch-none sm:h-56', 'aria-label': 'Cadre de signature' }}
          />
          <span className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-secondary-200" aria-hidden="true" />
          {vide && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-base text-secondary-400">
              Signez dans ce cadre
            </p>
          )}
        </div>
        <div className="mt-1 flex min-h-[44px] items-center justify-between gap-3">
          <p className="text-sm text-secondary-600">
            {vide ? 'Au doigt sur un téléphone, à la souris sur un ordinateur.' : 'Votre signature est prise en compte.'}
          </p>
          <button
            type="button" onClick={effacer} disabled={vide || disabled}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-secondary-800 hover:bg-secondary-100 disabled:invisible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-900"
          >
            <Eraser className="h-4 w-4" aria-hidden="true" />
            Effacer
          </button>
        </div>
      </div>
    </div>
  );
}
