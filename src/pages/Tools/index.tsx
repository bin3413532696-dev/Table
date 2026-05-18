import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, FileJson, Copy, Check, RefreshCw, ArrowLeft, Zap } from 'lucide-react';

const tools = [
  { icon: FileJson, label: 'JSON格式化', desc: 'JSON数据处理', color: 'bg-success' },
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
      <div className="grid grid-cols-2 gap-4 mb-4">
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
            className="input h-48 resize-none font-mono text-sm"
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
            className="input h-48 resize-none font-mono text-sm bg-bg-tertiary"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg mb-4 bg-error/10 text-error border border-error/20">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={formatJson} className="btn btn-primary btn-md flex-1">格式化</button>
        <button onClick={minifyJson} className="btn btn-secondary btn-md flex-1">压缩</button>
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
    <div className="p-4 md:p-8 max-w-4xl mx-auto min-h-screen bg-bg-secondary">
      {/* 页面头部 */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="page-header">
        <div className="page-header-icon">
          <Wrench className="w-5 h-5" />
        </div>
        <div>
          <h1 className="page-header-title">工具箱</h1>
          <p className="page-header-subtitle">便捷的在线工具集合</p>
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {activeTool ? (
          <motion.div
            key="tool"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
          >
            <button onClick={() => setActiveTool(null)} className="btn btn-ghost btn-sm mb-4">
              <ArrowLeft className="w-4 h-4" />
              返回工具列表
            </button>
            {renderTool()}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {tools.map((tool, index) => (
              <motion.div
                key={tool.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
                whileHover={{ y: -4 }}
                onClick={() => setActiveTool(tool.label)}
                className="card cursor-pointer group"
              >
                <div className={`w-14 h-14 ${tool.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}>
                  <tool.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-semibold text-text-primary mb-1">{tool.label}</h3>
                <p className="text-sm text-text-muted">{tool.desc}</p>
                <div className="flex items-center gap-1 mt-4 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  <Zap className="w-3 h-3" />
                  点击使用
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
