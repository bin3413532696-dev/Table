import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Circle, Plus, Trash2, Calendar, Edit2, Clock, ListTodo, CheckCheck, AlertCircle } from 'lucide-react';
import { taskDB, Task } from '../../db';

type FilterType = 'all' | 'pending' | 'completed';

const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [editDueDate, setEditDueDate] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => {
    taskDB.getAll().then(setTasks);
  }, []);

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
    const added = await taskDB.add({
      title: newTask.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
      priority: newTaskPriority,
      dueDate: newTaskDueDate || undefined
    });
    setTasks(prev => [added, ...prev]);
    setNewTask('');
    setNewTaskPriority('medium');
    setNewTaskDueDate('');
  }, [newTask, newTaskPriority, newTaskDueDate]);

  const toggleTask = useCallback(async (id: string) => {
    await taskDB.toggle(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    await taskDB.delete(id);
    setTasks(prev => prev.filter(t => t.id !== id));
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
    setTasks(prev => prev.map(t =>
      t.id === editingId
        ? { ...t, title: editTitle.trim(), priority: editPriority, dueDate: editDueDate || undefined }
        : t
    ));
    setEditingId(null);
  }, [editTitle, editPriority, editDueDate, editingId]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'medium': return 'bg-amber-100 text-amber-700 border-amber-200';
      default: return 'bg-emerald-100 text-emerald-700 border-emerald-200';
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

  return (
    <div className="p-8 max-w-4xl mx-auto min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-3xl font-bold text-gray-900">任务管理</h1>
        <div className="flex items-center gap-4 mt-2">
          <p className="text-gray-500">高效管理你的日常任务</p>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">
              共 <strong className="text-gray-700">{stats.total}</strong> 项
            </span>
            <span className="w-px h-3 bg-gray-300" />
            <span className="text-emerald-600">
              已完成 <strong>{stats.completed}</strong>
            </span>
            <span className="w-px h-3 bg-gray-300" />
            <span className="text-amber-600">
              待办 <strong>{stats.pending}</strong>
            </span>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl shadow-sm border p-6 mb-4 bg-white border-gray-200"
      >
        <div className="space-y-3">
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTask()}
            placeholder="添加新任务..."
            className="w-full px-5 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"
          />
          <div className="flex gap-3">
            <select
              value={newTaskPriority}
              onChange={(e) => setNewTaskPriority(e.target.value as typeof newTaskPriority)}
              className="px-4 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white border-gray-200 text-gray-700"
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
              className="px-4 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white border-gray-200 text-gray-700"
            />
            <button
              onClick={addTask}
              className="px-6 py-2 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors cursor-pointer flex items-center gap-2"
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
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <btn.icon size={15} />
            {btn.label}
            <span className={`text-xs ml-0.5 ${
              filter === btn.key ? 'text-blue-200' : 'text-gray-400'
            }`}>
              {getFilterCount(btn.key)}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-2">
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
                  ? 'border-gray-200 bg-gray-50/50'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
              }`}
            >
              {/* Priority/overdue left bar */}
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
                    : 'border-2 border-gray-300 hover:border-blue-500'
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
                      className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white border-gray-200 text-gray-900"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <select
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value as typeof editPriority)}
                        className="px-2 py-1 border rounded text-sm bg-white border-gray-200 text-gray-700"
                      >
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                      </select>
                      <input
                        type="date"
                        value={editDueDate}
                        onChange={(e) => setEditDueDate(e.target.value)}
                        className="px-2 py-1 border rounded text-sm bg-white border-gray-200 text-gray-700"
                      />
                      <button onClick={saveEdit} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">保存</button>
                      <button onClick={cancelEdit} className="px-3 py-1 border rounded text-sm border-gray-200 text-gray-600 hover:bg-gray-100">取消</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className={`font-medium transition-all ${
                      task.completed ? 'text-gray-400 line-through' : 'text-gray-800'
                    }`}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-xs text-gray-400">
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
                            : 'text-gray-400'
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
                    className="p-2 rounded-lg transition-all cursor-pointer text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                    title="编辑"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="p-2 rounded-lg transition-all cursor-pointer text-gray-400 hover:text-rose-500 hover:bg-rose-50"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {tasks.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 text-gray-400"
        >
          <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center bg-gray-100">
            <Circle className="w-10 h-10 text-gray-300" />
          </div>
          <p className="text-lg font-medium text-gray-500 mb-1">还没有任务</p>
          <p className="text-sm">在上方输入框添加第一个任务吧</p>
        </motion.div>
      )}

      {tasks.length > 0 && filteredTasks.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 text-gray-400"
        >
          <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center bg-gray-100">
            <CheckCheck className="w-10 h-10 text-gray-300" />
          </div>
          <p className="text-lg font-medium text-gray-500 mb-1">
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
