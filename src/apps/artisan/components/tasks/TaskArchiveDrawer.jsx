import { useState } from 'react';
import { X, Archive, Search, Loader2 } from 'lucide-react';

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

const COLOR_MAP = {
  yellow: 'bg-yellow-50 border-yellow-200',
  pink: 'bg-pink-50 border-pink-200',
  blue: 'bg-sky-50 border-sky-200',
  green: 'bg-emerald-50 border-emerald-200',
  purple: 'bg-violet-50 border-violet-200',
  orange: 'bg-orange-50 border-orange-200',
};

export default function TaskArchiveDrawer({ tasks, isLoading, onClose }) {
  const [search, setSearch] = useState('');

  const filtered = search
    ? tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          (t.assigned_to_name || '').toLowerCase().includes(search.toLowerCase()) ||
          (t.created_by_name || '').toLowerCase().includes(search.toLowerCase())
      )
    : tasks;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md shadow-xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Archives</h2>
            <span className="text-xs text-gray-400">({tasks.length})</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une tâche archivée..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-12">
              {search ? 'Aucun résultat' : 'Aucune tâche archivée'}
            </p>
          ) : (
            filtered.map((task) => (
              <div
                key={task.id}
                className={`${COLOR_MAP[task.color] || COLOR_MAP.yellow} border rounded-lg p-3`}
              >
                <h4 className="font-medium text-sm text-gray-800">{task.title}</h4>
                {task.description && (
                  <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{task.description}</p>
                )}
                <div className="flex items-center justify-between mt-2 text-[10px] text-gray-400">
                  <div className="flex items-center gap-1">
                    {task.assigned_to_name && (
                      <>
                        <span className="w-4 h-4 rounded-full bg-gray-600 text-white text-[8px] flex items-center justify-center">
                          {getInitials(task.assigned_to_name)}
                        </span>
                        <span>{task.assigned_to_name}</span>
                      </>
                    )}
                  </div>
                  <span>
                    Archivé le{' '}
                    {task.archived_at
                      ? new Date(task.archived_at).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'short',
                        })
                      : '—'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
