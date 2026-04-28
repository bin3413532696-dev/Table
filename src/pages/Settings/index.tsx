import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Bell, Shield, Database, Download, Upload, Trash2, AlertCircle, CheckCircle, FileText, Lock, Eye, EyeOff, Mail, MessageSquare, Calendar, Check } from 'lucide-react';
import { dataManager, noteDB, folderDB, Note, Folder } from '../../db';

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
          <h3 className="font-semibold text-gray-900">{profile.name}</h3>
          <p className="text-sm text-gray-500">个人工作站用户</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">昵称</label>
          <input
            type="text"
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white border-gray-200 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">邮箱</label>
          <input
            type="email"
            value={profile.email}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            placeholder="your@email.com"
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white border-gray-200 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">个人简介</label>
          <textarea
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="介绍一下自己..."
            rows={3}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none bg-white border-gray-200 text-gray-900"
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
        <div key={item.key} className="flex items-center justify-between p-4 rounded-xl bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-white">
              <item.icon className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <div className="font-medium text-gray-900">{item.label}</div>
              <div className="text-sm text-gray-500">{item.desc}</div>
            </div>
          </div>
          <button
            onClick={() => toggle(item.key as keyof typeof settings)}
            className={`w-12 h-6 rounded-full transition-colors ${settings[item.key as keyof typeof settings] ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${settings[item.key as keyof typeof settings] ? 'translate-x-6' : 'translate-x-0.5'} mt-0.5`} />
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
      <div className="p-4 border rounded-xl bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 text-amber-600" />
          <div>
            <h4 className="font-medium text-amber-900">本地数据安全</h4>
            <p className="text-sm mt-1 text-amber-700">
              所有数据存储在浏览器本地，清除浏览器数据将导致数据丢失。建议定期导出备份。
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="font-medium text-gray-900">访问密码</h4>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="设置4位数字密码"
              maxLength={6}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white border-gray-200 text-gray-900"
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
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
              className="px-4 py-2 border rounded-lg transition-colors border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              关闭
            </button>
          )}
        </div>
        {enabled && <p className="text-sm text-emerald-500">密码保护已启用</p>}
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
      <div className="flex items-center gap-6 text-sm text-gray-600">
        <span>费用记录 <strong className="text-gray-900">{stats.finance}</strong></span>
        <span>任务 <strong className="text-gray-900">{stats.tasks}</strong></span>
        <span>笔记 <strong className="text-gray-900">{stats.notes}</strong></span>
        <span>文件夹 <strong className="text-gray-900">{stats.folders}</strong></span>
        <span className="ml-auto text-xs text-gray-400">{formatSize(stats.totalSize)}</span>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
        自动同步到 <code className="px-1 bg-white rounded border text-xs">data/</code>
        <span className="text-gray-300 mx-1">|</span>
        变更后 1.5s 同步 · 笔记存为 .md
      </div>

      <div className="space-y-1">
        <button onClick={handleExport} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left">
          <Download className="w-4 h-4 text-blue-500 shrink-0" />
          <div>
            <div className="text-sm font-medium text-gray-900">导出数据</div>
            <div className="text-xs text-gray-500">备份为 JSON 文件</div>
          </div>
        </button>

        <label className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer text-left">
          <Upload className="w-4 h-4 text-emerald-500 shrink-0" />
          <div>
            <div className="text-sm font-medium text-gray-900">导入数据</div>
            <div className="text-xs text-gray-500">从备份文件恢复</div>
          </div>
          <input type="file" accept=".json" onChange={handleImport} className="hidden" />
        </label>

        <button
          onClick={handleExportNotes}
          disabled={exportStatus === 'exporting' || allNotes.length === 0}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <FileText className={'w-4 h-4 shrink-0 ' + (exportStatus === 'done' ? 'text-emerald-500' : 'text-violet-500')} />
          <div>
            <div className="text-sm font-medium text-gray-900">
              {exportStatus === 'exporting' ? '正在导出...' : exportStatus === 'done' ? '导出完成' : '导出笔记为 Markdown'}
            </div>
            <div className="text-xs text-gray-500">
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
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-rose-50 text-rose-700'
          )}
        >
          {importStatus === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {importStatus === 'success' ? '导入成功，页面即将刷新...' : '导入失败：文件格式不正确或数据已损坏'}
        </motion.div>
      )}

      <button onClick={() => setShowClearConfirm(true)} className="flex items-center gap-2 text-xs text-gray-400 hover:text-rose-500 transition-colors">
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
              className="rounded-2xl p-6 w-full max-w-sm bg-white"
            >
              <h3 className="text-lg font-bold text-gray-900 mb-3">确认清空</h3>
              <p className="text-sm text-gray-600 mb-6">
                此操作将删除所有本地数据（费用、任务、笔记、文件夹），不可恢复。建议先导出备份。
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors">取消</button>
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
        className="text-3xl font-bold mb-8 text-slate-800"
      >
        设置
      </motion.h1>

      <div className="flex gap-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-64 flex-shrink-0"
        >
          <div className="rounded-2xl p-2 bg-white shadow-sm border border-slate-200">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'text-slate-600 hover:bg-slate-50'
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
          className="flex-1 rounded-2xl p-8 bg-white shadow-sm border border-slate-200"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="text-xl font-semibold mb-2 text-slate-800">
                {tabContent[activeTab].title}
              </h2>
              <p className="mb-6 text-slate-500">{tabContent[activeTab].desc}</p>
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
