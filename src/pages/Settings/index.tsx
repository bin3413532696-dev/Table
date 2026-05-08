import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Database, Download, Upload, Trash2, AlertCircle, CheckCircle, Lock, Eye, EyeOff, Check, Sun, Moon, Settings as SettingsIcon, Shield, HardDrive, Plus, Edit2, Trash2 as TrashIcon, Globe, ChevronDown, ChevronUp, Power } from 'lucide-react';
import { dataManager, financeDB, taskDB } from '../../db';
import { initializeData } from '../../lib/dataSync';
import { useTheme } from '../../contexts/ThemeContext';
import { useCurrentUser } from '../../contexts/UserContext';
import { Button, Toggle } from '../../components/ui';
import {
  activateApiConfig,
  ApiProvider,
  deleteApiConfig,
  ensureBootstrappedApiConfig,
  getApiConfigs,
  refreshApiConfigs,
  saveApiConfigs,
} from '../../lib/apiConfig';
import {
  clearAuthSession,
  clearPinApi,
  createAuthUser,
  DEFAULT_USER_ID,
  fetchAuthUsers,
  fetchPinStatus,
  setCurrentUserId,
  setPinApi,
  switchAuthSession,
  updateAuthMe,
} from '../../lib/auth';
import { registeredToolNames } from '../../agent/toolMetadata';
import { MESSAGES } from '../../core/messages';

const settingsTabs = [
  { id: 'profile', label: '个人资料', icon: User, desc: '管理您的个人信息' },
  { id: 'security', label: '安全隐私', icon: Shield, desc: '保护账户和数据安全' },
  { id: 'data', label: '数据管理', icon: HardDrive, desc: '导入导出与备份' },
  { id: 'api', label: '智能体配置', icon: Globe, desc: '管理智能体 Provider 与工具' },
];

const tabContent: Record<string, { title: string; desc: string }> = {
  profile: { title: '个人资料', desc: '管理您的个人信息和账户设置' },
  security: { title: '安全隐私', desc: '保护您的账户和数据安全' },
  data: { title: '数据管理', desc: '浏览数据统计，导入导出备份' },
  api: { title: '智能体配置', desc: '管理智能体 Provider 与可用工具' },
};

type ApiConfig = ApiProvider;

