/** Ce que le client confirme : cases décochées au départ, facultatives. */
export default function PvPointsClient({ points, confirmes, onChange, disabled }) {
  if (!points?.length) return null;
  const basculer = (cle, coche) => {
    const sans = confirmes.filter((k) => k !== cle);
    onChange(coche ? [...sans, cle] : sans);
  };
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-semibold mb-1">Ce que vous confirmez</legend>
      <p className="text-sm text-secondary-600">Cochez ce qui est exact. Vous pouvez laisser une case vide.</p>
      {points.map((p) => (
        <label key={p.cle} className="flex items-start gap-3 min-h-[48px] py-1 cursor-pointer">
          <input
            type="checkbox" className="mt-1 h-5 w-5 rounded shrink-0"
            checked={confirmes.includes(p.cle)}
            onChange={(e) => basculer(p.cle, e.target.checked)}
          />
          <span className="text-sm text-secondary-800">{p.texte}</span>
        </label>
      ))}
    </fieldset>
  );
}
