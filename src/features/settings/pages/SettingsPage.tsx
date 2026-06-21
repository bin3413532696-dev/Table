import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Globe, HardDrive, Settings as SettingsIcon, Shield, User } from 'lucide-react';

import { PageContent, PageHeader, defaultEasing } from '../../../components/ui/PageAnimations';
import { AgentConfigSection } from './sections/AgentConfigSection';
import { DataManagementSection } from './sections/DataManagementSection';
import { ProfileSettingsSection } from './sections/ProfileSettingsSection';
import { SecuritySettingsSection } from './sections/SecuritySettingsSection';

const settingsTabs = [
  { id: 'profile', label: '个人资料', icon: User },
  { id: 'security', label: '安全隐私', icon: Shield },
  { id: 'data', label: '数据管理', icon: HardDrive },
  { id: 'api', label: '智能体配置', icon: Globe },
] as const;

type SettingsTabId = (typeof settingsTabs)[number]['id'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('profile');

  const renderContent = () => {
    switch (activeTab) {
      case 'profile':
        return <ProfileSettingsSection />;
      case 'security':
        return <SecuritySettingsSection />;
      case 'data':
        return <DataManagementSection />;
      case 'api':
        return <AgentConfigSection />;
      default:
        return null;
    }
  };

  return (
    <div className="p-3 md:p-6 min-h-screen bg-bg-secondary space-y-4">
      <div className="max-w-[1000px] mx-auto">
        <PageHeader className="page-header">
          <div className="page-header-icon">
            <SettingsIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="page-header-title">设置</h1>
            <p className="page-header-subtitle">管理您的个人工作站</p>
          </div>
        </PageHeader>

        <PageContent delay={0.1} className="space-y-4">
          <div className="flex flex-wrap gap-2 p-1.5 rounded-lg bg-bg-card border border-border-primary shadow-sm">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                }`}
              >
                <tab.icon className="w-4 h-4 shrink-0" />
                <span className="font-medium text-sm">{tab.label}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: defaultEasing }}
              className="rounded-lg bg-bg-card border border-border-primary shadow-sm p-4 md:p-5"
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </PageContent>
      </div>
    </div>
  );
}
