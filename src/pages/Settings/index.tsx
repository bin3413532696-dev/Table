import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Database, Download, Upload, Trash2, AlertCircle, CheckCircle, Lock, Eye, EyeOff, Check, Sun, Moon, Settings as SettingsIcon, Shield, HardDrive } from 'lucide-react';
import { dataManager, hashPin } from '../../db';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Toggle } from '../../components/ui';

const settingsTabs = [
  { id: 'profile', label: '个人资料', icon: User, desc: '管理您的个人信息' },
  { id: 'security', label: '安全隐私', icon: Shield, desc: '保护账户和数据安全' },
  { id: 'data', label: '数据管理', icon: HardDrive, desc: '导入导出与备份' },
];

const tabContent: Record<string, { title: string; desc: string }> = {
  profile: { title: '个人资料', desc: '管理您的个人信息和账户设置' },
  security: { title: '安全隐私', desc: '保护您的账户和数据安全' },
  data: { title: '数据管理', desc: '浏览数据统计，导入导出备份' },
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
    bio: ''
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
      {/* 头像区域 */}
      <div className="flex items-center gap-4 p-4 rounded-xl bg-bg-secondary border border-border-primary">
        <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg">
          {profile.name.charAt(0)}
        </div>
        <div>
          <h3 className="font-semibold text-text-primary text-lg">{profile.name}</h3>
          <p className="text-sm text-text-muted">个人工作站用户</p>
        </div>
      </div>

      {/* 表单区域 */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2 text-text-secondary">昵称</label>
          <input
            type="text"
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            maxLength={50}
            className="input"
          />
          <p className="text-xs text-text-muted mt-1 text-right">{profile.name.length}/50</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2 text-text-secondary">邮箱</label>
          <input
            type="email"
            value={profile.email}
            onChange={(e) => { setProfile({ ...profile, email: e.target.value }); setEmailError(''); }}
            placeholder="your@email.com"
            className={`input ${emailError ? 'border-error focus:ring-error/20 focus:border-error' : ''}`}
          />
          {emailError && <p className="text-error text-xs mt-1">{emailError}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium mb-2 text-text-secondary">个人简介</label>
          <textarea
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value.slice(0, 200) })}
            placeholder="介绍一下自己..."
            rows={3}
            className="input resize-none"
          />
          <p className="text-xs text-text-muted mt-1 text-right">{profile.bio.length}/200</p>
        </div>
      </div>

      <Button variant="primary" onClick={handleSave} icon={saved ? <Check className="w-4 h-4" /> : undefined}>
        {saved ? '已保存' : '保存设置'}
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
    if (hashedPin) setEnabled(true);
  }, []);

  const handleSavePin = async () => {
    if (pin.length < 4) { setPinError('密码至少需要4位'); return; }
    if (pin !== confirmPin) { setPinError('两次输入的密码不一致'); return; }
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
      {/* 安全提示 */}
      <div className="p-4 rounded-xl bg-warning/10 border border-warning/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-text-primary">本地数据安全</h4>
            <p className="text-sm mt-1 text-text-secondary">所有数据存储在浏览器本地，清除浏览器数据将导致数据丢失。建议定期导出备份。</p>
          </div>
        </div>
      </div>

      {/* 访问密码 */}
      <div className="p-4 rounded-xl bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4" />
          访问密码
        </h4>
        {!enabled ? (
          <div className="space-y-3">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setPinError(''); }}
                placeholder="设置4-6位数字密码"
                className="input pr-10"
              />
              <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPin}
              onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setPinError(''); }}
              placeholder="再次输入密码确认"
              className="input"
            />
            {pinError && <p className="text-error text-xs">{pinError}</p>}
            <Button variant="primary" onClick={handleSavePin}>启用密码保护</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-success flex items-center gap-2">
              <Check className="w-4 h-4" /> 密码保护已启用
            </p>
            <Button variant="secondary" onClick={handleClearPin}>关闭密码保护</Button>
          </div>
        )}
      </div>

      {/* 主题设置 */}
      <div className="p-4 rounded-xl bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-4 flex items-center gap-2">
          {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          外观主题
        </h4>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-text-primary">深色模式</div>
            <div className="text-sm text-text-muted">切换浅色/深色外观</div>
          </div>
          <Toggle checked={theme === 'dark'} onChange={toggleTheme} />
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
      {/* 数据统计 */}
      <div className="grid grid-cols-3 gap-4 p-4 rounded-xl bg-bg-secondary border border-border-primary">
        <div className="text-center">
          <p className="text-2xl font-bold text-text-primary">{stats.finance}</p>
          <p className="text-xs text-text-muted">费用记录</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-text-primary">{stats.tasks}</p>
          <p className="text-xs text-text-muted">任务</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-text-primary">{formatSize(stats.totalSize)}</p>
          <p className="text-xs text-text-muted">数据大小</p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="space-y-2">
        <button onClick={handleExport} className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-bg-secondary border border-border-primary transition-colors text-left group">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <Download className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">导出数据</div>
            <div className="text-xs text-text-muted">备份所有数据和设置</div>
          </div>
        </button>

        <label className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-bg-secondary border border-border-primary transition-colors cursor-pointer text-left group">
          <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center group-hover:bg-success/20 transition-colors">
            <Upload className="w-5 h-5 text-success" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">导入数据</div>
            <div className="text-xs text-text-muted">从备份文件恢复</div>
          </div>
          <input type="file" accept=".json" onChange={handleImport} className="hidden" />
        </label>
      </div>

      {/* 导入状态 */}
      <AnimatePresence>
        {importStatus !== 'idle' && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`flex items-center gap-2 p-3 rounded-lg text-sm ${importStatus === 'success' ? 'bg-success/10 text-success border border-success/20' : 'bg-error/10 text-error border border-error/20'}`}>
            {importStatus === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {importStatus === 'success' ? '导入成功，页面即将刷新...' : '导入失败：文件格式不正确'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 危险操作 */}
      <div className="pt-4 border-t border-border-primary">
        <button onClick={() => setShowClearConfirm(true)} className="text-sm text-text-muted hover:text-error transition-colors flex items-center gap-2">
          <Trash2 className="w-4 h-4" />
          清空所有数据
        </button>
      </div>

      {/* 清空确认弹窗 */}
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowClearConfirm(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="card w-full max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-error" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary">确认清空</h3>
              </div>
              <p className="text-text-secondary mb-5 text-sm">此操作将删除所有数据，不可恢复。建议先导出备份。</p>
              <div className="flex gap-3">
                <button onClick={() => setShowClearConfirm(false)} className="btn btn-secondary btn-md flex-1">取消</button>
                <button onClick={handleClear} className="btn btn-danger btn-md flex-1">确认清空</button>
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
      {/* 页面头部 */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="page-header">
        <div className="page-header-icon">
          <SettingsIcon className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="page-header-title">设置</h1>
          <p className="page-header-subtitle">管理您的个人工作站</p>
        </div>
      </motion.div>

      <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
        {/* 左侧 Tab 栏 */}
        <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="w-full lg:w-56 flex-shrink-0">
          <div className="card p-2 space-y-1">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
                }`}
              >
                <tab.icon className="w-5 h-5" />
                <div>
                  <span className="font-medium text-sm">{tab.label}</span>
                </div>
              </button>
            ))}
          </div>
        </motion.div>

        {/* 右侧内容区 */}
        <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className="flex-1 card">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border-primary">
                {(() => {
                  const tab = settingsTabs.find(t => t.id === activeTab);
                  if (!tab) return null;
                  const Icon = tab.icon;
                  return (
                    <>
                      <div className="w-10 h-10 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-primary dark:text-primary-400" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-text-primary">{tabContent[activeTab].title}</h2>
                        <p className="text-sm text-text-muted">{tabContent[activeTab].desc}</p>
                      </div>
                    </>
                  );
                })()}
              </div>
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}