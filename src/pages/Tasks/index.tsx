import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Circle, Plus, Trash2, Calendar, Edit2, Clock, ListTodo, CheckCheck, AlertCircle } from 'lucide-react';
import { taskDB, Task, createUseDB } from '../../db';
import Loading from '../../components/Loading';
import { VirtualList } from '../../components/VirtualList';

type FilterType = 'all' | 'pending' | 'completed';

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

  const stats = useMemo(() => ({
    total: tasks.length,
    completed: tasks.filter(t => t.completed).length,
    pending: tasks.filter(t => !t.completed).length
  }), [tasks]);

  const filteredTasks = useMemo(() => {
    switch (filter) {
      case 'pending': return tasks.filter(t => !t.completed);
      case 'completed': return tasks.filter(t => t.completed);
      default: return tasks;
    }
  }, [tasks, filter]);

  const addTask = useCallback(async () => {
    if (!newTask.trim()) return;
    await taskDB.add({
      title: newTask.trim(),
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
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    await taskDB.delete(id);
  }, []);

  const startEdit = useCallback((task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate || '');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editTitle.trim() || !editingId) return;
    await taskDB.update(editingId, {
      title: editTitle.trim(),
      priority: editPriority,
      dueDate: editDueDate || undefined
    });
    setEditingId(null);
  }, [editTitle, editPriority, editDueDate, editingId]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800';
      case 'medium': return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
      default: return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high': return '高';
      case 'medium': return '中';
      default: return '低';
    }
  };

  const getPriorityBar = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-rose-500';
      case 'medium': return 'bg-amber-500';
      default: return 'bg-emerald-500';
    }
  };

  const isOverdue = (dueDate?: string) => {
    if (!dueDate) return false;
    const now = new Date();
    const due = new Date(dueDate);
    return due < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };

  const getOverdueDays = (dueDate?: string) => {
    if (!dueDate) return 0;
    const now = new Date();
    const due = new Date(dueDate);
    const diff = now.getTime() - due.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const filterButtons: { key: FilterType; label: string; icon: React.ElementType }[] = [
    { key: 'all', label: '全部', icon: ListTodo },
    { key: 'pending', label: '待办', icon: AlertCircle },
    { key: 'completed', label: '已完成', icon: CheckCheck },
  ];

  const getFilterCount = (f: FilterType) => {
    switch (f) {
      case 'all': return stats.total;
      case 'pending': return stats.pending;
      case 'completed': return stats.completed;
    }
  };

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto min-h-screen bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-tertiary)]">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-3xl font-bold text-text-primary">任务管理</h1>
        <div className="flex items-center gap-4 mt-2">
          <p className="text-text-muted">高效管理你的日常任务</p>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-text-muted">
              共 <strong className="text-text-secondary">{stats.total}</strong> 项
            </span>
            <span className="w-px h-3 bg-border-secondary" />
            <span className="text-emerald-600 dark:text-emerald-400">
              已完成 <strong>{stats.completed}</strong>
            </span>
            <span className="w-px h-3 bg-border-secondary" />
            <span className="text-amber-600 dark:text-amber-400">
              待办 <strong>{stats.pending}</strong>
            </span>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl shadow-sm border p-6 mb-4 bg-bg-card border-border-primary"
      >
        <div className="space-y-3">
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTask()}
            placeholder="添加新任务..."
            className="w-full px-5 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-bg-secondary border-border-primary text-text-primary placeholder-text-muted"
          />
          <div className="flex gap-3">
            <select
              value={newTaskPriority}
              onChange={(e) => setNewTaskPriority(e.target.value as typeof newTaskPriority)}
              className="px-4 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-bg-card border-border-primary text-text-secondary"
            >
              <option value="low">低优先级</option>
              <option value="medium">中优先级</option>
              <option value="high">高优先级</option>
            </select>
            <input
              type="date"
              value={newTaskDueDate}
              onChange={(e) => setNewTaskDueDate(e.target.value)}
              placeholder="截止日期"
              className="px-4 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-bg-card border-border-primary text-text-secondary"
            />
            <button
              onClick={addTask}
              className="px-6 py-2 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors cursor-pointer flex items-center gap-2 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <Plus size={18} />
              添加
            </button>
          </div>
        </div>
      </motion.div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-4">
        {filterButtons.map(btn => (
          <button
            key={btn.key}
            onClick={() => setFilter(btn.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === btn.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-bg-card text-text-secondary border border-border-primary hover:bg-bg-secondary'
            }`}
          >
            <btn.icon size={15} />
            {btn.label}
            <span className={`text-xs ml-0.5 ${
              filter === btn.key ? 'text-blue-200' : 'text-text-muted'
            }`}>
              {getFilterCount(btn.key)}
            </span>
          </button>
        ))}
      </div>

      <div className="min-h-[200px]">
        {filteredTasks.length > 20 ? (
          <VirtualList<Task>
            items={filteredTasks}
            itemHeight={80}
            containerHeight={500}
            renderItem={(task) => (
              <div
                key={task.id}
                className={`group flex items-center gap-4 p-4 rounded-lg border transition-all cursor-pointer overflow-hidden ${
                  task.completed
                    ? 'border-border-primary bg-bg-secondary/50'
                    : 'border-border-primary bg-bg-card hover:border-border-secondary hover:shadow-sm'
                }`}
              >
                <div
                  className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${
                    isOverdue(task.dueDate) && !task.completed
                      ? 'bg-rose-500'
                      : getPriorityBar(task.priority)
                  }`}
                />

                <button
                  onClick={() => toggleTask(task.id)}
                  className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                    task.completed
                      ? 'bg-emerald-500 text-white'
                      : 'border-2 border-border-secondary hover:border-blue-500'
                  }`}
                >
                  {task.completed && <CheckCircle size={14} />}
                </button>

                <div className="flex-1 min-w-0">
                  {editingId === task.id ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                        className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <select
                          value={editPriority}
                          onChange={(e) => setEditPriority(e.target.value as typeof editPriority)}
                          className="px-2 py-1 border rounded text-sm bg-bg-card border-border-primary text-text-secondary"
                        >
                          <option value="low">低</option>
                          <option value="medium">中</option>
                          <option value="high">高</option>
                        </select>
                        <input
                          type="date"
                          value={editDueDate}
                          onChange={(e) => setEditDueDate(e.target.value)}
                          className="px-2 py-1 border rounded text-sm bg-bg-card border-border-primary text-text-secondary"
                        />
                        <button onClick={saveEdit} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">保存</button>
                        <button onClick={cancelEdit} className="px-3 py-1 border rounded text-sm border-border-primary text-text-secondary hover:bg-bg-tertiary">取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className={`font-medium transition-all ${
                        task.completed ? 'text-text-muted line-through' : 'text-text-primary'
                      }`}>
                        {task.title}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1 text-xs text-text-muted">
                          <Calendar size={12} />
                          {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${getPriorityColor(task.priority)}`}>
                          {getPriorityLabel(task.priority)}
                        </span>
                        {task.dueDate && (
                          <span className={`flex items-center gap-1 text-xs ${
                            isOverdue(task.dueDate) && !task.completed
                              ? 'text-rose-500 font-medium'
                              : 'text-text-muted'
                          }`}>
                            <Clock size={12} />
                            {new Date(task.dueDate).toLocaleDateString()}
                            {isOverdue(task.dueDate) && !task.completed && (
                              <span className="text-rose-500">(已逾期 {getOverdueDays(task.dueDate)} 天)</span>
                            )}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {editingId !== task.id && (
                  <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(task)}
                      className="p-2 rounded-lg transition-all cursor-pointer text-text-muted hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-900/20"
                      title="编辑"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="p-2 rounded-lg transition-all cursor-pointer text-text-muted hover:text-rose-500 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-900/20"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            )}
          />
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredTasks.map((task) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={`group flex items-center gap-4 p-4 rounded-lg border transition-all cursor-pointer overflow-hidden ${
                  task.completed
                    ? 'border-border-primary bg-bg-secondary/50'
                    : 'border-border-primary bg-bg-card hover:border-border-secondary hover:shadow-sm'
                }`}
              >
                <div
                  className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${
                    isOverdue(task.dueDate) && !task.completed
                      ? 'bg-rose-500'
                      : getPriorityBar(task.priority)
                  }`}
                />

                <button
                  onClick={() => toggleTask(task.id)}
                  className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                    task.completed
                      ? 'bg-emerald-500 text-white'
                      : 'border-2 border-border-secondary hover:border-blue-500'
                  }`}
                >
                  {task.completed && <CheckCircle size={14} />}
                </button>

                <div className="flex-1 min-w-0">
                  {editingId === task.id ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                        className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <select
                          value={editPriority}
                          onChange={(e) => setEditPriority(e.target.value as typeof editPriority)}
                          className="px-2 py-1 border rounded text-sm bg-bg-card border-border-primary text-text-secondary"
                        >
                          <option value="low">低</option>
                          <option value="medium">中</option>
                          <option value="high">高</option>
                        </select>
                        <input
                          type="date"
                          value={editDueDate}
                          onChange={(e) => setEditDueDate(e.target.value)}
                          className="px-2 py-1 border rounded text-sm bg-bg-card border-border-primary text-text-secondary"
                        />
                        <button onClick={saveEdit} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">保存</button>
                        <button onClick={cancelEdit} className="px-3 py-1 border rounded text-sm border-border-primary text-text-secondary hover:bg-bg-tertiary">取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className={`font-medium transition-all ${
                        task.completed ? 'text-text-muted line-through' : 'text-text-primary'
                      }`}>
                        {task.title}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1 text-xs text-text-muted">
                          <Calendar size={12} />
                          {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${getPriorityColor(task.priority)}`}>
                          {getPriorityLabel(task.priority)}
                        </span>
                        {task.dueDate && (
                          <span className={`flex items-center gap-1 text-xs ${
                            isOverdue(task.dueDate) && !task.completed
                              ? 'text-rose-500 font-medium'
                              : 'text-text-muted'
                          }`}>
                            <Clock size={12} />
                            {new Date(task.dueDate).toLocaleDateString()}
                            {isOverdue(task.dueDate) && !task.completed && (
                              <span className="text-rose-500">(已逾期 {getOverdueDays(task.dueDate)} 天)</span>
                            )}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {editingId !== task.id && (
                  <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(task)}
                      className="p-2 rounded-lg transition-all cursor-pointer text-text-muted hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-900/20"
                      title="编辑"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="p-2 rounded-lg transition-all cursor-pointer text-text-muted hover:text-rose-500 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-900/20"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {tasks.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 text-text-muted"
        >
          <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center bg-bg-tertiary">
            <Circle className="w-10 h-10 text-text-muted" />
          </div>
          <p className="text-lg font-medium text-text-muted mb-1">还没有任务</p>
          <p className="text-sm">在上方输入框添加第一个任务吧</p>
        </motion.div>
      )}

      {tasks.length > 0 && filteredTasks.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 text-text-muted"
        >
          <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center bg-bg-tertiary">
            <CheckCheck className="w-10 h-10 text-text-muted" />
          </div>
          <p className="text-lg font-medium text-text-muted mb-1">
            {filter === 'completed' ? '还没有已完成的任务' : '没有待办任务'}
          </p>
          <p className="text-sm">
            {filter === 'completed'
              ? '完成任务后会显示在这里'
              : '所有任务都已完成，干得漂亮！'}
          </p>
        </motion.div>
      )}
    </div>
  );
};

export default Tasks;
