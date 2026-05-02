import React, { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Circle, Plus, Trash2, Calendar, Clock, ListTodo, CheckCheck, AlertCircle, Search, SortAsc, AlertTriangle, CheckSquare, X, Flag, Edit2 } from 'lucide-react';
import { taskDB, Task, createUseDB } from '../../db';
import Loading from '../../components/Loading';
import { VirtualList } from '../../components/VirtualList';
import { Button, EmptyState } from '../../components/ui';
import { TaskItem, PriorityButtonGroup } from './components';

type FilterType = 'all' | 'pending' | 'completed';
type SortType = 'created' | 'priority' | 'dueDate' | 'title';
export type PriorityType = 'low' | 'medium' | 'high';

const MAX_TITLE_LENGTH = 100;
const useDB = createUseDB(React);

const Tasks: React.FC = () => {
  const { data: tasksData, loading } = useDB(() => taskDB.getAll(), ['tasks']);
  const tasks = tasksData ?? [];

  const [newTask, setNewTask] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<PriorityType>('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState<PriorityType>('medium');
  const [editDueDate, setEditDueDate] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortType, setSortType] = useState<SortType>('created');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchActions, setShowBatchActions] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const pending = tasks.filter(t => !t.completed).length;
    const overdue = tasks.filter(t => {
      if (!t.dueDate || t.completed) return false;
      const due = new Date(t.dueDate);
      const today = new Date();
      return due < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    }).length;
    const highPriority = tasks.filter(t => t.priority === 'high' && !t.completed).length;
    return { total, completed, pending, overdue, highPriority };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(query));
    }
    if (filter === 'pending') result = result.filter(t => !t.completed);
    if (filter === 'completed') result = result.filter(t => t.completed);
    return result;
  }, [tasks, filter, searchQuery]);

  const sortedTasks = useMemo(() => {
    const sorted = [...filteredTasks];
    switch (sortType) {
      case 'priority':
        const order = { high: 0, medium: 1, low: 2 };
        return sorted.sort((a, b) => order[a.priority] - order[b.priority]);
      case 'dueDate':
        return sorted.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        });
      case 'title':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      default:
        return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }, [filteredTasks, sortType]);

  const addTask = useCallback(async () => {
    const trimmedTitle = newTask.trim().slice(0, MAX_TITLE_LENGTH);
    if (!trimmedTitle) return;
    await taskDB.add({
      title: trimmedTitle,
      completed: false,
      createdAt: new Date().toISOString(),
      priority: newTaskPriority,
      dueDate: newTaskDueDate || undefined,
    });
    setNewTask('');
    setNewTaskPriority('medium');
    setNewTaskDueDate('');
  }, [newTask, newTaskPriority, newTaskDueDate]);

  const toggleTask = useCallback(async (id: string) => {
    await taskDB.toggle(id);
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    await taskDB.delete(id);
    setShowDeleteConfirm(null);
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const handleBatchDelete = useCallback(async () => {
    await Promise.all([...selectedIds].map(id => taskDB.delete(id)));
    setSelectedIds(new Set());
    setShowBatchActions(false);
    setShowDeleteConfirm(null);
  }, [selectedIds]);

  const handleBatchToggle = useCallback(async (complete: boolean) => {
    await Promise.all([...selectedIds].map(id => {
      const task = tasks.find(t => t.id === id);
      if (task && task.completed !== complete) return taskDB.toggle(id);
      return Promise.resolve();
    }));
    setSelectedIds(new Set());
    setShowBatchActions(false);
  }, [selectedIds, tasks]);

  const startEdit = useCallback((task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate || '');
  }, []);

  const saveEdit = useCallback(async () => {
    const trimmedTitle = editTitle.trim().slice(0, MAX_TITLE_LENGTH);
    if (!trimmedTitle || !editingId) return;
    await taskDB.update(editingId, {
      title: trimmedTitle,
      priority: editPriority,
      dueDate: editDueDate || undefined,
    });
    setEditingId(null);
  }, [editTitle, editPriority, editDueDate, editingId]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === sortedTasks.length && sortedTasks.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedTasks.map(t => t.id)));
    }
  }, [selectedIds.size, sortedTasks]);

  const isAllSelected = selectedIds.size === sortedTasks.length && sortedTasks.length > 0;

  if (loading) return <Loading />;

  const filterButtons: { key: FilterType; label: string; icon: React.ElementType }[] = [
    { key: 'all', label: '全部', icon: ListTodo },
    { key: 'pending', label: '待办', icon: AlertCircle },
    { key: 'completed', label: '已完成', icon: CheckCheck },
  ];

  const sortOptions: { key: SortType; label: string }[] = [
    { key: 'created', label: '创建时间' },
    { key: 'priority', label: '优先级' },
    { key: 'dueDate', label: '截止日期' },
    { key: 'title', label: '标题' },
  ];

  const getFilterCount = (f: FilterType) => {
    if (f === 'all') return stats.total;
    if (f === 'pending') return stats.pending;
    return stats.completed;
  };

  const renderTaskItem = (task: Task, index?: number) => (
    <TaskItem
      task={task}
      editingId={editingId}
      editTitle={editTitle}
      editPriority={editPriority}
      editDueDate={editDueDate}
      selectedIds={selectedIds}
      showBatchActions={showBatchActions}
      onToggle={toggleTask}
      onDelete={(id) => setShowDeleteConfirm(id)}
      onStartEdit={startEdit}
      onSaveEdit={saveEdit}
      onCancelEdit={() => setEditingId(null)}
      onTitleChange={setEditTitle}
      onPriorityChange={setEditPriority}
      onDueDateChange={setEditDueDate}
      onToggleSelect={toggleSelect}
      index={index}
    />
  );

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 md:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <ListTodo className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-text-primary">任务管理</h1>
        </div>
        <p className="text-sm text-text-muted ml-12">高效管理你的日常任务</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="rounded-lg p-4 bg-bg-card border border-border-primary">
          <div className="flex items-center gap-2 mb-2">
            <Flag className="w-4 h-4 text-text-muted" />
            <span className="text-sm text-text-secondary">总任务</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">{stats.total}</p>
        </div>
        <div className="rounded-lg p-4 bg-bg-card border border-border-primary">
          <div className="flex items-center gap-2 mb-2">
            <CheckCheck className="w-4 h-4 text-success" />
            <span className="text-sm text-text-secondary">已完成</span>
          </div>
          <p className="text-2xl font-bold text-success">{stats.completed}</p>
        </div>
        <div className="rounded-lg p-4 bg-bg-card border border-border-primary">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-warning" />
            <span className="text-sm text-text-secondary">待办</span>
          </div>
          <p className="text-2xl font-bold text-warning">{stats.pending}</p>
        </div>
        <div className="rounded-lg p-4 bg-bg-card border border-border-primary">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-error" />
            <span className="text-sm text-text-secondary">逾期</span>
          </div>
          <p className="text-2xl font-bold text-error">{stats.overdue}</p>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg shadow-card border p-4 md:p-5 mb-6 bg-bg-card border-border-primary">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value.slice(0, MAX_TITLE_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addTask();
              }
            }}
            placeholder="输入任务内容，按 Enter 添加..."
            className="flex-1 px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-bg-secondary border-border-primary text-text-primary placeholder-text-muted"
          />
          <div className="flex items-center gap-2">
            <PriorityButtonGroup selected={newTaskPriority} onChange={setNewTaskPriority} />
            <input
              type="date"
              value={newTaskDueDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => setNewTaskDueDate(e.target.value)}
              className="px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-bg-card border-border-primary text-text-secondary"
              title="截止日期"
            />
            <Button variant="primary" onClick={addTask} icon={<Plus size={18} />}>添加</Button>
          </div>
        </div>
        {newTask.length > 0 && (
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted">{stats.pending} 个待办任务</span>
            <span className="text-xs text-text-muted">{newTask.length}/{MAX_TITLE_LENGTH}</span>
          </div>
        )}
      </motion.div>

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30">
              <span className="text-sm text-primary font-medium">已选 {selectedIds.size} 项</span>
              <Button variant="success" size="sm" onClick={() => handleBatchToggle(true)} icon={<CheckCircle size={14} />}>完成</Button>
              <Button variant="ghost" size="sm" onClick={() => handleBatchToggle(false)} icon={<Circle size={14} />}>取消完成</Button>
              <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm('batch')} icon={<Trash2 size={14} />}>删除</Button>
              <button onClick={() => setSelectedIds(new Set())} className="text-sm text-text-muted hover:text-text-secondary">取消</button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索任务..."
                  className="pl-9 pr-8 py-2 w-52 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-bg-card border-border-primary text-text-primary placeholder-text-muted"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {sortedTasks.length > 0 && (
                <Button
                  variant={showBatchActions ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setShowBatchActions(!showBatchActions)}
                  icon={<CheckSquare size={14} />}
                >
                  批量
                </Button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 bg-bg-tertiary text-text-secondary hover:bg-neutral-200 dark:hover:bg-neutral-700"
            >
              <SortAsc size={14} />
              排序
            </button>
            <AnimatePresence>
              {showSortMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full mt-1 bg-bg-card border border-border-primary rounded-lg shadow-lg py-1 z-10 min-w-[120px]"
                >
                  {sortOptions.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => { setSortType(opt.key); setShowSortMenu(false); }}
                      className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                        sortType === opt.key
                          ? 'text-primary bg-primary/10'
                          : 'text-text-secondary hover:bg-bg-tertiary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {filterButtons.map(btn => (
            <button
              key={btn.key}
              onClick={() => setFilter(btn.key)}
              className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                filter === btn.key
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-bg-card text-text-secondary border border-border-primary hover:bg-bg-secondary'
              }`}
            >
              <btn.icon size={14} />
              {btn.label}
              <span className={`text-xs ml-0.5 ${filter === btn.key ? 'text-white/70' : 'text-text-muted'}`}>
                {getFilterCount(btn.key)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {sortedTasks.length === 0 ? (
          tasks.length === 0 ? (
            <EmptyState icon={ListTodo} title="还没有任务" description="在上方输入框添加第一个任务" />
          ) : (
            <EmptyState
              icon={filter === 'completed' ? CheckCheck : AlertCircle}
              title={filter === 'completed' ? '还没有已完成的任务' : searchQuery ? '未找到匹配的任务' : '没有待办任务'}
              description={filter === 'completed' ? '完成任务后会显示在这里' : searchQuery ? '尝试其他关键词' : '所有任务都已完成'}
            />
          )
        ) : sortedTasks.length > 20 ? (
          <>
            {showBatchActions && (
              <div className="p-3 flex items-center gap-3 bg-bg-secondary rounded-lg border border-border-primary mb-2">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-border-primary accent-primary"
                />
                <span className="text-sm text-text-muted">全选 ({sortedTasks.length} 条任务)</span>
              </div>
            )}
            <VirtualList<Task> items={sortedTasks} itemHeight={72} containerHeight={480} renderItem={renderTaskItem} />
          </>
        ) : (
          <>
            {showBatchActions && (
              <div className="p-3 flex items-center gap-3 bg-bg-secondary rounded-lg border border-border-primary">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-border-primary accent-primary"
                />
                <span className="text-sm text-text-muted">全选</span>
              </div>
            )}
            <AnimatePresence mode="popLayout">
              {sortedTasks.map((task, index) => renderTaskItem(task, index))}
            </AnimatePresence>
          </>
        )}
      </div>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-lg p-6 w-full max-w-sm bg-bg-card shadow-lg border border-border-primary"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-error" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary">确认删除</h3>
              </div>
              <p className="text-text-secondary mb-5 text-sm">
                {showDeleteConfirm === 'batch'
                  ? `确定要删除选中的 ${selectedIds.size} 个任务吗？此操作无法撤销。`
                  : '确定要删除这个任务吗？此操作无法撤销。'}
              </p>
              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setShowDeleteConfirm(null)} className="flex-1">取消</Button>
                <Button variant="danger" onClick={showDeleteConfirm === 'batch' ? handleBatchDelete : () => deleteTask(showDeleteConfirm)} className="flex-1">删除</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Tasks;