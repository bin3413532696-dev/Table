import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Bell, Shield, Database, Download, Upload, Trash2, AlertCircle, CheckCircle, FileText, Lock, Eye, EyeOff, Mail, MessageSquare, Calendar, Check, Sun, Moon } from 'lucide-react';
import { dataManager, noteDB, folderDB, Note, Folder } from '../../db';
import { useTheme } from '../../contexts/ThemeContext';

const settingsTabs = [
  { id: 'profile', label: '个人资料', icon: User },
  { id: 'notifications', label: '通知设置', icon: Bell },
  { id: 'security', label: '安全隐私', icon: Shield },
  { id: 'data', label: '数据管理', icon: Database },
];

const tabContent: Record<string, { title: string; desc: string }> = {
  profile: { title: '个人资料', desc: '管理您的个人信息和账户设置' },
  notifications: { title: '通知设置', desc: '自定义您接收通知的方式' },
  security: { title: '安全隐私', desc: '保护您的账户和数据安全' },
  data: { title: '数据管理', desc: '浏览数据统计，导入导出备份，自动同步到文件系统' },
};

function ProfileSettings() {
  const [profile, setProfile] = useState({
    name: '个人用户',
    email: '',
    bio: '',
    avatar: ''
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('user_profile');
    if (saved) setProfile(JSON.parse(saved));
  }, []);

  const handleSave = () => {
    localStorage.setItem('user_profile', JSON.stringify(profile));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
          {profile.name.charAt(0)}
        </div>
        <div>
          <h3 className="font-semibold text-text-primary">{profile.name}</h3>
          <p className="text-sm text-text-muted">个人工作站用户</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-text-secondary">昵称</label>
          <input
            type="text"
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-text-secondary">邮箱</label>
          <input
            type="email"
            value={profile.email}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            placeholder="your@email.com"
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-text-secondary">个人简介</label>
          <textarea
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="介绍一下自己..."
            rows={3}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none bg-bg-card border-border-primary text-text-primary"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
      >
        {saved ? <Check className="w-4 h-4" /> : null}
        保存设置
      </button>
    </div>
  );
}

