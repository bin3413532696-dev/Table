module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './index.html'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主色系统 #165DFF
        primary: {
          DEFAULT: '#165DFF',
          50: '#E8F1FF',
          100: '#D1E3FF',
          200: '#A3C7FF',
          300: '#75ABFF',
          400: '#478FFF',
          500: '#165DFF',
          600: '#124ACC',
          700: '#0D3899',
          800: '#092666',
          900: '#041333',
        },
        // 语义色
        success: {
          DEFAULT: '#00B42A',
          light: '#E8FFEA',
          dark: '#009922',
        },
        warning: {
          DEFAULT: '#FF7D00',
          light: '#FFF7E8',
          dark: '#CC6400',
        },
        error: {
          DEFAULT: '#F53F3F',
          light: '#FFECE8',
          dark: '#CB272D',
        },
        // 中性色阶
        neutral: {
          50: '#FAFAFA',
          100: '#F5F5F5',
          200: '#EEEEEE',
          300: '#E0E0E0',
          400: '#BDBDBD',
          500: '#9E9E9E',
          600: '#757575',
          700: '#616161',
          800: '#424242',
          900: '#212121',
        },
        // 语义化背景/文字/边框
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        'bg-card': 'var(--bg-card)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'border-primary': 'var(--border-primary)',
        'border-secondary': 'var(--border-secondary)',
      },
      // 圆角系统
      borderRadius: {
        'sm': '4px',
        'DEFAULT': '6px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '20px',
      },
      // 阴影系统 (轻量拟态)
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'DEFAULT': '0 2px 4px 0 rgba(0, 0, 0, 0.06)',
        'md': '0 4px 8px 0 rgba(0, 0, 0, 0.08)',
        'lg': '0 8px 16px 0 rgba(0, 0, 0, 0.10)',
        'card': '0 2px 8px 0 rgba(0, 0, 0, 0.04)',
        'card-hover': '0 4px 12px 0 rgba(0, 0, 0, 0.08)',
      },
      // 字体大小系统
      fontSize: {
        'xs': ['12px', { lineHeight: '1.5' }],
        'sm': ['14px', { lineHeight: '1.5' }],
        'base': ['14px', { lineHeight: '1.5' }],
        'lg': ['16px', { lineHeight: '1.5' }],
        'xl': ['18px', { lineHeight: '1.2' }],
        '2xl': ['20px', { lineHeight: '1.2' }],
        '3xl': ['24px', { lineHeight: '1.2' }],
        '4xl': ['28px', { lineHeight: '1.2' }],
      },
      // 间距系统 (8倍数)
      spacing: {
        '18': '72px',
        '22': '88px',
      },
    }
  },
  plugins: []
};