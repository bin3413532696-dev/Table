import React, { useEffect, useState } from 'react';
import { Check, Database, Plus, User } from 'lucide-react';

import { initializeAppData } from '../../../../app/bootstrap';
import { Button } from '../../../../components/ui';
import { useCurrentUser } from '../../../../contexts/UserContext';
import { MESSAGES } from '../../../../core/messages';
import {
  clearProviderCache,
} from '../../api/providers';
import {
  clearAuthSession,
  createAuthUser,
  DEFAULT_USER_ID,
  fetchAuthUsers,
  setCurrentUserId,
  switchAuthSession,
  updateAuthMe,
} from '../../../../shared/auth';

function isValidEmail(email: string): boolean {
  if (!email) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function ProfileSettingsSection() {
  const { user, auth, reload } = useCurrentUser();
  const [profile, setProfile] = useState({
    name: '个人用户',
    email: '',
    bio: '',
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
    await initializeAppData();
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
      clearProviderCache();
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
      clearProviderCache();
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
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-white text-xl font-bold">
            {profile.name.charAt(0)}
          </div>
          <div>
            <h4 className="font-medium text-text-primary">{profile.name}</h4>
            <p className="text-sm text-text-muted">{auth?.isDefaultUser ? '默认本地用户' : '认证用户'}</p>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
          <User className="w-4 h-4" />
          个人信息
        </h4>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">昵称</label>
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
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">邮箱</label>
            <input
              type="email"
              value={profile.email}
              onChange={(e) => {
                setProfile({ ...profile, email: e.target.value });
                setEmailError('');
              }}
              placeholder="your@email.com"
              className={`input ${emailError ? 'border-error focus:ring-error/20 focus:border-error' : ''}`}
            />
            {emailError && <p className="text-error text-xs mt-1">{emailError}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">个人简介</label>
            <textarea
              value={profile.bio}
              onChange={(e) => setProfile({ ...profile, bio: e.target.value.slice(0, 200) })}
              placeholder="介绍一下自己..."
              rows={3}
              className="input resize-none"
            />
            <p className="text-xs text-text-muted mt-1 text-right">{profile.bio.length}/200</p>
          </div>
          <Button variant="primary" onClick={() => void handleSave()} icon={saved ? <Check className="w-4 h-4" /> : undefined}>
            {saved ? '已保存' : '保存设置'}
          </Button>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
          <Database className="w-4 h-4" />
          开发期用户切换
        </h4>
        <p className="text-sm text-text-muted mb-3">用于验证多用户隔离链路。现在需要先创建用户，再切换到已有用户。</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">用户 ID</label>
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
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">已有用户</label>
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
          <div className="flex flex-wrap gap-2">
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

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4" />
          创建开发期用户
        </h4>
        <p className="text-sm text-text-muted mb-3">显式创建用户及其基线数据，避免再通过任意 UUID 隐式建号。</p>
        <div className="grid-form-2 mb-3">
          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">用户名称</label>
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
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">邮箱</label>
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
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1.5 text-text-secondary">简介</label>
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
        {createUserError && <p className="text-error text-xs mb-2">{createUserError}</p>}
        <Button variant="primary" onClick={() => void handleCreateUser()} disabled={creatingUser}>
          {creatingUser ? '创建中...' : createUserSaved ? '已创建' : '创建用户'}
        </Button>
      </div>
    </div>
  );
}
