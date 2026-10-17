/** @type {import('tailwindcss').Config} */
// 配色按设计稿：明亮蓝主色 + 冷白底 + 深墨蓝文字。accent 只用于 L2 任务类强调。
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F4F7FB',      // 页面底色
        card: '#FFFFFF',
        sand: '#E7ECF3',       // 分隔/弱底
        ink: { DEFAULT: '#18212F', soft: '#5B6676', faint: '#98A2B3' },
        brand: { DEFAULT: '#2F7CF6', deep: '#1D63D8', soft: '#D9E7FE', mist: '#EEF4FF' },
        accent: { DEFAULT: '#F08A24', soft: '#FFF1E2' },
        warn: { DEFAULT: '#C77700', soft: '#FFF4DC' },
        danger: { DEFAULT: '#F04B4B', soft: '#FEE9E9' },
        ok: { DEFAULT: '#22A06B', soft: '#E3F6EC' },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Noto Sans SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        hand: ['"Ma Shan Zheng"', '"STKaiti"', '"KaiTi"', 'cursive'],
      },
      borderRadius: { card: '16px', sheet: '24px', btn: '14px' },
      boxShadow: {
        card: '0 1px 2px rgba(24,33,47,.04), 0 8px 24px -12px rgba(24,33,47,.14)',
        float: '0 12px 28px -10px rgba(47,124,246,.45)',
      },
    },
  },
  plugins: [],
};
