/** Ce que le client confirme : cases décochées au départ, facultatives. */
import { PageEtape } from '../public/pageUi';

export default function PvPointsClient({ numero, points, confirmes, onChange, disabled }) {
  if (!points?.length) return null;
  const basculer = (cle, coche) => {
    const sans = confirmes.filter((k) => k !== cle);
    onChange(coche ? [...sans, cle] : sans);
  };
  return (
    <PageEtape numero={numero} titre="Ce que vous confirmez" aide="Cochez ce qui est exact. Vous pouvez laisser une case vide.">
      <fieldset disabled={disabled} className="disabled:opacity-60">
        <legend className="sr-only">Ce que vous confirmez</legend>
        <div className="divide-y divide-secondary-100 overflow-hidden rounded-2xl border border-secondary-200 bg-white shadow-sm">
        {points.map((p) => {
          const coche = confirmes.includes(p.cle);
          return (
            <label
              key={p.cle}
              className={`flex min-h-[56px] cursor-pointer items-start gap-4 p-4 transition-colors ${coche ? 'bg-[color:var(--marque-doux)]' : 'hover:bg-secondary-50'}`}
            >
              <input
                type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer"
                style={{ accentColor: 'var(--marque)' }}
                checked={coche}
                onChange={(e) => basculer(p.cle, e.target.checked)}
              />
              <span className="text-base text-secondary-800">{p.texte}</span>
            </label>
          );
        })}
        </div>
      </fieldset>
    </PageEtape>
  );
}
