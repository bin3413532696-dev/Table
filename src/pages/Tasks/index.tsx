import React, { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Circle, Plus, Trash2, Calendar, Clock, ListTodo, CheckCheck, AlertCircle, Search, SortAsc, AlertTriangle, CheckSquare, X, Flag, Edit2 } from 'lucide-react';
import { taskDB, Task, createUseDB } from '../../db';
import Loading from '../../components/Loading';
import { VirtualList } from '../../components/VirtualList';
import { Button, EmptyState } from '../../components/ui';

type FilterType = 'all' | 'pending' | 'completed';
type SortType = 'created' | 'priority' | 'dueDate' | 'title';
type PriorityType = 'low' | 'medium' | 'high';

const MAX_TITLE_LENGTH = 100;
const useDB = createUseDB(React);

// 优先级配置
const PRIORITY_CONFIG: Record<PriorityType, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  high: { label: '高', color: 'text-error', bgColor: 'bg-error', icon: AlertTriangle },
  medium: { label: '中', color: 'text-warning', bgColor: 'bg-warning', icon: AlertCircle },
  low: { label: '低', color: 'text-success', bgColor: 'bg-success', icon: CheckCircle },
};

const Tasks: React.FC = () => {
  const { data: tasksData, loading } = useDB(() => taskDB.getAll(), ['tasks']);
  const tasks = tasksData ?? [];

  // 状态
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

  // 统计
  const stats = useMemo(() => ({
    total: tasks.length,
    completed: tasks.filter(t => t.completed).length,
    pending: tasks.filter(t => !t.completed).length,
  }), [tasks]);

  // 筛选和排序
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

  // 操作
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

  // 辅助函数
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

  const isAllSelected = selectedIds.size === sortedTasks.length && sortedTasks.length > 0;

  if (loading) return <Loading />;

  // 优先级按钮组件
  const PriorityButton: React.FC<{ priority: PriorityType; selected: boolean; onClick: () => void; size?: 'sm' | 'md' }> = ({ priority, selected, onClick, size = 'md' }) => {
    const config = PRIORITY_CONFIG[priority];
    const sizeClass = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm';
    return (
      <button
        onClick={onClick}
        className={`${sizeClass} rounded font-medium transition-all duration-150 flex items-center gap-1 ${
          selected
            ? `${config.bgColor} text-white shadow-sm`
            : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary border border-border-primary'
        }`}
      >
        <config.icon size={size === 'sm' ? 12 : 14} />
        {config.label}
      </button>
    );
  };

  // 任务项组件
  const TaskItem: React.FC<{ task: Task; index?: number }> = ({ task, index }) => {
    const config = PRIORITY_CONFIG[task.priority];
    const overdue = isOverdue(task.dueDate, task.completed);

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={index !== undefined ? { delay: index * 0.02 } : undefined}
        className={`group relative flex items-center gap-4 p-4 rounded-lg border transition-all duration-150 ${
          task.completed
            ? 'bg-bg-secondary/50 border-border-primary'
            : 'bg-bg-card border-border-primary hover:border-primary/30 hover:shadow-card'
        }`}
      >
        {/* 左侧指示条 */}
        <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l ${overdue ? 'bg-error' : config.bgColor}`} />

        {/* 批量选择复选框 */}
        {showBatchActions && (
          <input
            type="checkbox"
            checked={selectedIds.has(task.id)}
            onChange={() => toggleSelect(task.id)}
            className="w-4 h-4 rounded border-border-primary accent-primary"
          />
        )}

        {/* 完成状态按钮 */}
        <button
          onClick={() => toggleTask(task.id)}
          className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
            task.completed
              ? 'bg-success text-white'
              : 'border-2 border-border-secondary hover:border-primary'
          }`}
        >
          {task.completed && <CheckCircle size={14} />}
        </button>

        {/* 内容区域 */}
        <div className="flex-1 min-w-0">
          {editingId === task.id ? (
            <div className="space-y-3">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-bg-card border-border-primary text-text-primary"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {(['low', 'medium', 'high'] as const).map(p => (
                    <PriorityButton key={p} priority={p} selected={editPriority === p} onClick={() => setEditPriority(p)} size="sm" />
                  ))}
                </div>
                <input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                  className="px-2 py-1 border rounded text-sm bg-bg-card border-border-primary text-text-secondary"
                />
                <Button variant="primary" size="sm" onClick={saveEdit}>保存</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>取消</Button>
              </div>
            </div>
          ) : (
            <>
              <p className={`font-medium ${task.completed ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                {task.title}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="flex items-center gap-1 text-xs text-text-muted">
                  <Calendar size={12} />
                  {new Date(task.createdAt).toLocaleDateString()}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${config.bgColor}/10 ${config.color} border border-current/20`}>
                  {config.label}
                </span>
                {task.dueDate && (
                  <span className={`flex items-center gap-1 text-xs ${overdue ? 'text-error font-medium' : 'text-text-muted'}`}>
                    <Clock size={12} />
                    {new Date(task.dueDate).toLocaleDateString()}
                    {overdue && <span className="text-error">(逾期{getOverdueDays(task.dueDate)}天)</span>}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* 操作按钮 */}
        {editingId !== task.id && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => startEdit(task)}
              className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => setShowDeleteConfirm(task.id)}
              className="p-2 rounded-lg text-text-muted hover:text-error hover:bg-error/10 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </motion.div>
    );
  };

  // 筛选按钮配置
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

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto min-h-screen bg-bg-secondary">
      {/* 页面标题 */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 md:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <ListTodo className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-text-primary">任务管理</h1>
        </div>
        <p className="text-sm text-text-muted ml-13">高效管理你的日常任务</p>
      </motion.div>

      {/* 统计卡片 */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-3 gap-3 md:gap-4 mb-6">
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
      </motion.div>

      {/* 添加任务表单 */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg shadow-card border p-4 md:p-5 mb-6 bg-bg-card border-border-primary">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value.slice(0, MAX_TITLE_LENGTH))}
            onKeyDown={(e) => e.key === 'Enter' && addTask()}
            placeholder="输入任务内容..."
            className="flex-1 px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-bg-secondary border-border-primary text-text-primary placeholder-text-muted"
          />
          <div className="flex gap-1 justify-center">
            {(['low', 'medium', 'high'] as const).map(p => (
              <PriorityButton key={p} priority={p} selected={newTaskPriority === p} onClick={() => setNewTaskPriority(p)} />
            ))}
          </div>
          <input
            type="date"
            value={newTaskDueDate}
            onChange={(e) => setNewTaskDueDate(e.target.value)}
            className="px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-bg-card border-border-primary text-text-secondary"
          />
          <Button variant="primary" onClick={addTask} icon={<Plus size={18} />}>添加</Button>
        </div>
        {newTask.length > 0 && (
          <div className="text-xs text-text-muted text-right mt-2">{newTask.length}/{MAX_TITLE_LENGTH}</div>
        )}
      </motion.div>

      {/* 工具栏 */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          {/* 批量操作模式 */}
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
              {/* 搜索框 */}
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
              {/* 批量模式切换 */}
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

        {/* 排序和筛选 */}
        <div className="flex items-center gap-2">
          {/* 排序 */}
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

          {/* 筛选按钮 */}
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

      {/* 任务列表 */}
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
          <VirtualList<Task> items={sortedTasks} itemHeight={72} containerHeight={480} renderItem={(task) => <TaskItem task={task} />} />
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
              {sortedTasks.map((task, index) => <TaskItem key={task.id} task={task} index={index} />)}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* 删除确认弹窗 */}
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