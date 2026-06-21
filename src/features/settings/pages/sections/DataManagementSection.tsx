import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle, Database, Download, HardDrive, Settings as SettingsIcon, Trash2, Upload } from 'lucide-react';

import { Button } from '../../../../components/ui';
import { MESSAGES } from '../../../../core/messages';
import { maintenanceApi } from '../../api';

export function DataManagementSection() {
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

  const refreshStats = async () => {
    const nextStats = await maintenanceApi.getStats();
    setStats(nextStats);
  };

  useEffect(() => {
    void refreshStats();
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
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleExportBusiness = async () => {
    const data = await maintenanceApi.exportBusinessData();
    downloadJson(`business_backup_${new Date().toISOString().split('T')[0]}.json`, data);
  };

  const handleExportKnowledge = async () => {
    const data = await maintenanceApi.exportKnowledgeData();
    downloadJson(`knowledge_backup_${new Date().toISOString().split('T')[0]}.json`, data);
  };

  const handleExportLocalSettings = async () => {
    const data = await maintenanceApi.exportLocalSettings();
    downloadJson(`local_settings_${new Date().toISOString().split('T')[0]}.json`, data);
  };

  const createImportHandler = (
    importer: (content: string) => Promise<boolean>,
    successMessage: string,
    options?: { reloadAfterSuccess?: boolean; refreshStatsAfterSuccess?: boolean }
  ) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const success = await importer(content);
      if (success) {
        if (options?.refreshStatsAfterSuccess) {
          await refreshStats();
        }
        showStatus('success', successMessage);
        if (options?.reloadAfterSuccess) {
          setTimeout(() => window.location.reload(), 1200);
        }
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
        await maintenanceApi.clearAll();
      } else if (clearMode === 'knowledge') {
        await maintenanceApi.clearKnowledgeData();
      } else if (clearMode === 'local') {
        maintenanceApi.clearLocalSettings();
      }
      setShowClearConfirm(false);
      if (clearMode === 'local') {
        window.location.reload();
        return;
      }
      await refreshStats();
      showStatus('success', clearMode === 'all' ? '数据已重置' : '知识库已清空');
    } catch {
      setShowClearConfirm(false);
      showStatus('error', MESSAGES.settings.clearFailed);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <div className="text-center">
          <p className="text-xl font-semibold text-text-primary">{stats.finance}</p>
          <p className="text-xs text-text-muted">费用记录</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-text-primary">{stats.tasks}</p>
          <p className="text-xs text-text-muted">任务</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-text-primary">{stats.knowledgeNotes}</p>
          <p className="text-xs text-text-muted">知识笔记</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-text-primary">{stats.knowledgePresetTags}</p>
          <p className="text-xs text-text-muted">预设标签</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-text-primary">{formatSize(stats.totalSize)}</p>
          <p className="text-xs text-text-muted">数据大小</p>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
          <Database className="w-4 h-4" />
          业务数据（PostgreSQL）
        </h4>
        <div className="space-y-2">
          <button onClick={() => void handleExportBusiness()} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-bg-tertiary border border-border-primary transition-colors text-left group">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Download className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">导出业务数据</div>
              <div className="text-xs text-text-muted">导出服务端任务与财务快照</div>
            </div>
          </button>

          <label className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-bg-tertiary border border-border-primary transition-colors cursor-pointer text-left group">
            <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center group-hover:bg-success/20 transition-colors">
              <Upload className="w-4 h-4 text-success" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">导入业务数据</div>
              <div className="text-xs text-text-muted">覆盖 PostgreSQL 中的任务与财务测试数据</div>
            </div>
            <input
              type="file"
              accept=".json"
              onChange={createImportHandler(maintenanceApi.importBusinessData, MESSAGES.settings.importBusinessSuccess, {
                refreshStatsAfterSuccess: true,
              })}
              className="hidden"
            />
          </label>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
          <HardDrive className="w-4 h-4" />
          知识库数据（服务端权威）
        </h4>
        <div className="space-y-2">
          <button onClick={() => void handleExportKnowledge()} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-bg-tertiary border border-border-primary transition-colors text-left group">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Download className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">导出知识库</div>
              <div className="text-xs text-text-muted">导出服务端知识笔记与预设标签概览</div>
            </div>
          </button>

          <label className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-bg-tertiary border border-border-primary transition-colors cursor-pointer text-left group">
            <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center group-hover:bg-success/20 transition-colors">
              <Upload className="w-4 h-4 text-success" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">导入知识库</div>
              <div className="text-xs text-text-muted">覆盖当前知识库并同步到服务端知识库</div>
            </div>
            <input
              type="file"
              accept=".json"
              onChange={createImportHandler(maintenanceApi.importKnowledgeData, MESSAGES.settings.importKnowledgeSuccess, {
                refreshStatsAfterSuccess: true,
              })}
              className="hidden"
            />
          </label>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
          <SettingsIcon className="w-4 h-4" />
          本地设置（浏览器缓存）
        </h4>
        <div className="space-y-2">
          <button onClick={() => void handleExportLocalSettings()} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-bg-tertiary border border-border-primary transition-colors text-left group">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Download className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">导出本地设置</div>
              <div className="text-xs text-text-muted">导出个人资料、主题、通知和 PIN 缓存</div>
            </div>
          </button>

          <label className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-bg-tertiary border border-border-primary transition-colors cursor-pointer text-left group">
            <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center group-hover:bg-success/20 transition-colors">
              <Upload className="w-4 h-4 text-success" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">导入本地设置</div>
              <div className="text-xs text-text-muted">仅恢复当前浏览器的本地设置项</div>
            </div>
            <input
              type="file"
              accept=".json"
              onChange={createImportHandler(maintenanceApi.importLocalSettings, MESSAGES.settings.importSettingsSuccess, {
                reloadAfterSuccess: true,
              })}
              className="hidden"
            />
          </label>
        </div>
      </div>

      <AnimatePresence>
        {status.type !== 'idle' && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`flex items-center gap-2 p-3 rounded-lg text-sm ${status.type === 'success' ? 'bg-success/10 text-success border border-success/20' : 'bg-error/10 text-error border border-error/20'}`}>
            {status.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {status.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-4 rounded-lg bg-bg-secondary border border-error/20">
        <h4 className="font-medium text-error mb-3 flex items-center gap-2">
          <Trash2 className="w-4 h-4" />
          危险操作
        </h4>
        <div className="space-y-2">
          <button onClick={() => { setClearMode('all'); setShowClearConfirm(true); }} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-error/5 border border-border-primary transition-colors text-left group">
            <div className="w-9 h-9 rounded-lg bg-error/10 flex items-center justify-center group-hover:bg-error/20 transition-colors">
              <Trash2 className="w-4 h-4 text-error" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">重置业务数据并清空本地缓存</div>
              <div className="text-xs text-text-muted">清空所有业务数据与本地缓存</div>
            </div>
          </button>
          <button onClick={() => { setClearMode('knowledge'); setShowClearConfirm(true); }} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-error/5 border border-border-primary transition-colors text-left group">
            <div className="w-9 h-9 rounded-lg bg-error/10 flex items-center justify-center group-hover:bg-error/20 transition-colors">
              <Trash2 className="w-4 h-4 text-error" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">清空知识库</div>
              <div className="text-xs text-text-muted">清空服务端知识库数据</div>
            </div>
          </button>
          <button onClick={() => { setClearMode('local'); setShowClearConfirm(true); }} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-error/5 border border-border-primary transition-colors text-left group">
            <div className="w-9 h-9 rounded-lg bg-error/10 flex items-center justify-center group-hover:bg-error/20 transition-colors">
              <Trash2 className="w-4 h-4 text-error" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">清空本地设置</div>
              <div className="text-xs text-text-muted">清空浏览器中的本地设置缓存</div>
            </div>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showClearConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowClearConfirm(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-error/10 flex items-center justify-center">
                  <AlertCircle className="w-4 h-4 text-error" />
                </div>
                <h3 className="font-semibold text-text-primary">确认清空</h3>
              </div>
              <p className="text-text-muted mb-4 text-sm">
                {clearMode === 'all' && '此操作会重置 PostgreSQL 中的任务与财务测试数据，清空服务端知识库，并清空当前浏览器的设置缓存。'}
                {clearMode === 'knowledge' && '此操作会清空当前知识库，并同步覆盖服务端知识数据。'}
                {clearMode === 'local' && '此操作会清空当前浏览器中的个人资料、主题、通知和 PIN 设置。'}
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setShowClearConfirm(false)}>取消</Button>
                <Button variant="danger" className="flex-1" onClick={() => void handleClear()}>确认清空</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