function isValidEmail(email: string): boolean {
  if (!email) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ProfileSettings() {
  const { user, auth, reload } = useCurrentUser();
  const [profile, setProfile] = useState({
    name: '个人用户',
    email: '',
    bio: ''
  });
  const [saved, setSaved] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [devUserId, setDevUserId] = useState(DEFAULT_USER_ID);
  const [switchingUser, setSwitchingUser] = useState(false);
  const [userSwitchError, setUserSwitchError] = useState('');
  const [userSwitchSaved, setUserSwitchSaved] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<Array<{
    id: string;
    displayName: string;
    email: string | null;
    bio: string;
    isCurrentUser: boolean;
  }>>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState('');
  const [createUserSaved, setCreateUserSaved] = useState(false);
  const [newUser, setNewUser] = useState({
    displayName: '',
    email: '',
    bio: '',
  });

  useEffect(() => {
    if (!user) {
      return;
    }

    setProfile({
      name: user.displayName || '个人用户',
      email: user.email || '',
      bio: user.bio || '',
    });
  }, [user]);

  useEffect(() => {
    setDevUserId(user?.id || DEFAULT_USER_ID);
  }, [user?.id]);

  useEffect(() => {
    let disposed = false;

    const loadUsers = async () => {
      setLoadingUsers(true);
      try {
        const result = await fetchAuthUsers();
        if (!disposed) {
          setAvailableUsers(result.data.items);
        }
      } catch (error) {
        console.warn('[Settings] Failed to load auth users:', error);
      } finally {
        if (!disposed) {
          setLoadingUsers(false);
        }
      }
    };

    void loadUsers();
    return () => {
      disposed = true;
    };
  }, [user?.id]);

  const reloadUsers = async () => {
    const result = await fetchAuthUsers();
    setAvailableUsers(result.data.items);
  };

  const handleSave = async () => {
    if (profile.email && !isValidEmail(profile.email)) {
      setEmailError('请输入有效的邮箱地址');
      return;
    }

    setEmailError('');
    try {
      await updateAuthMe({
        displayName: profile.name.trim(),
        email: profile.email.trim() || null,
        bio: profile.bio.trim(),
      });

      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : MESSAGES.settings.saveProfileFailed);
    }
  };

  const refreshUserScopedData = async () => {
    await Promise.all([
      financeDB.getAll(),
      taskDB.getAll(),
    ]);
    await initializeData();
  };

  const handleSwitchUser = async (nextUserId: string) => {
    const normalized = nextUserId.trim();
    if (!isValidUuid(normalized)) {
      setUserSwitchError('请输入合法的 UUID');
      return;
    }

    setSwitchingUser(true);
    setUserSwitchError('');

    try {
      await switchAuthSession(normalized);
      setCurrentUserId(normalized);
      await reload();
      await refreshUserScopedData();
      await reloadUsers();
      setUserSwitchSaved(true);
      setTimeout(() => setUserSwitchSaved(false), 2000);
    } catch (error) {
      setCurrentUserId(user?.id || DEFAULT_USER_ID);
      setUserSwitchError(error instanceof Error ? error.message : MESSAGES.settings.switchUserFailed);
    } finally {
      setSwitchingUser(false);
    }
  };

  const handleResetDefaultUser = async () => {
    setSwitchingUser(true);
    setUserSwitchError('');

    try {
      await clearAuthSession();
      setDevUserId(DEFAULT_USER_ID);
      setCurrentUserId(DEFAULT_USER_ID);
      await reload();
      await refreshUserScopedData();
      await reloadUsers();
      setUserSwitchSaved(true);
      setTimeout(() => setUserSwitchSaved(false), 2000);
    } catch (error) {
      setUserSwitchError(error instanceof Error ? error.message : MESSAGES.settings.restoreDefaultUserFailed);
    } finally {
      setSwitchingUser(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.displayName.trim()) {
      setCreateUserError('请输入用户名称');
      return;
    }

    if (newUser.email && !isValidEmail(newUser.email)) {
      setCreateUserError('请输入有效的邮箱地址');
      return;
    }

    setCreatingUser(true);
    setCreateUserError('');

    try {
      const result = await createAuthUser({
        displayName: newUser.displayName.trim(),
        email: newUser.email.trim() || null,
        bio: newUser.bio.trim(),
      });

      await reloadUsers();
      setDevUserId(result.data.user.id);
      setNewUser({
        displayName: '',
        email: '',
        bio: '',
      });
      setCreateUserSaved(true);
      setTimeout(() => setCreateUserSaved(false), 2000);
    } catch (error) {
      setCreateUserError(error instanceof Error ? error.message : MESSAGES.settings.createUserFailed);
    } finally {
      setCreatingUser(false);
    }
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
          <p className="text-sm text-text-muted">{auth?.isDefaultUser ? '默认本地用户' : '认证用户'}</p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-4">
        <div>
          <h4 className="font-medium text-text-primary">开发期用户切换</h4>
          <p className="text-sm mt-1 text-text-secondary">用于验证多用户隔离链路。现在需要先创建用户，再切换到已有用户。</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-2 text-text-secondary">用户 ID</label>
            <input
              type="text"
              value={devUserId}
              onChange={(e) => {
                setDevUserId(e.target.value);
                setUserSwitchError('');
              }}
              placeholder={DEFAULT_USER_ID}
              className={`input ${userSwitchError ? 'border-error focus:ring-error/20 focus:border-error' : ''}`}
            />
            <p className="text-xs text-text-muted mt-1">当前用户来源：{auth?.source === 'header' ? '自定义用户' : '默认用户'}</p>
            {userSwitchError && <p className="text-error text-xs mt-1">{userSwitchError}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-text-secondary">已有用户</label>
            <select
              value={devUserId}
              onChange={(e) => {
                setDevUserId(e.target.value);
                setUserSwitchError('');
              }}
              className="input"
              disabled={loadingUsers || switchingUser}
            >
              <option value={DEFAULT_USER_ID}>默认本地用户</option>
              {availableUsers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName} {item.isCurrentUser ? '(当前)' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-muted mt-1">
              {loadingUsers ? '正在读取用户列表...' : `当前可选 ${availableUsers.length} 个活动用户`}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => void handleSwitchUser(devUserId)} disabled={switchingUser}>
              {switchingUser ? '切换中...' : userSwitchSaved ? '已切换' : '切换用户'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleResetDefaultUser()}
              disabled={switchingUser}
            >
              恢复默认用户
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-bg-secondary border border-border-primary space-y-4">
        <div>
          <h4 className="font-medium text-text-primary">创建开发期用户</h4>
          <p className="text-sm mt-1 text-text-secondary">显式创建用户及其基线数据，避免再通过任意 UUID 隐式建号。</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-text-secondary">用户名称</label>
            <input
              type="text"
              value={newUser.displayName}
              onChange={(e) => {
                setNewUser({ ...newUser, displayName: e.target.value });
                setCreateUserError('');
              }}
              className="input"
              placeholder="例如：项目成员 A"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-text-secondary">邮箱</label>
            <input
              type="email"
              value={newUser.email}
              onChange={(e) => {
                setNewUser({ ...newUser, email: e.target.value });
                setCreateUserError('');
              }}
              className="input"
              placeholder="可选"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2 text-text-secondary">简介</label>
          <textarea
            value={newUser.bio}
            onChange={(e) => {
              setNewUser({ ...newUser, bio: e.target.value.slice(0, 200) });
              setCreateUserError('');
            }}
            rows={3}
            className="input resize-none"
            placeholder="可选"
          />
        </div>
        {createUserError && <p className="text-error text-xs">{createUserError}</p>}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => void handleCreateUser()} disabled={creatingUser}>
            {creatingUser ? '创建中...' : createUserSaved ? '已创建' : '创建用户'}
          </Button>
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

      <Button variant="primary" onClick={() => void handleSave()} icon={saved ? <Check className="w-4 h-4" /> : undefined}>
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
    fetchPinStatus()
      .then((status) => setEnabled(status.enabled))
      .catch(() => setEnabled(false));
  }, []);

  const handleSavePin = async () => {
    if (pin.length < 4) { setPinError('密码至少需要4位'); return; }
    if (pin !== confirmPin) { setPinError('两次输入的密码不一致'); return; }
    setPinError('');
    try {
      await setPinApi(pin);
      setEnabled(true);
      setPin('');
      setConfirmPin('');
    } catch (error) {
      setPinError(error instanceof Error ? error.message : '设置失败');
    }
  };

  const handleClearPin = async () => {
    try {
      await clearPinApi();
      setPin('');
      setConfirmPin('');
      setEnabled(false);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      {/* 安全提示 */}
      <div className="p-4 rounded-xl bg-warning/10 border border-warning/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-text-primary">本地设置安全</h4>
            <p className="text-sm mt-1 text-text-secondary">业务数据与知识库以服务端为准，当前浏览器仍会保存主题、PIN 等本地设置。清除浏览器数据会丢失这些设置，建议按需导出备份。</p>
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
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: '',
  });
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearMode, setClearMode] = useState<'all' | 'knowledge' | 'local' | null>(null);
  const [stats, setStats] = useState({
    finance: 0,
    tasks: 0,
    knowledgeNotes: 0,
    knowledgePresetTags: 0,
    totalSize: 0,
  });

  useEffect(() => {
    dataManager.getStats().then(setStats);
  }, []);

  const showStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => {
      setStatus({ type: 'idle', message: '' });
    }, 3000);
  };

  const downloadJson = (filename: string, data: string) => {
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportBusiness = async () => {
    const data = await dataManager.exportBusinessData();
    downloadJson(`business_backup_${new Date().toISOString().split('T')[0]}.json`, data);
  };

  const handleExportKnowledge = async () => {
    const data = await dataManager.exportKnowledgeData();
    downloadJson(`knowledge_backup_${new Date().toISOString().split('T')[0]}.json`, data);
  };

  const handleExportLocalSettings = async () => {
    const data = await dataManager.exportLocalSettings();
    downloadJson(`local_settings_${new Date().toISOString().split('T')[0]}.json`, data);
  };

  const createImportHandler = (
    importer: (content: string) => Promise<boolean>,
    successMessage: string
  ) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const success = await importer(content);
      if (success) {
        showStatus('success', successMessage);
        setTimeout(() => window.location.reload(), 1200);
      } else {
        showStatus('error', MESSAGES.settings.importFailed);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClear = async () => {
    try {
      if (clearMode === 'all') {
        await dataManager.clearAll();
      } else if (clearMode === 'knowledge') {
        await dataManager.clearKnowledgeData();
      } else if (clearMode === 'local') {
        dataManager.clearLocalSettings();
      }
      setShowClearConfirm(false);
      window.location.reload();
    } catch {
      setShowClearConfirm(false);
      showStatus('error', MESSAGES.settings.clearFailed);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <div className="space-y-5">
      {/* 数据统计 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-xl bg-bg-secondary border border-border-primary">
        <div className="text-center">
          <p className="text-2xl font-bold text-text-primary">{stats.finance}</p>
          <p className="text-xs text-text-muted">费用记录</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-text-primary">{stats.tasks}</p>
          <p className="text-xs text-text-muted">任务</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-text-primary">{stats.knowledgeNotes}</p>
          <p className="text-xs text-text-muted">知识笔记</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-text-primary">{stats.knowledgePresetTags}</p>
          <p className="text-xs text-text-muted">预设标签</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-text-primary">{formatSize(stats.totalSize)}</p>
          <p className="text-xs text-text-muted">数据大小</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold text-text-primary">业务数据（PostgreSQL）</div>
        <button onClick={handleExportBusiness} className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-bg-secondary border border-border-primary transition-colors text-left group">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <Download className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">导出业务数据</div>
            <div className="text-xs text-text-muted">导出服务端任务与财务快照</div>
          </div>
        </button>

        <label className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-bg-secondary border border-border-primary transition-colors cursor-pointer text-left group">
          <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center group-hover:bg-success/20 transition-colors">
            <Upload className="w-5 h-5 text-success" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">导入业务数据</div>
            <div className="text-xs text-text-muted">覆盖 PostgreSQL 中的任务与财务测试数据</div>
          </div>
          <input type="file" accept=".json" onChange={createImportHandler(dataManager.importBusinessData, MESSAGES.settings.importBusinessSuccess)} className="hidden" />
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold text-text-primary">知识库数据（服务端权威）</div>
        <button onClick={handleExportKnowledge} className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-bg-secondary border border-border-primary transition-colors text-left group">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <Download className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">导出知识库</div>
            <div className="text-xs text-text-muted">导出服务端知识笔记与预设标签概览</div>
          </div>
        </button>

        <label className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-bg-secondary border border-border-primary transition-colors cursor-pointer text-left group">
          <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center group-hover:bg-success/20 transition-colors">
            <Upload className="w-5 h-5 text-success" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">导入知识库</div>
            <div className="text-xs text-text-muted">覆盖当前知识库并同步到服务端知识库</div>
          </div>
          <input type="file" accept=".json" onChange={createImportHandler(dataManager.importKnowledgeData, MESSAGES.settings.importKnowledgeSuccess)} className="hidden" />
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold text-text-primary">本地设置（浏览器缓存）</div>
        <button onClick={handleExportLocalSettings} className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-bg-secondary border border-border-primary transition-colors text-left group">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <Download className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">导出本地设置</div>
            <div className="text-xs text-text-muted">导出个人资料、主题、通知和 PIN 缓存</div>
          </div>
        </button>

        <label className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-bg-secondary border border-border-primary transition-colors cursor-pointer text-left group">
          <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center group-hover:bg-success/20 transition-colors">
            <Upload className="w-5 h-5 text-success" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">导入本地设置</div>
            <div className="text-xs text-text-muted">仅恢复当前浏览器的本地设置项</div>
          </div>
          <input type="file" accept=".json" onChange={createImportHandler(dataManager.importLocalSettings, MESSAGES.settings.importSettingsSuccess)} className="hidden" />
        </label>
      </div>

      <AnimatePresence>
        {status.type !== 'idle' && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`flex items-center gap-2 p-3 rounded-lg text-sm ${status.type === 'success' ? 'bg-success/10 text-success border border-success/20' : 'bg-error/10 text-error border border-error/20'}`}>
            {status.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {status.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 危险操作 */}
      <div className="pt-4 border-t border-border-primary space-y-2">
        <button onClick={() => { setClearMode('all'); setShowClearConfirm(true); }} className="text-sm text-text-muted hover:text-error transition-colors flex items-center gap-2">
          <Trash2 className="w-4 h-4" />
          重置业务数据并清空本地缓存
        </button>
        <button onClick={() => { setClearMode('knowledge'); setShowClearConfirm(true); }} className="text-sm text-text-muted hover:text-error transition-colors flex items-center gap-2">
          <Trash2 className="w-4 h-4" />
          清空知识库
        </button>
        <button onClick={() => { setClearMode('local'); setShowClearConfirm(true); }} className="text-sm text-text-muted hover:text-error transition-colors flex items-center gap-2">
          <Trash2 className="w-4 h-4" />
          清空本地设置
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
              <p className="text-text-secondary mb-5 text-sm">
                {clearMode === 'all' && '此操作会重置 PostgreSQL 中的任务与财务测试数据，清空服务端知识库，并清空当前浏览器的设置缓存。'}
                {clearMode === 'knowledge' && '此操作会清空当前知识库，并同步覆盖服务端知识数据。'}
                {clearMode === 'local' && '此操作会清空当前浏览器中的个人资料、主题、通知和 PIN 设置。'}
              </p>
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

function ApiConfigSettings() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<{ name: string; label: string }[]>([]);
  const [fetchModelsError, setFetchModelsError] = useState('');
  const [providerError, setProviderError] = useState('');
  const [formData, setFormData] = useState<{
    name: string;
    apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
    baseUrl: string;
    apiKey: string;
    model: string;
    headers: string;
  }>({
    name: '',
    apiFormat: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    headers: '',
  });
  const [editingApiKeyPreview, setEditingApiKeyPreview] = useState('');

  const apiFormats = [
    { value: 'openai', label: 'OpenAI Chat Completions' },
    { value: 'anthropic', label: 'Anthropic Messages' },
    { value: 'gemini', label: 'Gemini Native generateContent' },
    { value: 'custom', label: '自定义 API' },
  ];

  const defaultModelsByFormat: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-3-5-sonnet-20241022',
    gemini: 'gemini-1.5-pro',
    custom: '',
  };

  const getDefaultBaseUrl = (format: string) => {
    switch (format) {
      case 'openai': return 'https://api.openai.com/v1';
      case 'anthropic': return 'https://api.anthropic.com/v1';
      case 'gemini': return 'https://generativelanguage.googleapis.com/v1';
      default: return '';
    }
  };

  const fetchModels = async () => {
    setFetchingModels(true);
    setFetchModelsError('');
    
    try {
      const { baseUrl, apiKey, apiFormat } = formData;
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const endpoints = ['/models', '/v1/models', '/api/models'];
      
      for (const endpoint of endpoints) {
        try {
          const fullUrl = new URL(endpoint, baseUrl).href;
          const response = await fetch(fullUrl, { headers });
          
          if (response.ok) {
            const data = await response.json();
            const models = parseModels(data, apiFormat);
            
            if (models.length > 0) {
              setFetchedModels(models);
              setFetchingModels(false);
              return;
            }
          }
        } catch { continue; }
      }
      
      setFetchModelsError('无法获取模型列表，请手动配置模型名称');
    } catch (error) {
      setFetchModelsError(error instanceof Error ? error.message : MESSAGES.settings.fetchModelsFailed);
    } finally {
      setFetchingModels(false);
    }
  };
  
  const parseModels = (data: unknown, apiFormat: string): { name: string; label: string }[] => {
    if (typeof data !== 'object' || data === null) return [];
    const obj = data as Record<string, unknown>;
    
    if (apiFormat === 'openai' || apiFormat === 'custom') {
      const dataArray = obj.data as { id: string; name?: string }[] || [];
      return dataArray.map(m => ({ name: m.id, label: m.name || m.id }));
    } else if (apiFormat === 'gemini') {
      const modelsArray = obj.models as { name: string; displayName?: string }[] || [];
      return modelsArray.map(m => ({
        name: m.name.replace('models/', ''),
        label: m.displayName || m.name.replace('models/', ''),
      }));
    }
    return [];
  };

  useEffect(() => {
    let disposed = false;

    const loadProviders = async () => {
      setLoadingProviders(true);
      setProviderError('');
      try {
        await ensureBootstrappedApiConfig();
        if (!disposed) {
          setProviders(getApiConfigs());
        }
      } catch (error) {
        if (!disposed) {
          setProviderError(error instanceof Error ? error.message : MESSAGES.settings.loadProviderFailed);
        }
      } finally {
        if (!disposed) {
          setLoadingProviders(false);
        }
      }
    };

    void loadProviders();

    return () => {
      disposed = true;
    };
  }, []);

  const handleAdd = () => {
    setEditingProvider(null);
    setEditingApiKeyPreview('');
    setFormData({
      name: '',
      apiFormat: 'openai',
      baseUrl: getDefaultBaseUrl('openai'),
      apiKey: '',
      model: defaultModelsByFormat['openai'],
      headers: '',
    });
    setFetchedModels([]);
    setFetchModelsError('');
    setShowForm(true);
  };

  const handleEdit = (provider: ApiProvider) => {
    setEditingProvider(provider);
    setEditingApiKeyPreview(provider.apiKeyPreview || (provider.hasApiKey ? '已配置 API Key' : ''));
    setFormData({
      name: provider.name,
      apiFormat: provider.apiFormat,
      baseUrl: provider.baseUrl,
      apiKey: '',
      model: provider.model || '',
      headers: provider.headers ? JSON.stringify(provider.headers, null, 2) : '',
    });
    setFetchedModels([]);
    setFetchModelsError('');
    setShowForm(true);
  };

  const handleApiFormatChange = (format: string) => {
    setFormData(prev => ({
      ...prev,
      apiFormat: format as ApiProvider['apiFormat'],
      baseUrl: getDefaultBaseUrl(format),
      model: defaultModelsByFormat[format] || '',
    }));
  };

  const handleActivate = async (id: string) => {
    setProviderError('');
    try {
      const nextProviders = await activateApiConfig(id);
      setProviders(nextProviders);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : MESSAGES.settings.activateProviderFailed);
    }
  };

  const handleDelete = async (id: string) => {
    setProviderError('');
    try {
      const nextProviders = await deleteApiConfig(id);
      setProviders(nextProviders);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : MESSAGES.settings.deleteProviderFailed);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.baseUrl) {
      alert('请填写名称和基础URL');
      return;
    }

    let headers: Record<string, string> | undefined;
    if (formData.headers) {
      try {
        headers = JSON.parse(formData.headers);
      } catch {
        alert('headers 格式不正确，应为 JSON');
        return;
      }
    }

    const newProvider: ApiProvider = {
      id: editingProvider?.id || crypto.randomUUID(),
      name: formData.name,
      isActive: editingProvider?.isActive ?? (providers.length === 0),
      apiFormat: formData.apiFormat,
      baseUrl: formData.baseUrl,
      apiKey: formData.apiKey,
      hasApiKey: editingProvider?.hasApiKey,
      apiKeyPreview: editingProvider?.apiKeyPreview,
      model: formData.model,
      headers,
    };

    try {
      const newProviders: ApiProvider[] = editingProvider
        ? providers.map((p) => (p.id === editingProvider.id ? newProvider : p))
        : [...providers, newProvider];

      await saveApiConfigs(newProviders);
      const latestProviders = await refreshApiConfigs();
      setProviders(latestProviders);
      setProviderError('');
      setShowForm(false);
      setEditingProvider(null);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : MESSAGES.settings.saveProviderFailed);
    }
  };

  const activeProvider = providers.find(p => p.isActive);

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
        <div className="flex items-start gap-3">
          <Globe className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-text-primary">Provider 配置</h4>
            <p className="text-sm mt-1 text-text-secondary">配置 AI Provider，激活的 Provider 将被智能体使用。</p>
          </div>
        </div>
      </div>

      {providerError && (
        <div className="p-4 rounded-xl bg-error/10 border border-error/20 text-sm text-error">
          {providerError}
        </div>
      )}

      {activeProvider && (
        <div className="p-4 rounded-xl bg-success/10 border border-success/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
              <Power className="w-5 h-5 text-success" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-text-primary">{activeProvider.name}</h4>
                <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">已激活</span>
              </div>
              <p className="text-sm text-text-muted">{activeProvider.baseUrl}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleEdit(activeProvider)}
                className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          {activeProvider.model && (
            <div className="mt-3">
              <span className="text-xs px-2 py-1 rounded-full bg-bg-secondary text-text-secondary">
                模型: {activeProvider.model}
              </span>
            </div>
          )}
        </div>
      )}

      <Button variant="primary" onClick={handleAdd} icon={<Plus className="w-4 h-4" />}>
        添加 Provider
      </Button>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="p-4 rounded-xl bg-bg-secondary border border-border-primary">
            <h4 className="font-medium text-text-primary mb-4">{editingProvider ? '编辑 Provider' : '添加 Provider'}</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-text-secondary">Provider 名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如：OpenAI、Claude、Gemini"
                  className="input"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-text-secondary">API 格式</label>
                <select
                  value={formData.apiFormat}
                  onChange={(e) => handleApiFormatChange(e.target.value)}
                  className="input"
                >
                  {apiFormats.map(format => (
                    <option key={format.value} value={format.value}>{format.label}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-text-secondary">Base URL *</label>
                <input
                  type="text"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="input"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-text-secondary">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    placeholder={editingProvider?.hasApiKey ? '留空则保留当前密钥，输入则覆盖' : '输入 API Key'}
                    className="input pr-10"
                  />
                  <button onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {editingProvider?.hasApiKey && !formData.apiKey && (
                  <p className="text-xs text-text-muted mt-1">当前已配置密钥：{editingApiKeyPreview || '已隐藏'}</p>
                )}
              </div>

              {formData.baseUrl && formData.apiKey && (
                <div>
                  <Button variant="secondary" onClick={() => void fetchModels()} disabled={fetchingModels} className="w-full">
                    {fetchingModels ? '获取中...' : '获取模型列表'}
                  </Button>
                  {fetchModelsError && <p className="text-error text-sm mt-2">{fetchModelsError}</p>}
                  {fetchedModels.length > 0 && <p className="text-success text-sm mt-2">已获取 {fetchedModels.length} 个模型</p>}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2 text-text-secondary">模型</label>
                <select
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="input mb-2"
                >
                  <option value="">请选择模型（或手动输入）</option>
                  {(fetchedModels.length > 0 ? fetchedModels : [{ name: defaultModelsByFormat[formData.apiFormat], label: defaultModelsByFormat[formData.apiFormat] || '默认模型' }]).map(m => (
                    m.name && <option key={m.name} value={m.name}>{m.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  placeholder="或直接输入模型名称"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-text-secondary">自定义 Headers (JSON)</label>
                <textarea
                  value={formData.headers}
                  onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                  placeholder='{"X-Custom-Header": "value"}'
                  rows={2}
                  className="input resize-none font-mono text-sm"
                />
              </div>

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setShowForm(false)}>取消</Button>
                <Button variant="primary" onClick={() => void handleSave()}>保存</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-3">
        {loadingProviders ? (
          <div className="text-center py-12 text-text-muted">
            <p>正在加载 Provider 配置...</p>
          </div>
        ) : providers.length === 0 ? (
          <div className="text-center py-12 text-text-muted">
            <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>暂无 Provider 配置</p>
            <p className="text-sm mt-1">点击上方按钮添加第一个 Provider</p>
          </div>
        ) : (
          providers.map((provider) => (
            <motion.div key={provider.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="rounded-xl bg-bg-secondary border border-border-primary overflow-hidden">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${provider.isActive ? 'bg-success/20' : 'bg-bg-hover'}`}>
                    <Globe className={`w-5 h-5 ${provider.isActive ? 'text-success' : 'text-text-muted'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-text-primary">{provider.name}</h4>
                      {provider.isActive && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">激活</span>
                      )}
                    </div>
                    <p className="text-sm text-text-muted">{provider.baseUrl}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!provider.isActive && (
                    <button
                      onClick={() => void handleActivate(provider.id)}
                      className="p-2 text-text-secondary hover:text-success hover:bg-success/5 rounded-lg transition-colors"
                      title="激活"
                    >
                      <Power className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(provider)}
                    className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => void handleDelete(provider.id)}
                    className="p-2 text-text-secondary hover:text-error hover:bg-error/5 rounded-lg transition-colors"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {provider.model && (
                <div className="px-4 pb-4">
                  <span className="text-xs px-2 py-1 rounded-full bg-bg-primary text-text-secondary">
                    模型: {provider.model}
                  </span>
                </div>
              )}
            </motion.div>
          ))
        )}
      </div>

      <div className="p-4 rounded-xl bg-info/10 border border-info/20">
        <h4 className="font-medium text-text-primary mb-2">使用说明</h4>
        <ul className="text-sm text-text-secondary space-y-1">
          <li>• 激活的 Provider 将被智能体使用</li>
          <li>• 配置模型名称后，智能体将使用指定的模型</li>
        </ul>
      </div>

      <div className="p-4 rounded-xl bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
          <SettingsIcon className="w-4 h-4" />
          可用工具
        </h4>
        <p className="text-sm text-text-muted mb-3">
          当前智能体已注册 <span className="text-primary font-medium">{registeredToolNames.length}</span> 个工具
        </p>
        <div className="flex flex-wrap gap-2">
          {registeredToolNames.map((toolName) => (
            <span
              key={toolName}
              className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20"
            >
              {toolName}
            </span>
          ))}
        </div>
      </div>
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
      case 'api': return <ApiConfigSettings />;
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
