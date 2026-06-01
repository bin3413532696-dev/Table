import React, { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Circle, Plus, Trash2, ListTodo, CheckCheck, AlertCircle, Search, SortAsc, AlertTriangle, CheckSquare, X, Edit2 } from 'lucide-react';
import Loading from '../../components/Loading';
import { VirtualList } from '../../components/VirtualList';
import { Button, EmptyState, PageHeader, PageContent } from '../../components/ui';
import { TaskItem, PriorityButtonGroup, TaskOverview } from './components';
import { TaskSidebar } from './components/TaskSidebar';
import { MESSAGES } from '../../core/messages';
import type { Task } from '../../core/types';
import { getErrorMessage } from '../../lib/api/client';
import { taskApi } from '../../lib/api/tasks';
import { useCollectionData } from '../../lib/useCollectionData';

type FilterType = 'all' | 'pending' | 'completed';
type SortType = 'created' | 'priority' | 'dueDate' | 'title';
export type PriorityType = 'low' | 'medium' | 'high';

const MAX_TITLE_LENGTH = 100;

const Tasks: React.FC = () => {
  const { data: tasksData, loading, error: loadError } = useCollectionData(() => taskApi.getAll(), ['tasks']);
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
  const [batchFeedback, setBatchFeedback] = useState<string>('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

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
    const mediumPriority = tasks.filter(t => t.priority === 'medium' && !t.completed).length;
    const lowPriority = tasks.filter(t => t.priority === 'low' && !t.completed).length;

    const todayStr = new Date().toISOString().split('T')[0];
    const dueToday = tasks.filter(t => t.dueDate === todayStr && !t.completed).length;

    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    const dueThisWeek = tasks.filter(t => {
      if (!t.dueDate || t.completed) return false;
      return t.dueDate >= todayStr && t.dueDate <= weekEndStr;
    }).length;

    return { total, completed, pending, overdue, highPriority, mediumPriority, lowPriority, dueToday, dueThisWeek };
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
    try {
      setIsAdding(true);
      setFeedback(null);
      setSuccessMessage(null);
      const created = await taskApi.add({
        title: trimmedTitle,
        completed: false,
        priority: newTaskPriority,
        dueDate: newTaskDueDate || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setNewTask('');
      setNewTaskPriority('medium');
      setNewTaskDueDate('');
      setFilter('all');
      setSearchQuery('');
      setSortType('created');
      setShowBatchActions(false);
      setSelectedIds(new Set());
      setSuccessMessage(`已添加任务：${created.title}`);
    } catch (error) {
      setFeedback(getErrorMessage(error, MESSAGES.tasks.saveFailed));
    } finally {
      setIsAdding(false);
    }
  }, [newTask, newTaskPriority, newTaskDueDate]);

  const toggleTask = useCallback(async (id: string) => {
    try {
      setFeedback(null);
      setSuccessMessage(null);
      const task = tasks.find((item) => item.id === id);
      if (!task || task.version === undefined) {
        throw new Error(MESSAGES.common.versionConflict);
      }
      await taskApi.update(id, {
        completed: !task.completed,
        version: task.version,
      });
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (error) {
      setFeedback(getErrorMessage(error, MESSAGES.tasks.saveFailed));
    }
  }, [tasks]);

  const deleteTask = useCallback(async (id: string) => {
    try {
      setFeedback(null);
      setSuccessMessage(null);
      await taskApi.delete(id);
      setShowDeleteConfirm(null);
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (error) {
      setFeedback(getErrorMessage(error, MESSAGES.tasks.deleteFailed));
    }
  }, []);

  const handleBatchDelete = useCallback(async () => {
    const results = await Promise.allSettled([...selectedIds].map(id => taskApi.delete(id)));
    const failedCount = results.filter((result) => result.status === 'rejected').length;
    if (failedCount > 0) {
      setBatchFeedback(`批量删除完成，但有 ${failedCount} 项删除失败。`);
    } else {
      setBatchFeedback('');
    }
    setSelectedIds(new Set());
    setShowBatchActions(false);
    setShowDeleteConfirm(null);
  }, [selectedIds]);

  const handleBatchToggle = useCallback(async (complete: boolean) => {
    const results = await Promise.allSettled([...selectedIds].map(id => {
      const task = tasks.find(t => t.id === id);
      if (task && task.completed !== complete) return taskApi.toggle(id);
      return Promise.resolve();
    }));
    const failedCount = results.filter((result) => result.status === 'rejected').length;
    if (failedCount > 0) {
      setBatchFeedback(`批量更新完成，但有 ${failedCount} 项更新失败。`);
    } else {
      setBatchFeedback('');
    }
    setSelectedIds(new Set());
    setShowBatchActions(false);
  }, [selectedIds, tasks]);

  const handleQuickFilter = useCallback((filterType: 'high' | 'overdue' | 'today' | 'week') => {
    setFilter('pending');
    setShowBatchActions(false);
    switch (filterType) {
      case 'high':
        setSearchQuery('');
        setSortType('priority');
        break;
      case 'overdue':
        setSearchQuery('');
        setSortType('dueDate');
        break;
      case 'today':
        const todayStr = new Date().toISOString().split('T')[0];
        setSearchQuery('');
        setSortType('dueDate');
        break;
      case 'week':
        setSearchQuery('');
        setSortType('dueDate');
        break;
    }
  }, []);

  const startEdit = useCallback((task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate || '');
  }, []);

  const saveEdit = useCallback(async () => {
    const trimmedTitle = editTitle.trim().slice(0, MAX_TITLE_LENGTH);
    if (!trimmedTitle || !editingId) return;
    try {
      setFeedback(null);
      setSuccessMessage(null);
      const version = tasks.find((task) => task.id === editingId)?.version;
      if (version === undefined) {
        throw new Error(MESSAGES.common.versionConflict);
      }
      await taskApi.update(editingId, {
        title: trimmedTitle,
        priority: editPriority,
        dueDate: editDueDate || undefined,
        version,
      });
      setEditingId(null);
    } catch (error) {
      setFeedback(getErrorMessage(error, MESSAGES.tasks.saveFailed));
    }
  }, [editTitle, editPriority, editDueDate, editingId, tasks]);

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
    <div className="p-3 md:p-6 min-h-screen bg-bg-secondary">
      <div className="max-w-6xl mx-auto space-y-4">
      {/* 页面头部 */}
      <PageHeader className="mb-4">
        <div className="page-header">
          <div className="page-header-icon">
            <ListTodo className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="page-header-title">任务管理</h1>
            <p className="page-header-subtitle">高效管理你的日常任务</p>
          </div>
        </div>
      </PageHeader>

      {/* 统一的任务概览组件 */}
      <TaskOverview 
        stats={stats} 
        onFilterChange={setFilter}
      />

      {/* 主内容区 - 两栏布局 */}
      <PageContent delay={0.15} className="grid-content-2-1 gap-5">
        {/* 任务列表区 */}
        <div className="lg:col-span-2 space-y-3">
          {/* 错误提示 */}
          {(loadError || feedback) && (
            <div className="rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">
              {feedback || loadError}
            </div>
          )}

          {successMessage && (
            <div className="rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
              {successMessage}
            </div>
          )}

          {batchFeedback && (
            <div className="rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
              {batchFeedback}
            </div>
          )}

          {/* 添加任务区 */}
          <div className="card-static">
            <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
              <input
                type="text"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value.slice(0, MAX_TITLE_LENGTH))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isAdding) {
                    e.preventDefault();
                    addTask();
                  }
                }}
                placeholder="输入任务内容，按 Enter 添加..."
                className="input flex-1"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <PriorityButtonGroup selected={newTaskPriority} onChange={setNewTaskPriority} />
                <input
                  type="date"
                  value={newTaskDueDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setNewTaskDueDate(e.target.value)}
                  className="input w-auto px-3 py-2 text-sm"
                  title="截止日期"
                />
                <Button
                  variant="primary"
                  onClick={addTask}
                  icon={<Plus size={16} />}
                  loading={isAdding}
                >
                  添加
                </Button>
              </div>
            </div>
            {newTask.length > 0 && (
              <div className="flex items-center justify-between mt-2 text-xs text-text-muted">
                <span>{stats.pending} 个待办任务</span>
                <span>{newTask.length}/{MAX_TITLE_LENGTH}</span>
              </div>
            )}
          </div>

          {/* 筛选和排序 */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {selectedIds.size > 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30">
                  <span className="text-sm text-primary font-medium">已选 {selectedIds.size} 项</span>
                  <Button variant="success" size="sm" onClick={() => handleBatchToggle(true)} icon={<CheckCircle size={14} />}>完成</Button>
                  <Button variant="ghost" size="sm" onClick={() => handleBatchToggle(false)} icon={<Circle size={14} />}>取消</Button>
                  <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm('batch')} icon={<Trash2 size={14} />}>删除</Button>
                  <button onClick={() => setSelectedIds(new Set())} className="text-sm text-text-muted hover:text-text-secondary ml-1">取消</button>
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
                      className="input pl-9 pr-8 w-44 md:w-52"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {sortedTasks.length > 0 && (
                    <Button variant={showBatchActions ? 'primary' : 'ghost'} size="sm" onClick={() => setShowBatchActions(!showBatchActions)} icon={<CheckSquare size={14} />}>批量</Button>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Button variant="secondary" size="sm" onClick={() => setShowSortMenu(!showSortMenu)} icon={<SortAsc size={14} />}>
                  排序
                </Button>
                <AnimatePresence>
                  {showSortMenu && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute right-0 top-full mt-1 bg-bg-card border border-border-primary rounded-lg shadow-lg py-1 z-10 min-w-[120px]">
                      {sortOptions.map(opt => (
                        <button key={opt.key} onClick={() => { setSortType(opt.key); setShowSortMenu(false); }} className={`w-full px-3 py-2 text-sm text-left transition-colors ${sortType === opt.key ? 'text-primary bg-primary/10' : 'text-text-secondary hover:bg-bg-tertiary'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {filterButtons.map(btn => (
                <button key={btn.key} onClick={() => setFilter(btn.key)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${filter === btn.key ? 'bg-primary text-white shadow-sm' : 'bg-bg-card border border-border-primary text-text-primary hover:bg-bg-tertiary'}`}>
                  <btn.icon size={14} />
                  {btn.label}
                  <span className={`text-xs ${filter === btn.key ? 'text-white/70' : 'text-text-muted'}`}>{getFilterCount(btn.key)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 任务列表 */}
          <div className="rounded-lg shadow-lg border bg-bg-card border-border-primary/80">
            <div className="divide-y divide-border-primary min-h-[200px]">
              {sortedTasks.length === 0 ? (
                tasks.length === 0 ? (
                  <EmptyState icon={ListTodo} title="还没有任务" description="在上方输入框添加第一个任务" />
                ) : (
                  <EmptyState icon={filter === 'completed' ? CheckCheck : AlertCircle} title={filter === 'completed' ? '还没有已完成的任务' : searchQuery ? '未找到匹配的任务' : '没有待办任务'} description={filter === 'completed' ? '完成任务后会显示在这里' : searchQuery ? '尝试其他关键词' : '所有任务都已完成'} />
                )
              ) : sortedTasks.length > 20 ? (
                <>
                  {showBatchActions && (
                    <div className="p-2 flex items-center gap-3 bg-bg-secondary border-b border-border-primary sticky top-0 z-10">
                      <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-border-primary accent-primary" />
                      <span className="text-sm text-text-muted">全选 ({sortedTasks.length} 条任务)</span>
                    </div>
                  )}
                  <VirtualList<Task> items={sortedTasks} itemHeight={72} containerHeight={480} renderItem={renderTaskItem} />
                </>
              ) : (
                <>
                  {showBatchActions && (
                    <div className="p-2 flex items-center gap-3 bg-bg-secondary border-b border-border-primary">
                      <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-border-primary accent-primary" />
                      <span className="text-sm text-text-muted">全选</span>
                    </div>
                  )}
                  <AnimatePresence mode="popLayout">{sortedTasks.map((task, index) => renderTaskItem(task, index))}</AnimatePresence>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 侧边栏 */}
        <TaskSidebar stats={stats} onQuickFilter={handleQuickFilter} />
      </PageContent>

      {/* 删除确认弹窗 */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="card w-full max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-error" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary">确认删除</h3>
              </div>
              <p className="text-text-secondary mb-5 text-sm">{showDeleteConfirm === 'batch' ? `确定要删除选中的 ${selectedIds.size} 个任务吗？此操作无法撤销。` : '确定要删除这个任务吗？此操作无法撤销。'}</p>
              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setShowDeleteConfirm(null)} className="flex-1">取消</Button>
                <Button variant="danger" onClick={showDeleteConfirm === 'batch' ? handleBatchDelete : () => deleteTask(showDeleteConfirm)} className="flex-1">删除</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
};

export default Tasks;
