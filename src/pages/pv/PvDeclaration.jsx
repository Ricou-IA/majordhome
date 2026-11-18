/** Ce que déclare l'installateur, en lecture : la réponse est écrite en toutes lettres. */
export default function PvDeclaration({ declaration }) {
  if (!declaration?.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Ce que déclare votre installateur</h2>
      <ul className="rounded-lg border border-secondary-200 bg-white divide-y divide-secondary-200">
        {declaration.map((p, i) => (
          <li key={`${i}-${p.texte}`} className="p-3 text-sm flex items-start justify-between gap-3">
            <span className="text-secondary-800">{p.texte}</span>
            <span className="shrink-0 font-semibold text-secondary-900">{p.reponse}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
