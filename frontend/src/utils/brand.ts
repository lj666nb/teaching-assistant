/**
 * Edu-TA 智教星 — 品牌视觉规范
 *
 * 品牌标识：融合代码括号 {} + 书本教案 + AI 芯片
 * 品牌色：深海科技蓝 #0F52BA、教研紫 #7B61FF、成绩绿 #36D399、预警橙 #FF9F43
 */

export const BRAND = {
  // ── 品牌识别 ──
  name: 'Edu-TA 智教星',
  shortName: '智教星',
  tagline: 'AI 课程教学 · 智能助教系统',
  watermark: '智教星智能助教 · 高校教研专属',

  // ── 品牌色板 ──
  colors: {
    // 主色
    primary: '#0F52BA',
    primaryLight: '#1A6BE0',
    primaryDark: '#0B3D8A',
    primaryGradient: 'linear-gradient(135deg, #0F52BA 0%, #7B61FF 100%)',

    // 辅助色
    purple: '#7B61FF',
    purpleLight: '#A394FF',
    green: '#36D399',
    greenLight: '#5EE8B0',
    orange: '#FF9F43',
    orangeLight: '#FFB976',

    // 语义色
    success: '#36D399',
    warning: '#FF9F43',
    error: '#FF6B6B',
    info: '#0F52BA',

    // 中性色
    textPrimary: '#1A1A2E',
    textSecondary: '#6B7280',
    textTertiary: '#9CA3AF',
    bgBody: '#F0F4FF',
    bgCard: '#FFFFFF',
    border: '#E8EEF8',
  },

  // ── Logo SVG (代码括号 {} + 书本 + AI 芯片) ──
  logoSvg: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="10" fill="url(#logoGrad)"/>
    <path d="M12 14L8 20L12 26" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M28 14L32 20L28 26" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="16" y="13" width="8" height="14" rx="2" stroke="white" stroke-width="2" fill="rgba(255,255,255,0.15)"/>
    <circle cx="20" cy="20" r="3" fill="white" opacity="0.9"/>
    <path d="M20 17V23M17 20H23" stroke="#0F52BA" stroke-width="1.5" stroke-linecap="round"/>
    <defs><linearGradient id="logoGrad" x1="0" y1="0" x2="40" y2="40"><stop stop-color="#0F52BA"/><stop offset="1" stop-color="#7B61FF"/></linearGradient></defs>
  </svg>`,

  // ── 角标小图标（用于卡片角标） ──
  badgeSvg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M5 6L3 8L5 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M11 6L13 8L11 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <rect x="6.5" y="5.5" width="3" height="5" rx="0.8" stroke="currentColor" stroke-width="1.2" fill="none"/>
  </svg>`,

  // ── 品牌纹样（代码流暗纹，Base64 编码的重复背景） ──
  codePattern: `data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%230F52BA' fill-opacity='0.03'%3E%3Ctext x='5' y='15' font-size='10'%3E%7B%7D%3C/text%3E%3Ctext x='35' y='35' font-size='8'%3E010%3C/text%3E%3Ctext x='10' y='50' font-size='7'%3EAI%3C/text%3E%3Ctext x='40' y='12' font-size='6'%3E%26lt;/%26gt;%3C/text%3E%3C/g%3E%3C/g%3E%3C/svg%3E`,

  // ── 二进制纹样 ──
  binaryPattern: `data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%230F52BA' fill-opacity='0.02'%3E%3Ctext x='5' y='15' font-size='8'%3E01001%3C/text%3E%3Ctext x='25' y='35' font-size='7'%3E101%3C/text%3E%3Ctext x='45' y='55' font-size='8'%3E11010%3C/text%3E%3Ctext x='10' y='70' font-size='6'%3E001%3C/text%3E%3C/g%3E%3C/svg%3E`,
} as const;

// ── 卡片尺寸规范 ──
export const CARD_SPECS = {
  borderRadius: 12,
  shadow: '0 2px 12px rgba(15, 82, 186, 0.08)',
  shadowHover: '0 8px 32px rgba(15, 82, 186, 0.15)',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  padding: '20px 24px',
} as const;

// ── 动效参数 ──
export const ANIMATION = {
  duration: { fast: 0.2, normal: 0.3, slow: 0.5 },
  timing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  hover: 'translateY(-2px)',
} as const;
