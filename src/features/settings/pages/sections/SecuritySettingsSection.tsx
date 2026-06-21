import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff, Lock, Moon, Sun } from 'lucide-react';

import { Button, Toggle } from '../../../../components/ui';
import { useTheme } from '../../../../contexts/ThemeContext';
import { clearPinApi, fetchPinStatus, setPinApi } from '../../../../shared/auth';

export function SecuritySettingsSection() {
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
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-text-primary">本地设置安全</h4>
            <p className="text-sm mt-1 text-text-muted">业务数据与知识库以服务端为准，当前浏览器仍会保存主题、PIN 等本地设置。清除浏览器数据会丢失这些设置，建议按需导出备份。</p>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
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

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
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
