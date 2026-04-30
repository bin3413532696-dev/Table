import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Database, Download, Upload, Trash2, AlertCircle, CheckCircle, Lock, Eye, EyeOff, Check, Sun, Moon, Settings as SettingsIcon } from 'lucide-react';
import { dataManager, hashPin } from '../../db';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Toggle } from '../../components/ui';

const settingsTabs = [
  { id: 'profile', label: '个人资料', icon: User },
  { id: 'security', label: '安全隐私', icon: Lock },
  { id: 'data', label: '数据管理', icon: Database },
];

const tabContent: Record<string, { title: string; desc: string }> = {
  profile: { title: '个人资料', desc: '管理您的个人信息和账户设置' },
  security: { title: '安全隐私', desc: '保护您的账户和数据安全' },
  data: { title: '数据管理', desc: '浏览数据统计，导入导出备份，自动同步到文件系统' },
};

function isValidEmail(email: string): boolean {
  if (!email) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function ProfileSettings() {
  const [profile, setProfile] = useState({
    name: '个人用户',
    email: '',
    bio: '',
    avatar: ''
  });
  const [saved, setSaved] = useState(false);
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('user_profile');
    if (saved) setProfile(JSON.parse(saved));
  }, []);

  const handleSave = () => {
    if (profile.email && !isValidEmail(profile.email)) {
      setEmailError('请输入有效的邮箱地址');
      return;
    }
    setEmailError('');
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
            maxLength={50}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-text-secondary">邮箱</label>
          <input
            type="email"
            value={profile.email}
            onChange={(e) => { setProfile({ ...profile, email: e.target.value }); setEmailError(''); }}
            placeholder="your@email.com"
            className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card text-text-primary ${emailError ? 'border-rose-500' : 'border-border-primary'}`}
          />
          {emailError && <p className="text-rose-500 text-xs mt-1">{emailError}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-text-secondary">个人简介</label>
          <textarea
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value.slice(0, 200) })}
            placeholder="介绍一下自己..."
            rows={3}
            maxLength={200}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none bg-bg-card border-border-primary text-text-primary"
          />
          <p className="text-xs text-text-muted text-right mt-1">{profile.bio.length}/200</p>
        </div>
      </div>

      <Button variant="primary" onClick={handleSave} icon={saved ? <Check className="w-4 h-4" /> : undefined}>
        保存设置
      </Button>
    </div>
  );
}

function SecuritySettings() {
  const [showPassword, setShowPassword] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [pinError, setPinError] = useState('');
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const hashedPin = localStorage.getItem('security_pin_hashed');
    if (hashedPin) {
      setEnabled(true);
    }
  }, []);

  const handleSavePin = async () => {
    if (pin.length < 4) {
      setPinError('密码至少需要4位');
      return;
    }
    if (pin !== confirmPin) {
      setPinError('两次输入的密码不一致');
      return;
    }
    setPinError('');
    const hashedPin = await hashPin(pin);
    localStorage.setItem('security_pin_hashed', hashedPin);
    setEnabled(true);
    setPin('');
    setConfirmPin('');
  };

  const handleClearPin = () => {
    localStorage.removeItem('security_pin_hashed');
    setPin('');
    setConfirmPin('');
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
        {!enabled ? (
          <div className="space-y-3">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setPinError(''); }}
                placeholder="设置4-6位数字密码"
                className="w-full px-4 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPin}
              onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setPinError(''); }}
              placeholder="再次输入密码确认"
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
            />
            {pinError && <p className="text-rose-500 text-xs">{pinError}</p>}
            <Button variant="primary" onClick={handleSavePin}>启用密码保护</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-emerald-500 dark:text-emerald-400 flex items-center gap-2">
              <Check className="w-4 h-4" /> 密码保护已启用
            </p>
            <Button variant="secondary" onClick={handleClearPin}>关闭密码保护</Button>
          </div>
        )}
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
          <Toggle
            checked={theme === 'dark'}
            onChange={toggleTheme}
          />
        </div>
      </div>
    </div>
  );
}

function DataManager() {
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const stats = dataManager.getStats();

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
        <span className="ml-auto text-xs text-text-muted">{formatSize(stats.totalSize)}</span>
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted bg-bg-secondary rounded-lg px-3 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
        导出备份包含：业务数据、用户资料、主题设置
      </div>

      <div className="space-y-1">
        <button onClick={handleExport} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-bg-secondary transition-colors text-left">
          <Download className="w-4 h-4 text-blue-500 shrink-0" />
          <div>
            <div className="text-sm font-medium text-text-primary">导出数据</div>
            <div className="text-xs text-text-muted">备份所有数据和设置</div>
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
                此操作将删除所有数据（费用、任务、用户资料、设置），不可恢复。建议先导出备份。
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
      case 'security': return <SecuritySettings />;
      case 'data': return <DataManager />;
      default: return null;
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-6 md:mb-8"
      >
        <div className="w-10 h-10 bg-gray-900 dark:bg-gray-700 rounded-lg flex items-center justify-center">
          <SettingsIcon className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-xl md:text-2xl font-bold text-text-primary">设置</h1>
      </motion.div>

      <div className="flex flex-col lg:flex-row gap-4 md:gap-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full lg:w-64 flex-shrink-0"
        >
          <div className="rounded-xl md:rounded-2xl p-2 bg-bg-card shadow-sm border border-border-primary">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-primary text-white shadow-md'
                    : 'text-text-secondary hover:bg-bg-secondary'
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
          className="flex-1 rounded-xl md:rounded-2xl p-4 md:p-8 bg-bg-card shadow-sm border border-border-primary"
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