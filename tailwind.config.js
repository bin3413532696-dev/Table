module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './index.html'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主色系统 #2563EB
        primary: {
          DEFAULT: '#2563EB',
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        // Info语义色（与Primary保持一致）
        info: {
          DEFAULT: '#2563EB',
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
          light: '#DBEAFE',
          dark: '#1E40AF',
        },
        // Success语义色
        success: {
          DEFAULT: '#16A34A',
          50: '#F0FDF4',
          100: '#DCFCE7',
          200: '#BBF7D0',
          300: '#86EFAC',
          400: '#4ADE80',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
          800: '#166534',
          900: '#14532D',
          light: '#DCFCE7',
          dark: '#15803D',
        },
        // Warning语义色
        warning: {
          DEFAULT: '#EA580C',
          50: '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C',
          700: '#C2410C',
          800: '#9A3412',
          900: '#7C2D12',
          light: '#FFF7ED',
          dark: '#C2410C',
        },
        // Error语义色
        error: {
          DEFAULT: '#DC2626',
          50: '#FEF2F2',
          100: '#FEE2E2',
          200: '#FECACA',
          300: '#FCA5A5',
          400: '#F87171',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
          800: '#991B1B',
          900: '#7F1D1D',
          light: '#FEF2F2',
          dark: '#B91C1C',
        },
        // 图表专用色系
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
          6: 'var(--chart-6)',
          7: 'var(--chart-7)',
          8: 'var(--chart-8)',
          positive: 'var(--chart-positive)',
          negative: 'var(--chart-negative)',
          neutral: 'var(--chart-neutral)',
        },
        // Sidebar专用色
        sidebar: {
          bg: 'var(--sidebar-bg)',
          border: 'var(--sidebar-border)',
          text: 'var(--sidebar-text)',
          textActive: 'var(--sidebar-text-active)',
          activeBg: 'var(--sidebar-active-bg)',
        },
        // 状态分隔背景色
        'status-income-bg': 'var(--status-income-bg)',
        'status-income-border': 'var(--status-income-border)',
        'status-expense-bg': 'var(--status-expense-bg)',
        'status-expense-border': 'var(--status-expense-border)',
        'status-neutral-bg': 'var(--status-neutral-bg)',
        'status-neutral-border': 'var(--status-neutral-border)',
        // 中性色阶
        neutral: {
          50: '#FAFAFA',
          100: '#F5F5F5',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
        },
        // 语义化背景/文字/边框
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        'bg-card': 'var(--bg-card)',
        'bg-elevated': 'var(--bg-elevated)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'border-primary': 'var(--border-primary)',
        'border-secondary': 'var(--border-secondary)',
        'border-focus': 'var(--border-focus)',
      },
      // 圆角系统
      borderRadius: {
        'sm': '6px',
        'DEFAULT': '10px',
        'md': '10px',
        'lg': '14px',
        'xl': '20px',
        '2xl': '24px',
      },
      // 阴影系统
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.04)',
        'DEFAULT': '0 2px 4px 0 rgba(0, 0, 0, 0.05)',
        'md': '0 2px 8px 0 rgba(0, 0, 0, 0.06)',
        'lg': '0 4px 16px 0 rgba(0, 0, 0, 0.08)',
        'card': '0 2px 8px 0 rgba(0, 0, 0, 0.04)',
        'card-hover': '0 4px 12px 0 rgba(0, 0, 0, 0.08)',
        'card-dark': '0 2px 8px 0 rgba(0, 0, 0, 0.3)',
        'card-dark-hover': '0 4px 12px 0 rgba(0, 0, 0, 0.4)',
      },
      // 字体大小系统
      fontSize: {
        'xs': ['12px', { lineHeight: '1.5' }],
        'sm': ['14px', { lineHeight: '1.5' }],
        'base': ['14px', { lineHeight: '1.5' }],
        'lg': ['16px', { lineHeight: '1.5' }],
        'xl': ['18px', { lineHeight: '1.3' }],
        '2xl': ['20px', { lineHeight: '1.2' }],
        '3xl': ['24px', { lineHeight: '1.2' }],
        '4xl': ['28px', { lineHeight: '1.1' }],
      },
      // 字体家族
      fontFamily: {
        'display': ['Satoshi', 'Noto Sans SC', 'sans-serif'],
        'body': ['DM Sans', 'Noto Sans SC', 'sans-serif'],
        'mono': ['Geist Mono', 'JetBrains Mono', 'monospace'],
      },
      // 间距系统 (8倍数)
      spacing: {
        '18': '72px',
        '22': '88px',
      },
      // 动画时长
      transitionDuration: {
        'micro': '100ms',
        'short': '150ms',
        'medium': '250ms',
      },
    }
  },
  plugins: []
};
