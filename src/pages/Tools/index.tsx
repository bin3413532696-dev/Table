import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Wrench, Calculator, Palette, FileJson, Copy, Check, RefreshCw } from 'lucide-react';

const tools = [
  { icon: Calculator, label: '计算器', desc: '快速计算', color: 'bg-blue-500' },
  { icon: Palette, label: '取色器', desc: '颜色工具', color: 'bg-purple-500' },
  { icon: FileJson, label: 'JSON格式化', desc: '数据处理', color: 'bg-green-500' },
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
    { label: '=', action: performCalculation, className: 'row-span-2 bg-blue-500 hover:bg-blue-600' },
    { label: '0', action: () => inputNumber('0'), className: 'col-span-2' },
    { label: '.', action: () => inputNumber('.'), className: '' },
  ];

  return (
    <div className="p-6 rounded-2xl bg-bg-card border border-border-primary">
      <div className="p-4 rounded-xl mb-4 text-right text-3xl font-mono bg-bg-tertiary text-text-primary">
        {display}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {buttons.map((btn) => (
          <button
            key={btn.label}
            onClick={btn.action}
            className={`p-4 rounded-xl font-semibold transition-all ${
              btn.className.includes('bg-blue-500') 
                ? 'bg-blue-500 text-white hover:bg-blue-600' 
                : btn.label === 'C'
                  ? 'bg-rose-100 text-rose-600 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50'
                  : ['+', '-', '×', '÷', '='].includes(btn.label)
                    ? 'bg-blue-100 text-blue-600 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700'
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
  const [color, setColor] = useState('#3B82F6');
  const [copied, setCopied] = useState(false);

  const colors = [
    '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#10B981',
    '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
    '#F43F5E', '#78716C', '#1F2937', '#374151', '#6B7280',
  ];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rgbToHex = (r: number, g: number, b: number) => {
    return '#' + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
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
    <div className="p-6 rounded-2xl bg-bg-card border border-border-primary">
      <div className="flex gap-6 mb-6">
        <div 
          className="w-32 h-32 rounded-2xl shadow-lg"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 space-y-3">
          <div className="p-3 rounded-lg bg-bg-secondary">
            <div className="text-xs mb-1 text-text-muted">HEX</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg text-text-primary">{color.toUpperCase()}</span>
              <button 
                onClick={() => copyToClipboard(color.toUpperCase())}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-text-muted" />}
              </button>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-bg-secondary">
            <div className="text-xs mb-1 text-text-muted">RGB</div>
            <span className="font-mono text-lg text-text-primary">{rgb.r}, {rgb.g}, {rgb.b}</span>
          </div>
        </div>
      </div>
      
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2 text-text-secondary">自定义颜色</label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-full h-12 rounded-lg cursor-pointer"
        />
      </div>

      <div className="grid grid-cols-5 gap-2">
        {colors.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-full aspect-square rounded-lg transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
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
    <div className="p-6 rounded-2xl bg-bg-card border border-border-primary">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-text-secondary">输入 JSON</label>
            <button 
              onClick={clearAll}
              className="text-xs flex items-center gap-1 text-text-muted hover:text-text-secondary"
            >
              <RefreshCw className="w-3 h-3" /> 清空
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"key": "value"}'
            className="w-full h-48 p-3 rounded-lg font-mono text-sm resize-none bg-bg-secondary border border-border-primary text-text-primary"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-text-secondary">格式化结果</label>
            {output && (
              <button 
                onClick={copyOutput}
                className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} 
                {copied ? '已复制' : '复制'}
              </button>
            )}
          </div>
          <textarea
            value={output}
            readOnly
            className="w-full h-48 p-3 rounded-lg font-mono text-sm resize-none bg-bg-secondary border border-border-primary text-text-primary"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg mb-4 bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={formatJson}
          className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          格式化
        </button>
        <button
          onClick={minifyJson}
          className="flex-1 py-2 rounded-lg transition-colors bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          压缩
        </button>
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
    <div className="p-8 max-w-4xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-6"
      >
        <div className="w-10 h-10 bg-gray-900 dark:bg-gray-700 rounded-lg flex items-center justify-center">
          <Wrench className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">工具箱</h1>
      </motion.div>

      {activeTool ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <button
            onClick={() => setActiveTool(null)}
            className="mb-4 text-sm flex items-center gap-1 text-text-muted hover:text-text-secondary"
          >
            ← 返回工具列表
          </button>
          {renderTool()}
        </motion.div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool, index) => (
            <motion.div
              key={tool.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.02, y: -4 }}
              onClick={() => setActiveTool(tool.label)}
              className="rounded-xl p-5 cursor-pointer transition-all bg-bg-card shadow-sm border border-border-primary hover:shadow-md"
            >
              <div className={`w-12 h-12 ${tool.color} rounded-xl flex items-center justify-center mb-4`}>
                <tool.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold mb-1 text-text-primary">{tool.label}</h3>
              <p className="text-sm text-text-muted">{tool.desc}</p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
