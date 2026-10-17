import { useEffect, useRef, useState } from 'react';
import { Check, MapPin, ShieldAlert, ShoppingCart, Package, CornerDownRight, CalendarDays } from 'lucide-react';
import {
  formatDuree, formatDateCourte, isSecurite, isReleve, isHorsPerimetre, mapsUrl,
} from '../lib/chantierGaillacModel';

/** Grille partagée par l'en-tête de tableau et les lignes, à partir de `xl` (une tablette reste en cartes : viewport forcé à 1024 px). */
export const ROW_GRID =
  'xl:grid xl:grid-cols-[84px_52px_minmax(140px,1.1fr)_minmax(200px,2fr)_104px_72px_64px_84px_92px_minmax(130px,1.1fr)_minmax(170px,1.3fr)] xl:items-start xl:gap-x-3';

const chip = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold';

function formatValidation(t, nameOf) {
  if (!t.fait_le) return '';
  const d = new Date(t.fait_le);
  const quand = `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const qui = nameOf(t.fait_par);
  return `Fait le ${quand}${qui ? ` par ${qui}` : ''}`;
}

function CommentField({ tache, onSave }) {
  const [value, setValue] = useState(tache.commentaire_terrain || '');
  const focused = useRef(false);
  // Un rafraîchissement serveur ne doit pas écraser une saisie en cours
  useEffect(() => {
    if (!focused.current) setValue(tache.commentaire_terrain || '');
  }, [tache.commentaire_terrain]);

  return (
    <textarea
      value={value}
      rows={2}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if ((value || '').trim() !== (tache.commentaire_terrain || '')) onSave(value);
      }}
      placeholder="Commentaire terrain…"
      aria-label={`Commentaire terrain, tâche ${tache.numero}`}
      className="w-full resize-y rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-base leading-snug focus:border-[#1565C0] focus:outline-none focus:ring-2 focus:ring-[#2196F3]/30 xl:text-sm"
    />
  );
}

/**
 * Ligne de tâche : carte sous `xl`, ligne de tableau à partir de `xl`.
 * Seuls la case « Fait » et le commentaire sont éditables (le reste est verrouillé en base).
 */
export default function TaskRow({ tache: t, planning, techName, nameOf, onToggle, onComment }) {
  const hp = isHorsPerimetre(t);
  const releve = isReleve(t);
  const fait = !!t.fait;
  const validation = formatValidation(t, nameOf);

  const planChip = hp ? (
    <span className={`${chip} border-slate-300 text-slate-500`}>— Hors périmètre</span>
  ) : planning?.date_prevue ? (
    <span className={`${chip} border-[#1565C0] bg-[#1565C0] text-white`}>
      <CalendarDays className="h-3 w-3" aria-hidden /> {formatDateCourte(planning.date_prevue)} · {t.planning_code}
    </span>
  ) : (
    <span className={`${chip} border-[#1565C0] font-mono text-[#0D47A1]`}>Code {t.planning_code}</span>
  );

  const achatChip = hp ? null : t.achat_requis ? (
    <span className={`${chip} border-[#F5C542] bg-[#FFF4D1] text-[#6B4E00]`}>
      <ShoppingCart className="h-3 w-3" aria-hidden /> Achat
    </span>
  ) : (
    <span className={`${chip} border-slate-300 text-slate-500`}>
      <Package className="h-3 w-3" aria-hidden /> Stock
    </span>
  );

  return (
    <li
      className={`grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 rounded-xl border p-3 xl:rounded-none xl:border-0 xl:border-b xl:px-3 xl:py-2.5 ${ROW_GRID} ${
        fait ? 'border-[#90CAF9] bg-[#EAF2FD]' : 'border-slate-200 bg-white'
      } ${hp ? 'italic text-slate-500' : 'text-slate-900'}`}
    >
      {/* Case « Fait » */}
      <div className="row-span-3 xl:row-span-1">
        {!hp && (
          <label className="flex min-h-[44px] min-w-[44px] cursor-pointer flex-col items-center justify-center gap-0.5">
            <input
              type="checkbox"
              checked={fait}
              onChange={(e) => onToggle(t, e.target.checked)}
              className="peer sr-only"
              aria-label={`Tâche ${t.numero} ${fait ? 'faite' : 'à faire'}`}
            />
            <span
              aria-hidden
              className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#F5C542] ${
                fait ? 'border-[#1565C0] bg-[#1565C0] text-white' : 'border-slate-400 bg-white text-transparent'
              }`}
            >
              <Check className="h-6 w-6" strokeWidth={3} />
            </span>
            <span className={`text-xs font-semibold ${fait ? 'text-[#0D47A1]' : 'text-slate-500'}`}>
              {fait ? 'Fait' : 'À faire'}
            </span>
          </label>
        )}
      </div>

      {/* N° (+ durée à droite sur carte) */}
      <div className="col-start-2 row-start-1 flex flex-wrap items-center gap-1.5 xl:col-auto xl:row-auto">
        <span className="font-mono text-sm text-slate-500 xl:text-slate-900">{t.numero}</span>
        <span className="flex flex-wrap gap-1 xl:hidden">
          {isSecurite(t) && (
            <span className={`${chip} border-[#F5C542] bg-[#F5C542] text-[#3A2A00]`}>
              <ShieldAlert className="h-3 w-3" aria-hidden /> Sécurité
            </span>
          )}
          {achatChip}
        </span>
      </div>
      <div className="col-start-3 row-start-1 text-right font-mono text-sm tabular-nums xl:hidden">
        {hp ? '–' : formatDuree(t.duree_min)}
      </div>

      {/* Site + adresse (desktop) */}
      <div className="hidden text-sm xl:block">
        <div className="font-medium">{t.site}</div>
        {t.adresse && (
          <a href={mapsUrl(t)} target="_blank" rel="noopener noreferrer" className="text-xs text-[#1565C0] underline-offset-2 hover:underline">
            {t.adresse}
          </a>
        )}
      </div>

      {/* Action */}
      <div className={`col-span-2 col-start-2 text-base font-semibold xl:col-span-1 xl:col-auto xl:text-sm xl:font-normal ${releve ? 'pl-4 xl:pl-5' : ''}`}>
        <span className="hidden flex-wrap gap-1 xl:mb-1 xl:flex">
          {isSecurite(t) && (
            <span className={`${chip} border-[#F5C542] bg-[#F5C542] text-[#3A2A00]`}>
              <ShieldAlert className="h-3 w-3" aria-hidden /> Sécurité
            </span>
          )}
        </span>
        {releve && (
          <span className={`${chip} mb-1 mr-1 border-[#1565C0] text-[#0D47A1]`}>
            <CornerDownRight className="h-3 w-3" aria-hidden /> Relevé
          </span>
        )}
        <span className={fait ? 'line-through decoration-slate-400' : ''}>{t.action}</span>
        {validation && <p className="mt-0.5 text-xs font-normal not-italic text-[#0D47A1]">✓ {validation}</p>}
      </div>

      {/* Site (carte) */}
      <div className="col-span-2 col-start-2 text-sm xl:hidden">
        <span className="font-medium">{t.site}</span>
        {t.adresse && (
          <>
            {' · '}
            <a href={mapsUrl(t)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[#1565C0] underline underline-offset-2">
              <MapPin className="h-3.5 w-3.5" aria-hidden />{t.adresse}
            </a>
          </>
        )}
      </div>

      {/* Thème / technicien / durée / achat / planning (desktop) */}
      <div className="hidden text-xs text-slate-600 xl:block">{t.theme}</div>
      <div className="hidden text-sm xl:block">{techName || '–'}</div>
      <div className="hidden text-right font-mono text-sm tabular-nums xl:block">{hp ? '–' : formatDuree(t.duree_min)}</div>
      <div className="hidden xl:block">{achatChip}</div>
      <div className="hidden xl:block">{planChip}</div>

      {/* Méta (carte) */}
      <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-600 xl:hidden">
        {planChip}
        {t.theme && <span>{t.theme}</span>}
        {techName && <span>· {techName}</span>}
      </div>

      {/* Observations */}
      <div className={`col-span-2 col-start-2 text-sm text-slate-600 xl:col-span-1 xl:col-auto ${t.observations ? '' : 'hidden xl:block'}`}>
        {t.observations}
      </div>

      {/* Commentaire terrain */}
      <div className="col-span-2 col-start-2 xl:col-span-1 xl:col-auto">
        {!hp && <CommentField tache={t} onSave={(texte) => onComment(t, texte)} />}
      </div>
    </li>
  );
}
