import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Circle, Plus, Trash2, Calendar, Edit2, Clock, ListTodo, CheckCheck, AlertCircle, Search, SortAsc, AlertTriangle, CheckSquare, X } from 'lucide-react';
import { taskDB, Task, createUseDB } from '../../db';
import Loading from '../../components/Loading';
import { VirtualList } from '../../components/VirtualList';
import { Button, EmptyState } from '../../components/ui';

type FilterType = 'all' | 'pending' | 'completed';
type SortType = 'created' | 'priority' | 'dueDate' | 'title';

const MAX_TITLE_LENGTH = 100;
const useDB = createUseDB(React);

const Tasks: React.FC = () => {
  const { data: tasksData, loading } = useDB(() => taskDB.getAll(), ['tasks']);
  const tasks = tasksData ?? [];
  const [newTask, setNewTask] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [editDueDate, setEditDueDate] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortType, setSortType] = useState<SortType>('created');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchActions, setShowBatchActions] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => ({
    total: tasks.length,
    completed: tasks.filter(t => t.completed).length,
    pending: tasks.filter(t => !t.completed).length
  }), [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(query));
    }
    switch (filter) {
      case 'pending': result = result.filter(t => !t.completed); break;
      case 'completed': result = result.filter(t => t.completed); break;
    }
    return result;
  }, [tasks, filter, searchQuery]);

  const sortedTasks = useMemo(() => {
    const sorted = [...filteredTasks];
    switch (sortType) {
      case 'priority':
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return sorted.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
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
      dueDate: newTaskDueDate || undefined
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
      dueDate: editDueDate || undefined
    });
    setEditingId(null);
  }, [editTitle, editPriority, editDueDate, editingId]);

  const cancelEdit = useCallback(() => setEditingId(null), []);

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

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-error-light text-error border-error/30 dark:bg-error/20 dark:text-error';
      case 'medium': return 'bg-warning-light text-warning border-warning/30 dark:bg-warning/20 dark:text-warning';
      default: return 'bg-success-light text-success border-success/30 dark:bg-success/20 dark:text-success';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) { case 'high': return '高'; case 'medium': return '中'; default: return '低'; }
  };

  const getPriorityBar = (priority: string) => {
    switch (priority) { case 'high': return 'bg-error'; case 'medium': return 'bg-warning'; default: return 'bg-success'; }
  };

  const getPriorityButtonStyle = (priority: string, isSelected: boolean) => {
    const base = 'px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-1';
    if (!isSelected) return `${base} bg-bg-secondary text-text-secondary hover:bg-bg-tertiary border border-border-primary`;
    switch (priority) {
      case 'high': return `${base} bg-error text-white shadow-sm`;
      case 'medium': return `${base} bg-warning text-white shadow-sm`;
      default: return `${base} bg-success text-white shadow-sm`;
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high': return <AlertTriangle size={14} />;
      case 'medium': return <AlertCircle size={14} />;
      default: return <CheckCircle size={14} />;
    }
  };

  const isOverdue = (dueDate?: string, completed?: boolean) => {
    if (!dueDate || completed) return false;
    const now = new Date();
    const due = new Date(dueDate);
    return due < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };

  const getOverdueDays = (dueDate?: string) => {
    if (!dueDate) return 0;
    const now = new Date();
    const due = new Date(dueDate);
    return Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  };

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
    switch (f) { case 'all': return stats.total; case 'pending': return stats.pending; case 'completed': return stats.completed; }
  };

  const isAllSelected = selectedIds.size === sortedTasks.length && sortedTasks.length > 0;

  if (loading) return <Loading />;

  const taskItem = (task: Task, index?: number) => (
    <motion.div
      key={task.id}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={index !== undefined ? { duration: 0.2, delay: index * 0.03 } : { duration: 0.2 }}
      className={`group relative flex items-center gap-4 p-4 rounded-lg border transition-all overflow-hidden ${
        task.completed ? 'border-border-primary bg-bg-secondary/50' : 'border-border-primary bg-bg-card hover:border-border-secondary hover:shadow-sm'
      }`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${isOverdue(task.dueDate, task.completed) ? 'bg-rose-500' : getPriorityBar(task.priority)}`} />

      {showBatchActions && (
        <input
          type="checkbox"
          checked={selectedIds.has(task.id)}
          onChange={() => toggleSelect(task.id)}
          className="w-4 h-4 rounded border-border-primary accent-blue-500"
        />
      )}

      <button
        onClick={() => toggleTask(task.id)}
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
          task.completed ? 'bg-success text-white' : 'border-2 border-border-secondary hover:border-primary'
        }`}
      >
        {task.completed && <CheckCircle size={14} />}
      </button>

      <div className="flex-1 min-w-0">
        {editingId === task.id ? (
          <div className="space-y-3">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
              className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-primary bg-bg-card border-border-primary text-text-primary"
              autoFocus
            />
            <div className="flex gap-2 text-xs text-text-muted">
              ({editTitle.length}/{MAX_TITLE_LENGTH})
            </div>
            <div className="flex gap-2 items-center">
              <div className="flex gap-1">
                {(['low', 'medium', 'high'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setEditPriority(p)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-all duration-150 ${editPriority === p
                      ? p === 'high' ? 'bg-error text-white' : p === 'medium' ? 'bg-warning text-white' : 'bg-success text-white'
                      : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary border border-border-primary'
                    }`}
                  >
                    {getPriorityLabel(p)}
                  </button>
                ))}
              </div>
              <input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} className="px-2 py-1 border rounded text-sm bg-bg-card border-border-primary text-text-secondary" />
              <button onClick={saveEdit} className="px-3 py-1 bg-primary text-white rounded text-sm hover:bg-primary-600 transition-colors">保存</button>
              <button onClick={cancelEdit} className="px-3 py-1 border rounded text-sm border-border-primary text-text-secondary hover:bg-bg-tertiary">取消</button>
            </div>
          </div>
        ) : (
          <>
            <p className={`font-medium transition-all ${task.completed ? 'text-text-muted line-through' : 'text-text-primary'}`}>{task.title}</p>
            <div className="flex items-center gap-3 mt-1">
              <span className="flex items-center gap-1 text-xs text-text-muted"><Calendar size={12} />{new Date(task.createdAt).toLocaleDateString()}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${getPriorityColor(task.priority)}`}>{getPriorityLabel(task.priority)}</span>
              {task.dueDate && (
                <span className={`flex items-center gap-1 text-xs ${isOverdue(task.dueDate, task.completed) ? 'text-rose-500 font-medium' : 'text-text-muted'}`}>
                  <Clock size={12} />{new Date(task.dueDate).toLocaleDateString()}
                  {isOverdue(task.dueDate, task.completed) && <span>(已逾期 {getOverdueDays(task.dueDate)} 天)</span>}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {editingId !== task.id && (
        <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
          <button onClick={() => startEdit(task)} className="p-2 rounded-lg transition-all cursor-pointer text-text-muted hover:text-primary hover:bg-primary-50 dark:hover:bg-primary-900/20" title="编辑"><Edit2 size={16} /></button>
          <button onClick={() => setShowDeleteConfirm(task.id)} className="p-2 rounded-lg transition-all cursor-pointer text-text-muted hover:text-rose-500 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-900/20" title="删除"><Trash2 size={16} /></button>
        </div>
      )}
    </motion.div>
  );

  return (
    <div className="p-8 max-w-4xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">任务管理</h1>
        <div className="flex items-center gap-4 mt-2">
          <p className="text-sm text-text-muted">高效管理你的日常任务</p>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-text-muted">共 <strong className="text-text-secondary">{stats.total}</strong> 项</span>
            <span className="w-px h-3 bg-border-secondary" />
            <span className="text-emerald-600 dark:text-emerald-400">已完成 <strong>{stats.completed}</strong></span>
            <span className="w-px h-3 bg-border-secondary" />
            <span className="text-amber-600 dark:text-amber-400">待办 <strong>{stats.pending}</strong></span>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl shadow-sm border p-5 mb-4 bg-bg-card border-border-primary">
        <div className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value.slice(0, MAX_TITLE_LENGTH))}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
              placeholder="添加新任务..."
              className="flex-1 px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-bg-secondary border-border-primary text-text-primary placeholder-text-muted"
            />
            <div className="flex gap-1">
              {(['low', 'medium', 'high'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setNewTaskPriority(p)}
                  className={getPriorityButtonStyle(p, newTaskPriority === p)}
                >
                  {getPriorityIcon(p)}
                  {getPriorityLabel(p)}
                </button>
              ))}
            </div>
            <input type="date" value={newTaskDueDate} onChange={(e) => setNewTaskDueDate(e.target.value)} className="px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:border-primary bg-bg-card border-border-primary text-text-secondary" />
            <Button variant="primary" onClick={addTask} icon={<Plus size={18} />}>添加</Button>
          </div>
          {newTask.length > 0 && <div className="text-xs text-text-muted text-right">{newTask.length}/{MAX_TITLE_LENGTH}</div>}
        </div>
      </motion.div>

      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">已选择 {selectedIds.size} 项</span>
              <button onClick={() => handleBatchToggle(true)} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 transition-colors flex items-center gap-1"><CheckCircle size={14} />完成</button>
              <button onClick={() => handleBatchToggle(false)} className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 transition-colors flex items-center gap-1"><Circle size={14} />取消完成</button>
              <button onClick={() => setShowDeleteConfirm('batch')} className="px-3 py-1.5 bg-rose-500 text-white rounded-lg text-sm hover:bg-rose-600 transition-colors flex items-center gap-1"><Trash2 size={14} />删除</button>
              <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">取消</button>
            </div>
          )}
          {selectedIds.size === 0 && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索任务..."
                  className="pl-9 pr-4 py-2 w-48 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-bg-card border-border-primary text-text-primary placeholder-text-muted"
                />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary"><X size={14} /></button>}
              </div>
              {sortedTasks.length > 0 && (
                <button onClick={() => setShowBatchActions(!showBatchActions)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${showBatchActions ? 'bg-primary-50 text-primary dark:bg-primary-900/20' : 'bg-bg-tertiary text-text-secondary hover:bg-neutral-200 dark:hover:bg-neutral-700'}`}><CheckSquare size={14} />批量</button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowSortMenu(!showSortMenu)} className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700"><SortAsc size={14} />排序</button>
            <AnimatePresence>
              {showSortMenu && (
                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="absolute right-0 top-full mt-1 bg-bg-card border border-border-primary rounded-lg shadow-lg py-1 z-10 min-w-[120px]">
                  {sortOptions.map(opt => (
                    <button key={opt.key} onClick={() => { setSortType(opt.key); setShowSortMenu(false); }} className={`w-full px-3 py-1.5 text-sm text-left hover:bg-bg-tertiary transition-colors ${sortType === opt.key ? 'text-blue-600 dark:text-blue-400' : 'text-text-secondary'}`}>{opt.label}</button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {filterButtons.map(btn => (
            <button key={btn.key} onClick={() => setFilter(btn.key)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === btn.key ? 'bg-primary text-white' : 'bg-bg-card text-text-secondary border border-border-primary hover:bg-bg-secondary'}`}>
              <btn.icon size={14} />{btn.label}<span className={`text-xs ${filter === btn.key ? 'text-primary-100' : 'text-text-muted'}`}>{getFilterCount(btn.key)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-[200px]">
        {sortedTasks.length === 0 ? (
          tasks.length === 0 ? (
            <EmptyState icon={Circle} title="还没有任务" description="在上方输入框添加第一个任务吧" />
          ) : (
            <EmptyState icon={CheckCheck} title={filter === 'completed' ? '还没有已完成的任务' : searchQuery ? '未找到匹配的任务' : '没有待办任务'} description={filter === 'completed' ? '完成任务后会显示在这里' : searchQuery ? '尝试其他关键词' : '所有任务都已完成，干得漂亮！'} />
          )
        ) : sortedTasks.length > 20 ? (
          <VirtualList<Task> items={sortedTasks} itemHeight={72} containerHeight={480} renderItem={(task) => taskItem(task)} />
        ) : (
          <>
            {showBatchActions && (
              <div className="p-3 flex items-center gap-3 bg-bg-secondary rounded-lg mb-3 border border-border-primary">
                <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-border-primary accent-blue-500" />
                <span className="text-sm text-text-muted">全选</span>
              </div>
            )}
            <AnimatePresence mode="popLayout">{sortedTasks.map((task, index) => taskItem(task, index))}</AnimatePresence>
          </>
        )}
      </div>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="rounded-xl p-6 w-full max-w-sm bg-bg-card shadow-xl border border-border-primary">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" /></div>
                <h3 className="text-lg font-semibold text-text-primary">确认删除</h3>
              </div>
              <p className="text-text-secondary mb-5 text-sm">{showDeleteConfirm === 'batch' ? `确定要删除选中的 ${selectedIds.size} 个任务吗？此操作无法撤销。` : '确定要删除这个任务吗？此操作无法撤销。'}</p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-2 border rounded-lg transition-colors border-border-primary text-text-secondary hover:bg-bg-tertiary">取消</button>
                <button onClick={showDeleteConfirm === 'batch' ? handleBatchDelete : () => deleteTask(showDeleteConfirm)} className="flex-1 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors">删除</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Tasks;