import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, Calculator, Palette, FileJson, Copy, Check, RefreshCw, ArrowLeft, Zap } from 'lucide-react';

const tools = [
  { icon: Calculator, label: '计算器', desc: '快速数学计算', color: 'bg-primary' },
  { icon: Palette, label: '取色器', desc: '颜色选择与转换', color: 'bg-purple-500' },
  { icon: FileJson, label: 'JSON格式化', desc: 'JSON数据处理', color: 'bg-success' },
];

function CalculatorTool() {
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  const inputNumber = (num: string) => {
    if (waitingForOperand) {
      setDisplay(num);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? num : display + num);
    }
  };

  const inputOperation = (op: string) => {
    const currentValue = parseFloat(display);
    if (prevValue === null) {
      setPrevValue(currentValue);
    } else if (operation) {
      const result = calculate(prevValue, currentValue, operation);
      setPrevValue(result);
      setDisplay(String(result));
    }
    setWaitingForOperand(true);
    setOperation(op);
  };

  const calculate = (a: number, b: number, op: string): number => {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b !== 0 ? a / b : 0;
      default: return b;
    }
  };

  const performCalculation = () => {
    const currentValue = parseFloat(display);
    if (prevValue !== null && operation) {
      const result = calculate(prevValue, currentValue, operation);
      setDisplay(String(result));
      setPrevValue(null);
      setOperation(null);
      setWaitingForOperand(true);
    }
  };

  const clear = () => {
    setDisplay('0');
    setPrevValue(null);
    setOperation(null);
    setWaitingForOperand(false);
  };

  const buttons = [
    { label: 'C', action: clear, className: 'col-span-2' },
    { label: '÷', action: () => inputOperation('/'), className: '' },
    { label: '×', action: () => inputOperation('*'), className: '' },
    { label: '7', action: () => inputNumber('7'), className: '' },
    { label: '8', action: () => inputNumber('8'), className: '' },
    { label: '9', action: () => inputNumber('9'), className: '' },
    { label: '-', action: () => inputOperation('-'), className: '' },
    { label: '4', action: () => inputNumber('4'), className: '' },
    { label: '5', action: () => inputNumber('5'), className: '' },
    { label: '6', action: () => inputNumber('6'), className: '' },
    { label: '+', action: () => inputOperation('+'), className: '' },
    { label: '1', action: () => inputNumber('1'), className: '' },
    { label: '2', action: () => inputNumber('2'), className: '' },
    { label: '3', action: () => inputNumber('3'), className: '' },
    { label: '=', action: performCalculation, className: 'row-span-2' },
    { label: '0', action: () => inputNumber('0'), className: 'col-span-2' },
    { label: '.', action: () => inputNumber('.'), className: '' },
  ];

  return (
    <div className="card">
      <div className="p-4 rounded-xl mb-4 text-right text-3xl font-mono bg-bg-tertiary text-text-primary border border-border-primary">
        {display}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {buttons.map((btn) => (
          <button
            key={btn.label}
            onClick={btn.action}
            className={`p-4 rounded-xl font-semibold transition-all duration-150 active:scale-95 ${
              btn.label === '='
                ? 'bg-primary text-white hover:bg-primary-600'
                : btn.label === 'C'
                  ? 'bg-error/10 text-error hover:bg-error/20 dark:bg-error/20 dark:text-error-400'
                  : ['+', '-', '×', '÷'].includes(btn.label)
                    ? 'bg-primary/10 text-primary hover:bg-primary/20 dark:bg-primary/20 dark:text-primary-400'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-border-primary border border-border-primary'
            } ${btn.className}`}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorPickerTool() {
  const [color, setColor] = useState('#165DFF');
  const [copied, setCopied] = useState(false);

  const colors = [
    '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#10B981',
    '#06B6D4', '#165DFF', '#6366F1', '#8B5CF6', '#EC4899',
    '#F43F5E', '#78716C', '#1F2937', '#374151', '#6B7280',
  ];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  };

  const rgb = hexToRgb(color);

  return (
    <div className="card">
      <div className="flex gap-6 mb-6">
        <div className="w-24 h-24 rounded-xl shadow-lg border border-border-primary" style={{ backgroundColor: color }} />
        <div className="flex-1 space-y-3">
          <div className="p-3 rounded-lg bg-bg-tertiary border border-border-primary">
            <div className="text-xs mb-1 text-text-muted">HEX</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg text-text-primary">{color.toUpperCase()}</span>
              <button onClick={() => copyToClipboard(color.toUpperCase())} className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors">
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-text-muted" />}
              </button>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-bg-tertiary border border-border-primary">
            <div className="text-xs mb-1 text-text-muted">RGB</div>
            <span className="font-mono text-lg text-text-primary">{rgb.r}, {rgb.g}, {rgb.b}</span>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2 text-text-secondary">自定义颜色</label>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-full h-12 rounded-lg cursor-pointer border border-border-primary" />
      </div>

      <div className="grid grid-cols-5 gap-2">
        {colors.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-full aspect-square rounded-lg transition-all duration-150 hover:scale-105 ${color === c ? 'ring-2 ring-offset-2 ring-primary ring-offset-bg-card' : ''}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

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
      case '计算器': return <CalculatorTool />;
      case '取色器': return <ColorPickerTool />;
      case 'JSON格式化': return <JsonFormatterTool />;
      default: return null;
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto min-h-screen bg-bg-secondary">
      {/* 页面头部 */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="page-header">
        <div className="page-header-icon bg-neutral-800 dark:bg-neutral-700">
          <Wrench className="w-5 h-5 text-white" />
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