import { useMemo, useCallback } from 'react';
import { Plus, CheckCircle2 } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import TaskCard from './TaskCard';

const QUADRANTS = [
  {
    id: 'important_urgent',
    label: 'Important & Urgent',
    sublabel: 'Faire immédiatement',
    important: true,
    urgent: true,
    headerBg: 'bg-red-50',
    headerBorder: 'border-red-200',
    headerText: 'text-red-700',
    dot: 'bg-red-400',
  },
  {
    id: 'important_not_urgent',
    label: 'Important',
    sublabel: 'Planifier',
    important: true,
    urgent: false,
    headerBg: 'bg-amber-50',
    headerBorder: 'border-amber-200',
    headerText: 'text-amber-700',
    dot: 'bg-amber-400',
  },
  {
    id: 'not_important_urgent',
    label: 'Urgent',
    sublabel: 'Déléguer',
    important: false,
    urgent: true,
    headerBg: 'bg-blue-50',
    headerBorder: 'border-blue-200',
    headerText: 'text-blue-700',
    dot: 'bg-blue-400',
  },
  {
    id: 'not_important_not_urgent',
    label: 'Ni urgent ni important',
    sublabel: 'Éliminer / reporter',
    important: false,
    urgent: false,
    headerBg: 'bg-gray-50',
    headerBorder: 'border-gray-200',
    headerText: 'text-gray-600',
    dot: 'bg-gray-400',
  },
];

const QUADRANT_MAP = {};
for (const q of QUADRANTS) {
  QUADRANT_MAP[q.id] = { is_important: q.important, is_urgent: q.urgent };
}

export default function TaskMatrix({
  tasks,
  userId,
  isOrgAdmin = false,
  onCreateInQuadrant,
  onCardClick,
  onMarkDone,
  onArchive,
  onMoveQuadrant,
}) {
  const activeTasks = useMemo(() => tasks.filter((t) => t.status === 'active'), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks]);

  const quadrantTasks = useMemo(() => {
    const map = {};
    for (const q of QUADRANTS) {
      map[q.id] = activeTasks.filter(
        (t) => t.is_important === q.important && t.is_urgent === q.urgent
      );
    }
    return map;
  }, [activeTasks]);

  const canDrag = useCallback(
    (task) => isOrgAdmin || task.created_by === userId,
    [isOrgAdmin, userId]
  );

  const handleDragEnd = useCallback(
    (result) => {
      const { draggableId, source, destination } = result;
      if (!destination || source.droppableId === destination.droppableId) return;

      // Drop into "Réalisé" column
      if (destination.droppableId === 'done') {
        onMarkDone?.(draggableId);
        return;
      }

      // Drop from "Réalisé" back into a quadrant → reactivate + move
      if (source.droppableId === 'done') {
        const target = QUADRANT_MAP[destination.droppableId];
        if (!target) return;
        onMoveQuadrant?.(draggableId, { ...target, status: 'active' });
        return;
      }

      // Move between quadrants
      const target = QUADRANT_MAP[destination.droppableId];
      if (!target) return;
      onMoveQuadrant?.(draggableId, target);
    },
    [onMoveQuadrant, onMarkDone]
  );

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 h-full min-h-0">
        {/* Matrix 2x2 */}
        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-3 min-h-0">
          {QUADRANTS.map((q) => {
            const items = quadrantTasks[q.id] || [];
            return (
              <div
                key={q.id}
                className={`${q.headerBorder} border rounded-xl flex flex-col min-h-0 overflow-hidden`}
              >
                {/* Quadrant header */}
                <div className={`${q.headerBg} px-3 py-2 flex items-center justify-between border-b ${q.headerBorder} shrink-0`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full ${q.dot} shrink-0`} />
                    <div className="min-w-0">
                      <span className={`text-sm font-semibold ${q.headerText}`}>{q.label}</span>
                      <span className="text-[10px] text-gray-400 ml-2">{q.sublabel}</span>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">({items.length})</span>
                  </div>
                  <button
                    onClick={() => onCreateInQuadrant?.(q.important, q.urgent)}
                    className="w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center
                      hover:bg-gray-100 transition-colors shrink-0"
                    title="Ajouter une tâche"
                  >
                    <Plus className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                </div>

                {/* Droppable cards area */}
                <Droppable droppableId={q.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 overflow-y-auto p-2 space-y-2 transition-colors max-h-[280px]
                        ${snapshot.isDraggingOver ? 'bg-white/60' : ''}`}
                    >
                      {items.length === 0 && !snapshot.isDraggingOver ? (
                        <p className="text-xs text-gray-300 text-center py-4">Aucune tâche</p>
                      ) : (
                        items.map((task, i) => {
                          const draggable = canDrag(task);
                          return (
                            <Draggable
                              key={task.id}
                              draggableId={task.id}
                              index={i}
                              isDragDisabled={!draggable}
                            >
                              {(dragProvided, dragSnapshot) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  className={dragSnapshot.isDragging ? 'opacity-90 rotate-2 scale-105' : ''}
                                >
                                  <TaskCard
                                    task={task}
                                    index={i}
                                    userId={userId}
                                    isOrgAdmin={isOrgAdmin}
                                    onClick={onCardClick}
                                    onMarkDone={onMarkDone}
                                  />
                                </div>
                              )}
                            </Draggable>
                          );
                        })
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>

        {/* Done column — droppable for org_admin/creator */}
        <div className="w-64 border border-emerald-200 rounded-xl flex flex-col min-h-0 overflow-hidden shrink-0">
          <div className="bg-emerald-50 px-3 py-2 flex items-center gap-2 border-b border-emerald-200 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-semibold text-emerald-700">Réalisé</span>
            <span className="text-xs text-gray-400">({doneTasks.length})</span>
          </div>
          <Droppable droppableId="done">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`flex-1 overflow-y-auto p-2 space-y-2 transition-colors max-h-[600px]
                  ${snapshot.isDraggingOver ? 'bg-emerald-50/60' : ''}`}
              >
                {doneTasks.length === 0 && !snapshot.isDraggingOver ? (
                  <p className="text-xs text-gray-300 text-center py-4">Aucune tâche terminée</p>
                ) : (
                  doneTasks.map((task, i) => {
                    const draggable = canDrag(task);
                    return (
                      <Draggable
                        key={task.id}
                        draggableId={task.id}
                        index={i}
                        isDragDisabled={!draggable}
                      >
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            className={dragSnapshot.isDragging ? 'opacity-90 rotate-2 scale-105' : ''}
                          >
                            <TaskCard
                              task={task}
                              index={i}
                              userId={userId}
                              isOrgAdmin={isOrgAdmin}
                              onClick={onCardClick}
                              onArchive={onArchive}
                              compact
                            />
                          </div>
                        )}
                      </Draggable>
                    );
                  })
                )}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </div>
      </div>
    </DragDropContext>
  );
}
