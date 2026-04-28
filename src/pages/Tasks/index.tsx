import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Circle, Plus, Trash2, Calendar, Edit2, Flag, Clock } from 'lucide-react';

interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
}

const STORAGE_KEY = 'tasks_records';

function loadTasks(): Task[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveTasks(tasks: Task[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [editDueDate, setEditDueDate] = useState('');

  useEffect(() => {
    setTasks(loadTasks());
  }, []);

  const addTask = () => {
    if (!newTask.trim()) return;
    const task: Task = {
      id: Date.now().toString(),
      title: newTask.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
      priority: newTaskPriority,
      dueDate: newTaskDueDate || undefined
    };
    const updated = [task, ...tasks];
    setTasks(updated);
    saveTasks(updated);
    setNewTask('');
    setNewTaskPriority('medium');
    setNewTaskDueDate('');
  };

  const toggleTask = (id: string) => {
    const updated = tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
    setTasks(updated);
    saveTasks(updated);
  };

  const deleteTask = (id: string) => {
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    saveTasks(updated);
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate || '');
  };

  const saveEdit = () => {
    if (!editTitle.trim()) return;
    const updated = tasks.map(t => t.id === editingId ? { ...t, title: editTitle.trim(), priority: editPriority, dueDate: editDueDate || undefined } : t);
    setTasks(updated);
    saveTasks(updated);
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditPriority('medium');
    setEditDueDate('');
  };

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

  const isOverdue = (dueDate?: string) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date() && new Date(dueDate).toDateString() !== new Date().toDateString();
  };

  return (
    <div className="p-8 max-w-4xl mx-auto min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold mb-2 text-gray-900">任务管理</h1>
        <p className="text-gray-500">高效管理你的日常任务</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl shadow-sm border p-6 mb-6 bg-white border-gray-200"
      >
        <div className="space-y-3">
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTask()}
            placeholder="添加新任务..."
            className="w-full px-5 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"
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
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 cursor-pointer shadow-md shadow-blue-500/20"
            >
              <Plus size={18} />
              添加
            </button>
          </div>
        </div>
      </motion.div>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <motion.div
              key={task.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`group flex items-center gap-4 p-5 rounded-xl border transition-all cursor-pointer ${
                task.completed
                  ? 'border-gray-200 bg-gray-50/50'
                  : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-md hover:shadow-blue-100'
              }`}
            >
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
                      className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white border-gray-200 text-gray-900"
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
                        <span className={`flex items-center gap-1 text-xs ${isOverdue(task.dueDate) && !task.completed ? 'text-rose-500' : 'text-gray-400'}`}>
                          <Clock size={12} />
                          {new Date(task.dueDate).toLocaleDateString()}
                          {isOverdue(task.dueDate) && !task.completed && <span className="text-rose-500 font-medium">(已逾期)</span>}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {editingId !== task.id && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(task)}
                    className="p-2 rounded-lg transition-all cursor-pointer text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="p-2 rounded-lg transition-all cursor-pointer text-gray-400 hover:text-rose-500 hover:bg-rose-50"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {tasks.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center bg-gray-100">
            <Circle className="w-10 h-10 text-gray-300" />
          </div>
          <p>暂无任务，添加一个开始吧</p>
        </div>
      )}
    </div>
  );
};

export default Tasks;
