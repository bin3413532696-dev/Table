import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, AlertCircle } from 'lucide-react';

interface PinLockProps {
  onSuccess: () => void;
}

export const PinLock: React.FC<PinLockProps> = ({ onSuccess }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    if (attempts >= 3) {
      setDisabled(true);
      setTimeout(() => {
        setDisabled(false);
        setAttempts(0);
      }, 30000);
    }
  }, [attempts]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;

    const savedPin = localStorage.getItem('security_pin');
    if (pin === savedPin) {
      onSuccess();
    } else {
      setError(true);
      setAttempts(prev => prev + 1);
      setPin('');
      setTimeout(() => setError(false), 2000);
    }
  };

  const handleNumberClick = (num: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + num);
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md p-8"
      >
        <div className="bg-bg-card rounded-2xl p-8 shadow-xl border border-border-primary">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-blue-500/20 rounded-full flex items-center justify-center">
              <Lock className="w-8 h-8 text-blue-500 dark:text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary mb-2">验证 PIN 码</h1>
            <p className="text-text-muted">请输入您的访问密码</p>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-2 mb-6 p-3 bg-rose-50 dark:bg-rose-900/30 rounded-lg text-rose-600 dark:text-rose-300"
              >
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">
                  {attempts >= 3 ? '尝试次数过多，请稍后再试' : 'PIN 码不正确'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex justify-center gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center transition-all ${
                    pin[i]
                      ? 'bg-blue-500 border-blue-400'
                      : 'border-border-primary bg-bg-secondary'
                  }`}
                >
                  {pin[i] && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="text-white font-bold text-lg"
                    >
                      {pin[i]}
                    </motion.span>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => num === 'delete' ? handleDelete() : handleNumberClick(num)}
                  disabled={disabled}
                  className={`p-4 rounded-xl font-semibold text-lg transition-all ${
                    num === 'delete'
                      ? 'bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700'
                      : num === ''
                      ? 'bg-transparent cursor-default'
                      : 'bg-bg-secondary text-text-primary hover:bg-bg-tertiary border border-border-primary'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {num === 'delete' ? (
                    <span className="text-sm">删除</span>
                  ) : (
                    num
                  )}
                </button>
              ))}
            </div>
          </form>

          <button
            onClick={() => {
              localStorage.removeItem('security_pin');
              onSuccess();
            }}
            className="w-full mt-6 text-center text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            忘记密码？移除保护
          </button>
        </div>
      </motion.div>
    </div>
  );
};