function NotificationSettings() {
  const [settings, setSettings] = useState({
    taskReminder: true,
    weeklyReport: false,
    budgetAlert: true,
    emailNotification: false
  });

  useEffect(() => {
    const saved = localStorage.getItem('notification_settings');
    if (saved) setSettings(JSON.parse(saved));
  }, []);

  const toggle = (key: keyof typeof settings) => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    localStorage.setItem('notification_settings', JSON.stringify(updated));
  };

  const items = [
    { key: 'taskReminder', label: '任务提醒', desc: '任务截止日期前提醒', icon: Calendar },
    { key: 'budgetAlert', label: '预算预警', desc: '费用支出超过设定阈值时提醒', icon: AlertCircle },
    { key: 'weeklyReport', label: '周报', desc: '每周生成数据汇总报告', icon: Mail },
    { key: 'emailNotification', label: '邮件通知', desc: '接收邮件形式的通知', icon: MessageSquare },
  ];

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.key} className="flex items-center justify-between p-4 rounded-xl bg-bg-secondary">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-bg-card">
              <item.icon className="w-5 h-5 text-text-secondary" />
            </div>
            <div>
              <div className="font-medium text-text-primary">{item.label}</div>
              <div className="text-sm text-text-muted">{item.desc}</div>
            </div>
          </div>
          <button
            onClick={() => toggle(item.key as keyof typeof settings)}
            className={`w-12 h-6 rounded-full transition-colors ${settings[item.key as keyof typeof settings] ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <div className={`w-5 h-5 bg-bg-card rounded-full shadow-sm transition-transform ${settings[item.key as keyof typeof settings] ? 'translate-x-6' : 'translate-x-0.5'} mt-0.5`} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SecuritySettings() {
  const [showPassword, setShowPassword] = useState(false);
  const [pin, setPin] = useState('');
  const [enabled, setEnabled] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const saved = localStorage.getItem('security_pin');
    if (saved) {
      setPin(saved);
      setEnabled(true);
    }
  }, []);

  const handleSavePin = () => {
    if (pin.length >= 4) {
      localStorage.setItem('security_pin', pin);
      setEnabled(true);
    }
  };

  const handleClearPin = () => {
    localStorage.removeItem('security_pin');
    setPin('');
    setEnabled(false);
  };

  return (
    <div className="space-y-6">
      <div className="p-4 border rounded-xl bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 text-amber-600 dark:text-amber-300" />
          <div>
            <h4 className="font-medium text-amber-900 dark:text-amber-100">本地数据安全</h4>
            <p className="text-sm mt-1 text-amber-700 dark:text-amber-200">
              所有数据存储在浏览器本地，清除浏览器数据将导致数据丢失。建议定期导出备份。
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="font-medium text-text-primary">访问密码</h4>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="设置4位数字密码"
              maxLength={6}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {!enabled ? (
            <button
              onClick={handleSavePin}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              启用
            </button>
          ) : (
            <button
              onClick={handleClearPin}
              className="px-4 py-2 border rounded-lg transition-colors border-border-primary text-text-secondary hover:bg-bg-secondary"
            >
              关闭
            </button>
          )}
        </div>
        {enabled && <p className="text-sm text-emerald-500 dark:text-emerald-400">密码保护已启用</p>}
      </div>

      <div className="space-y-4">
        <h4 className="font-medium text-text-primary">主题设置</h4>
        <div className="flex items-center justify-between p-4 rounded-xl bg-bg-secondary">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gray-200 dark:bg-gray-700">
              {theme === 'dark' ? <Moon className="w-5 h-5 text-text-secondary" /> : <Sun className="w-5 h-5 text-amber-500 dark:text-amber-300" />}
            </div>
            <div>
              <div className="font-medium text-text-primary">外观主题</div>
              <div className="text-sm text-text-muted">{theme === 'dark' ? '暗色模式' : '浅色模式'}</div>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className={`w-12 h-6 rounded-full transition-colors ${theme === 'dark' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <div className={`w-5 h-5 bg-bg-card rounded-full shadow-sm transition-transform ${theme === 'dark' ? 'translate-x-6' : 'translate-x-0.5'} mt-0.5`} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DataManager() {
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done'>('idle');
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const stats = dataManager.getStats();

  useEffect(() => {
    noteDB.getAll().then(setAllNotes);
    folderDB.getAll().then(setAllFolders);
  }, []);

  const sanitizeFileName = (name: string) =>
    name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim() || 'untitled';

  const handleExport = () => {
    const data = dataManager.exportAll();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workspace_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const success = dataManager.importAll(content);
      if (success) {
        setImportStatus('success');
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setImportStatus('error');
        setTimeout(() => setImportStatus('idle'), 3000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClear = () => {
    dataManager.clearAll();
    setShowClearConfirm(false);
    window.location.reload();
  };

  const handleExportNotes = async () => {
    setExportStatus('exporting');
    const notes = await noteDB.getAll();
    const folders = await folderDB.getAll();
    const folderMap: Record<string, string> = {};
    folders.forEach(f => { folderMap[f.id] = f.name; });

    notes.forEach((note, index) => {
      const tags = note.tags?.length
        ? `tags: [${note.tags.map(t => `"${t}"`).join(', ')}]`
        : 'tags: []';

      const frontMatter = `---
title: "${note.title}"
created: ${note.createdAt}
updated: ${note.updatedAt}
${tags}
---

`;

      const content = frontMatter + (note.content || '');
      const fileName = sanitizeFileName(note.title) + '.md';
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);

      setTimeout(() => {
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (index === notes.length - 1) {
          setExportStatus('done');
          setTimeout(() => setExportStatus('idle'), 3000);
        }
      }, index * 300);
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-6 text-sm text-text-secondary">
        <span>费用记录 <strong className="text-text-primary">{stats.finance}</strong></span>
        <span>任务 <strong className="text-text-primary">{stats.tasks}</strong></span>
        <span>笔记 <strong className="text-text-primary">{stats.notes}</strong></span>
        <span>文件夹 <strong className="text-text-primary">{stats.folders}</strong></span>
        <span className="ml-auto text-xs text-text-muted">{formatSize(stats.totalSize)}</span>
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted bg-bg-secondary rounded-lg px-3 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
        自动同步到 <code className="px-1 bg-bg-card rounded border text-xs">data/</code>
        <span className="text-text-muted mx-1">|</span>
        变更后 1.5s 同步 · 笔记存为 .md
      </div>

      <div className="space-y-1">
        <button onClick={handleExport} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-bg-secondary transition-colors text-left">
          <Download className="w-4 h-4 text-blue-500 shrink-0" />
          <div>
            <div className="text-sm font-medium text-text-primary">导出数据</div>
            <div className="text-xs text-text-muted">备份为 JSON 文件</div>
          </div>
        </button>

        <label className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-bg-secondary transition-colors cursor-pointer text-left">
          <Upload className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
          <div>
            <div className="text-sm font-medium text-text-primary">导入数据</div>
            <div className="text-xs text-text-muted">从备份文件恢复</div>
          </div>
          <input type="file" accept=".json" onChange={handleImport} className="hidden" />
        </label>

        <button
          onClick={handleExportNotes}
          disabled={exportStatus === 'exporting' || allNotes.length === 0}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-bg-secondary transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <FileText className={'w-4 h-4 shrink-0 ' + (exportStatus === 'done' ? 'text-emerald-500 dark:text-emerald-400' : 'text-violet-500')} />
          <div>
            <div className="text-sm font-medium text-text-primary">
              {exportStatus === 'exporting' ? '正在导出...' : exportStatus === 'done' ? '导出完成' : '导出笔记为 Markdown'}
            </div>
            <div className="text-xs text-text-muted">
              {allNotes.length === 0 ? '暂无笔记' : allNotes.length + ' 篇笔记'}
            </div>
          </div>
        </button>
      </div>

      {importStatus !== 'idle' && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className={'flex items-center gap-2 px-3 py-2 rounded-lg text-sm ' + (
            importStatus === 'success'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
          )}
        >
          {importStatus === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {importStatus === 'success' ? '导入成功，页面即将刷新...' : '导入失败：文件格式不正确或数据已损坏'}
        </motion.div>
      )}

      <button onClick={() => setShowClearConfirm(true)} className="flex items-center gap-2 text-xs text-text-muted hover:text-rose-500 dark:hover:text-rose-400 transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
        清空所有数据
      </button>

      <AnimatePresence>
        {showClearConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
            onClick={() => setShowClearConfirm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="rounded-2xl p-6 w-full max-w-sm bg-bg-card"
            >
              <h3 className="text-lg font-bold text-text-primary mb-3">确认清空</h3>
              <p className="text-sm text-text-secondary mb-6">
                此操作将删除所有本地数据（费用、任务、笔记、文件夹），不可恢复。建议先导出备份。
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-2 border rounded-lg text-sm text-text-secondary hover:bg-bg-secondary transition-colors">取消</button>
                <button onClick={handleClear} className="flex-1 py-2 bg-rose-500 text-white rounded-lg text-sm hover:bg-rose-600 transition-colors">确认清空</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile');

  const renderContent = () => {
    switch (activeTab) {
      case 'profile': return <ProfileSettings />;
      case 'notifications': return <NotificationSettings />;
      case 'security': return <SecuritySettings />;
      case 'data': return <DataManager />;
      default: return null;
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <motion.h1
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-3xl font-bold mb-8 text-text-primary"
      >
        设置
      </motion.h1>

      <div className="flex gap-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-64 flex-shrink-0"
        >
          <div className="rounded-2xl p-2 bg-bg-card shadow-sm border border-border-primary">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <tab.icon className="w-5 h-5" />
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex-1 rounded-2xl p-8 bg-bg-card shadow-sm border border-border-primary"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="text-xl font-semibold mb-2 text-text-primary">
                {tabContent[activeTab].title}
              </h2>
              <p className="mb-6 text-text-muted">{tabContent[activeTab].desc}</p>
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
