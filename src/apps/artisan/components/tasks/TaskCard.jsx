import { Check, Archive } from 'lucide-react';

const COLOR_MAP = {
  yellow: 'bg-yellow-100 border-yellow-300',
  pink: 'bg-pink-100 border-pink-300',
  blue: 'bg-sky-100 border-sky-300',
  green: 'bg-emerald-100 border-emerald-300',
  purple: 'bg-violet-100 border-violet-300',
  orange: 'bg-orange-100 border-orange-300',
};

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function relativeDate(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "À l'instant";
  if (diffMin < 60) return `il y a ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `il y a ${diffD}j`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function TaskCard({
  task,
  index = 0,
  userId,
  isOrgAdmin = false,
  onClick,
  onMarkDone,
  onArchive,
  compact = false,
}) {
  const colorClass = COLOR_MAP[task.color] || COLOR_MAP.yellow;
  const rotation = index % 3 === 0 ? 'rotate-[0.5deg]' : index % 3 === 1 ? '-rotate-[0.5deg]' : '';
  const isCreator = task.created_by === userId;
  const canMarkDone = task.status === 'active' && onMarkDone;
  const canArchive = task.status === 'done' && onArchive && (isCreator || isOrgAdmin);

  return (
    <div
      onClick={() => onClick?.(task)}
      className={`
        ${colorClass} ${compact ? '' : rotation}
        border rounded-lg p-3 shadow-md hover:shadow-lg transition-shadow cursor-pointer
        relative
      `}
    >
      <h4 className="font-semibold text-sm text-gray-800 line-clamp-2 pr-7">{task.title}</h4>
      {task.description && (
        <p className="text-xs text-gray-600 line-clamp-2 mt-1">{task.description}</p>
      )}

      {/* Tags: creator → assignee */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {/* Creator initials */}
        {task.created_by_name && (
          <span
            className="w-5 h-5 rounded-full bg-gray-600 text-white text-[9px] font-medium flex items-center justify-center shrink-0"
            title={`Créé par ${task.created_by_name}`}
          >
            {getInitials(task.created_by_name)}
          </span>
        )}

        {/* Arrow + Assignee initials */}
        {task.assigned_to_name && (
          <>
            <span className="text-[10px] text-gray-400">→</span>
            <span
              className="w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-medium flex items-center justify-center shrink-0"
              title={`Assigné à ${task.assigned_to_name}`}
            >
              {getInitials(task.assigned_to_name)}
            </span>
          </>
        )}

        <span className="text-[10px] text-gray-400 ml-auto shrink-0">
          {relativeDate(task.created_at)}
        </span>
      </div>

      {/* Permanent action checkboxes */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
        {canMarkDone && (
          <button
            onClick={(e) => { e.stopPropagation(); onMarkDone(task.id); }}
            title="Marquer comme réalisé"
            className="w-6 h-6 rounded-full border-2 border-emerald-400 bg-white text-emerald-500
              flex items-center justify-center hover:bg-emerald-500 hover:text-white
              hover:border-emerald-500 transition-colors shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        )}

        {canArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(task.id); }}
            title="Valider et archiver"
            className="w-6 h-6 rounded-full border-2 border-blue-400 bg-white text-blue-500
              flex items-center justify-center hover:bg-blue-500 hover:text-white
              hover:border-blue-500 transition-colors shadow-sm"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
