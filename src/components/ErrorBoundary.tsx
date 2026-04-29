import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({
      error,
      errorInfo
    });
    
    console.error('Error Boundary caught an error:', error, errorInfo);
  }

  handleRefresh = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
    
    window.location.reload();
  };

  handleResetStorage = (): void => {
    try {
      localStorage.clear();
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null
      });
      window.location.reload();
    } catch (e) {
      console.error('Failed to clear localStorage:', e);
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const isStorageError = this.state.error?.message.includes('QuotaExceededError') ||
                            this.state.error?.message.includes('localStorage');

      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
          <div className="max-w-lg w-full">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20 shadow-2xl">
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 bg-rose-500/20 rounded-full flex items-center justify-center mb-6">
                  <AlertTriangle className="w-10 h-10 text-rose-400" />
                </div>

                <h1 className="text-2xl font-bold text-white mb-3">
                  应用出现错误
                </h1>

                <p className="text-gray-400 mb-6">
                  {isStorageError 
                    ? '本地存储空间不足，请清理浏览器缓存或重置数据。'
                    : '应用遇到了意外问题，请尝试刷新页面。'
                  }
                </p>

                {this.state.error && (
                  <div className="w-full bg-black/30 rounded-xl p-4 mb-6 text-left">
                    <p className="text-sm text-gray-300 font-mono break-all">
                      {this.state.error.message}
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-3 w-full">
                  <button
                    onClick={this.handleRefresh}
                    className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30"
                  >
                    <RefreshCw className="w-5 h-5" />
                    刷新页面
                  </button>

                  {isStorageError && (
                    <button
                      onClick={this.handleResetStorage}
                      className="w-full px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 border border-white/20"
                    >
                      <RotateCcw className="w-5 h-5" />
                      重置所有数据
                    </button>
                  )}

                  <button
                    onClick={() => window.location.href = '/'}
                    className="w-full px-6 py-3 text-gray-400 hover:text-white transition-colors flex items-center justify-center gap-2"
                  >
                    <Home className="w-5 h-5" />
                    返回首页
                  </button>
                </div>
              </div>
            </div>

            <p className="text-center text-gray-500 text-sm mt-6">
              如果问题持续存在，请检查浏览器控制台获取详细信息
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;