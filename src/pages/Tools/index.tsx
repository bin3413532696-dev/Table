import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, FileJson, Copy, Check, RefreshCw, ArrowLeft, Zap } from 'lucide-react';
import { PageHeader, PageContent, StaggerContainer, StaggerItem, defaultEasing } from '../../components/ui/PageAnimations';
import { Button } from '../../components/ui';

const tools = [
  { icon: FileJson, label: 'JSON格式化', desc: 'JSON数据处理', color: 'success' },
];

function JsonFormatterTool() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const formatJson = () => {
    try {
      const parsed = JSON.parse(input);
      setOutput(JSON.stringify(parsed, null, 2));
      setError('');
    } catch (e) {
      setError('无效的 JSON 格式');
      setOutput('');
    }
  };

  const minifyJson = () => {
    try {
      const parsed = JSON.parse(input);
      setOutput(JSON.stringify(parsed));
      setError('');
    } catch (e) {
      setError('无效的 JSON 格式');
      setOutput('');
    }
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearAll = () => {
    setInput('');
    setOutput('');
    setError('');
  };

  return (
    <div className="card">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-text-secondary">输入 JSON</label>
            <button onClick={clearAll} className="text-xs flex items-center gap-1 text-text-muted hover:text-text-secondary">
              <RefreshCw className="w-3 h-3" /> 清空
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"key": "value"}'
            className="input h-40 md:h-48 lg:h-56 resize-none font-mono text-sm"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-text-secondary">格式化结果</label>
            {output && (
              <button onClick={copyOutput} className="text-xs flex items-center gap-1 text-primary hover:text-primary-600">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? '已复制' : '复制'}
              </button>
            )}
          </div>
          <textarea
            value={output}
            readOnly
            className="input h-40 md:h-48 lg:h-56 resize-none font-mono text-sm bg-bg-tertiary"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg mb-4 bg-error/10 text-error border border-error/20">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="primary" className="flex-1" onClick={formatJson}>格式化</Button>
        <Button variant="secondary" className="flex-1" onClick={minifyJson}>压缩</Button>
      </div>
    </div>
  );
}

export default function Tools() {
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const renderTool = () => {
    switch (activeTool) {
      case 'JSON格式化': return <JsonFormatterTool />;
      default: return null;
    }
  };

  return (
    <div className="p-3 md:p-6 min-h-screen bg-bg-secondary space-y-4">
      <div className="max-w-[1000px] mx-auto">
      {/* 页面头部 */}
      <PageHeader className="page-header">
        <div className="page-header-icon">
          <Wrench className="w-5 h-5" />
        </div>
        <div>
          <h1 className="page-header-title">工具箱</h1>
          <p className="page-header-subtitle">便捷的在线工具集合</p>
        </div>
      </PageHeader>

      <AnimatePresence mode="wait">
        {activeTool ? (
          <motion.div
            key="tool"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: defaultEasing }}
          >
            <Button variant="ghost" size="sm" className="mb-4" onClick={() => setActiveTool(null)} icon={<ArrowLeft className="w-4 h-4" />}>
              返回工具列表
            </Button>
            {renderTool()}
          </motion.div>
        ) : (
          <StaggerContainer className="grid-tools-3" staggerDelay={0.06}>
            {tools.map((tool) => {
              const getIconClasses = () => {
                if (tool.color === 'success') {
                  return 'card-icon-md bg-success/10 text-success';
                }
                return 'card-icon-md bg-primary/10 text-primary';
              };
              return (
                <StaggerItem key={tool.label}>
                  <motion.div
                    whileHover={{ y: -4 }}
                    onClick={() => setActiveTool(tool.label)}
                    className="card cursor-pointer group min-w-[240px] max-w-[320px]"
                  >
                    <div className={`${getIconClasses()} rounded-xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}>
                      <tool.icon className="w-7 h-7" />
                    </div>
                    <h3 className="font-semibold text-text-primary mb-1">{tool.label}</h3>
                    <p className="text-sm text-text-muted">{tool.desc}</p>
                    <div className="flex items-center gap-1 mt-4 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      <Zap className="w-3 h-3" />
                      点击使用
                    </div>
                  </motion.div>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
