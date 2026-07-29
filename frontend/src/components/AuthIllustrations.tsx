/**
 * 登录/注册页面共享组件
 * - RobotIcon：蓝紫渐变 AI 机器人图标
 * - Captcha：Canvas 验证码组件
 * - generateCaptcha：验证码生成器
 * - LeftIllustration：左侧教育科技插画
 * - RightIllustration：右侧学习场景插画
 */

import React, { useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════
// 机器人 SVG 图标
// ═══════════════════════════════════════════════════════════

export const RobotIcon: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg viewBox="0 0 80 80" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="rbGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3B6FF5" />
        <stop offset="100%" stopColor="#8B5CF6" />
      </linearGradient>
      <filter id="rbShadow">
        <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#3B6FF5" floodOpacity="0.3" />
      </filter>
    </defs>
    <line x1="40" y1="6" x2="40" y2="16" stroke="url(#rbGrad)" strokeWidth="3" strokeLinecap="round" />
    <circle cx="40" cy="5" r="4.5" fill="url(#rbGrad)" />
    <rect x="24" y="16" width="32" height="24" rx="7" fill="url(#rbGrad)" filter="url(#rbShadow)" />
    <circle cx="33" cy="28" r="3.5" fill="#fff" />
    <circle cx="47" cy="28" r="3.5" fill="#fff" />
    <path d="M32 34 Q40 39 48 34" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.9" />
    <rect x="36" y="40" width="8" height="6" rx="2" fill="url(#rbGrad)" />
    <rect x="18" y="44" width="44" height="28" rx="8" fill="url(#rbGrad)" filter="url(#rbShadow)" />
    <line x1="28" y1="54" x2="52" y2="54" stroke="#fff" strokeWidth="1.2" opacity="0.3" strokeLinecap="round" />
    <rect x="8" y="48" width="10" height="18" rx="5" fill="url(#rbGrad)" />
    <rect x="62" y="48" width="10" height="18" rx="5" fill="url(#rbGrad)" />
    <rect x="26" y="72" width="10" height="8" rx="3" fill="url(#rbGrad)" />
    <rect x="44" y="72" width="10" height="8" rx="3" fill="url(#rbGrad)" />
  </svg>
);

// ═══════════════════════════════════════════════════════════
// 验证码组件
// ═══════════════════════════════════════════════════════════

export const Captcha: React.FC<{ value: string; onRefresh: () => void }> = ({ value, onRefresh }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#f0f5ff';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(59, 111, 245, ${0.1 + Math.random() * 0.2})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.random() * w, Math.random() * h);
      ctx.lineTo(Math.random() * w, Math.random() * h);
      ctx.stroke();
    }

    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.1})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    const chars = value.split('');
    chars.forEach((ch, i) => {
      const x = 10 + i * 22 + Math.random() * 6;
      const y = 22 + Math.random() * 6;
      ctx.font = `${18 + Math.random() * 4}px monospace`;
      ctx.fillStyle = `hsl(${200 + Math.random() * 40}, 70%, ${30 + Math.random() * 20}%)`;
      ctx.textBaseline = 'middle';
      const angle = (Math.random() - 0.5) * 0.4;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
  }, [value]);

  return (
    <canvas
      ref={canvasRef}
      width={120} height={42}
      style={{
        borderRadius: 8, cursor: 'pointer',
        border: '1px solid rgba(59, 111, 245, 0.2)',
        display: 'block', transition: 'all 0.3s',
      }}
      onClick={onRefresh} title="点击刷新验证码"
    />
  );
};

export const generateCaptcha = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 4; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
};

// ═══════════════════════════════════════════════════════════
// 左侧 — AI 教育科技插画
// ═══════════════════════════════════════════════════════════

export const LeftIllustration: React.FC = () => (
  <svg viewBox="0 0 420 600" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"
    style={{ maxWidth: 420, maxHeight: 600, opacity: 0.55 }}>
    <defs>
      <linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3B6FF5" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.15" />
      </linearGradient>
      <linearGradient id="lg2" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#5B8AF7" stopOpacity="0.25" />
        <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.12" />
      </linearGradient>
    </defs>

    {/* ── 背景光晕 ── */}
    <circle cx="210" cy="300" r="180" fill="url(#lg1)" opacity="0.6" />
    <circle cx="160" cy="200" r="100" fill="url(#lg2)" opacity="0.4" />

    {/* ── 几何节点网络 ── */}
    <g stroke="rgba(59,111,245,0.18)" strokeWidth="1" fill="none">
      <line x1="60" y1="120" x2="180" y2="200" />
      <line x1="180" y1="200" x2="240" y2="150" />
      <line x1="240" y1="150" x2="330" y2="180" />
      <line x1="180" y1="200" x2="160" y2="300" />
      <line x1="240" y1="150" x2="300" y2="260" />
      <line x1="160" y1="300" x2="200" y2="400" />
      <line x1="300" y1="260" x2="280" y2="380" />
      <line x1="80" y1="350" x2="160" y2="300" />
      <line x1="200" y1="400" x2="260" y2="480" />
      <line x1="120" y1="460" x2="200" y2="400" />
      <line x1="280" y1="380" x2="320" y2="480" />
    </g>

    {/* 节点圆点 */}
    {[
      [60, 120], [180, 200], [240, 150], [330, 180],
      [160, 300], [300, 260], [200, 400], [280, 380],
      [80, 350], [260, 480], [120, 460], [320, 480],
    ].map(([cx, cy], i) => (
      <circle key={i} cx={cx} cy={cy} r={i < 4 ? 5 : 4}
        fill="#3B6FF5" opacity={0.3 + i * 0.02} />
    ))}

    {/* ── 翻开书本 ── */}
    <g transform="translate(210, 300)">
      {/* 左页 */}
      <path d="M-65,-35 Q-35,-45 0,-40 L0,55 Q-35,50 -65,55 Z"
        fill="rgba(59,111,245,0.12)" stroke="rgba(59,111,245,0.25)" strokeWidth="1.5" />
      {/* 右页 */}
      <path d="M0,-40 Q35,-45 65,-35 L65,55 Q35,50 0,55 Z"
        fill="rgba(139,92,246,0.1)" stroke="rgba(139,92,246,0.2)" strokeWidth="1.5" />
      {/* 书脊 */}
      <line x1="0" y1="-42" x2="0" y2="58" stroke="rgba(91,111,245,0.3)" strokeWidth="2" />
      {/* 内页线条 */}
      <line x1="-45" y1="-18" x2="-10" y2="-20" stroke="rgba(59,111,245,0.2)" strokeWidth="0.8" />
      <line x1="-45" y1="-6" x2="-10" y2="-8" stroke="rgba(59,111,245,0.2)" strokeWidth="0.8" />
      <line x1="10" y1="-20" x2="45" y2="-18" stroke="rgba(139,92,246,0.2)" strokeWidth="0.8" />
      <line x1="10" y1="-8" x2="45" y2="-6" stroke="rgba(139,92,246,0.2)" strokeWidth="0.8" />
    </g>

    {/* ── 上方 AI 机器人 ── */}
    <g transform="translate(210, 110)" opacity="0.65">
      <rect x="-14" y="-8" width="28" height="22" rx="6" fill="rgba(59,111,245,0.2)" stroke="rgba(59,111,245,0.3)" strokeWidth="1" />
      <circle cx="-6" cy="3" r="3" fill="rgba(59,111,245,0.35)" />
      <circle cx="6" cy="3" r="3" fill="rgba(59,111,245,0.35)" />
      <path d="M-5 8 Q0 12 5 8" stroke="rgba(59,111,245,0.3)" strokeWidth="1" fill="none" />
      <line x1="0" y1="-16" x2="0" y2="-8" stroke="rgba(59,111,245,0.25)" strokeWidth="2" />
      <circle cx="0" cy="-18" r="4" fill="rgba(59,111,245,0.2)" stroke="rgba(59,111,245,0.3)" strokeWidth="1" />
    </g>

    {/* ── 学士帽 ── */}
    <g transform="translate(100, 180)" opacity="0.4">
      <path d="M-18,-4 L0,-14 L18,-4 L14,-2 L0,-11 L-14,-2 Z"
        fill="rgba(59,111,245,0.3)" stroke="rgba(59,111,245,0.25)" strokeWidth="1" />
      <rect x="-2" y="-4" width="4" height="18" rx="2" fill="rgba(59,111,245,0.2)" />
    </g>

    {/* ── 数据流动线条 ── */}
    <g fill="none" strokeWidth="1.5" strokeLinecap="round">
      <path d="M330,140 Q360,190 340,230 Q320,270 350,310"
        stroke="rgba(59,111,245,0.18)" strokeDasharray="6,4" />
      <path d="M70,420 Q100,450 90,490 Q80,530 110,560"
        stroke="rgba(139,92,246,0.15)" strokeDasharray="5,5" />
      <path d="M340,400 Q370,430 350,480"
        stroke="rgba(59,111,245,0.14)" strokeDasharray="4,6" />
    </g>

    {/* ── 浮动科技圆点 ── */}
    {[
      [80, 100, 3], [320, 90, 4], [370, 230, 3], [50, 280, 2],
      [350, 360, 3], [70, 500, 4], [310, 540, 3], [140, 140, 2],
    ].map(([cx, cy, r], i) => (
      <circle key={`d${i}`} cx={cx} cy={cy} r={r}
        fill="none" stroke="rgba(139,92,246,0.25)" strokeWidth="1" opacity={0.5 + i * 0.04} />
    ))}

    {/* ── 六边形装饰 ── */}
    {[[310, 120, 16], [100, 420, 12], [340, 460, 14]].map(([cx, cy, r], i) => (
      <g key={`h${i}`} transform={`translate(${cx},${cy})`} opacity={0.2 + i * 0.05}>
        <polygon
          points={`0,${-r} ${r * 0.87},${-r / 2} ${r * 0.87},${r / 2} 0,${r} ${-r * 0.87},${r / 2} ${-r * 0.87},${-r / 2}`}
          fill="none" stroke="rgba(59,111,245,0.3)" strokeWidth="1"
        />
      </g>
    ))}
  </svg>
);

// ═══════════════════════════════════════════════════════════
// 右侧 — 科技学习场景插画
// ═══════════════════════════════════════════════════════════

export const RightIllustration: React.FC = () => (
  <svg viewBox="0 0 420 600" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"
    style={{ maxWidth: 420, maxHeight: 600, opacity: 0.55 }}>
    <defs>
      <linearGradient id="rg1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#7C5CFC" stopOpacity="0.3" />
        <stop offset="100%" stopColor="#3B6FF5" stopOpacity="0.12" />
      </linearGradient>
      <linearGradient id="rg2" x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.2" />
        <stop offset="100%" stopColor="#5B8AF7" stopOpacity="0.08" />
      </linearGradient>
    </defs>

    {/* ── 背景光晕 ── */}
    <circle cx="210" cy="300" r="180" fill="url(#rg1)" opacity="0.5" />
    <circle cx="260" cy="180" r="120" fill="url(#rg2)" opacity="0.35" />

    {/* ── 云朵装饰 ── */}
    <g opacity="0.25">
      {/* 云1 */}
      <ellipse cx="100" cy="100" rx="50" ry="22" fill="rgba(139,92,246,0.15)" />
      <ellipse cx="130" cy="85" rx="35" ry="20" fill="rgba(139,92,246,0.12)" />
      <ellipse cx="70" cy="90" rx="30" ry="18" fill="rgba(139,92,246,0.1)" />
      {/* 云2 */}
      <ellipse cx="320" cy="420" rx="45" ry="20" fill="rgba(59,111,245,0.12)" />
      <ellipse cx="345" cy="405" rx="30" ry="18" fill="rgba(59,111,245,0.1)" />
      <ellipse cx="295" cy="410" rx="28" ry="16" fill="rgba(59,111,245,0.08)" />
      {/* 云3 */}
      <ellipse cx="80" cy="500" rx="38" ry="16" fill="rgba(139,92,246,0.1)" />
      <ellipse cx="105" cy="490" rx="28" ry="14" fill="rgba(139,92,246,0.08)" />
    </g>

    {/* ── 学生伏案学习 ── */}
    <g transform="translate(210, 340)" opacity="0.5">
      {/* 书桌 */}
      <rect x="-55" y="15" width="110" height="10" rx="4"
        fill="rgba(59,111,245,0.15)" stroke="rgba(59,111,245,0.2)" strokeWidth="1" />
      {/* 桌腿 */}
      <line x1="-40" y1="25" x2="-40" y2="60" stroke="rgba(59,111,245,0.15)" strokeWidth="3" strokeLinecap="round" />
      <line x1="40" y1="25" x2="40" y2="60" stroke="rgba(59,111,245,0.15)" strokeWidth="3" strokeLinecap="round" />

      {/* 笔记本电脑屏幕 */}
      <rect x="-20" y="-20" width="40" height="26" rx="4"
        fill="rgba(59,111,245,0.12)" stroke="rgba(59,111,245,0.25)" strokeWidth="1.2" />
      {/* 屏幕发光 */}
      <rect x="-16" y="-16" width="32" height="18" rx="2" fill="rgba(91,138,247,0.15)" />
      {/* 屏幕代码行 */}
      <line x1="-12" y1="-10" x2="8" y2="-10" stroke="rgba(59,111,245,0.2)" strokeWidth="1" />
      <line x1="-12" y1="-5" x2="4" y2="-5" stroke="rgba(139,92,246,0.15)" strokeWidth="1" />
      <line x1="-12" y1="0" x2="10" y2="0" stroke="rgba(59,111,245,0.13)" strokeWidth="1" />
      {/* 键盘底座 */}
      <line x1="-25" y1="10" x2="25" y2="10" stroke="rgba(59,111,245,0.15)" strokeWidth="1.5" />

      {/* 学生头部 */}
      <circle cx="-28" cy="-32" r="10" fill="rgba(91,111,245,0.2)" stroke="rgba(59,111,245,0.22)" strokeWidth="1" />
      {/* 身体 */}
      <path d="M-36,-22 Q-28,-16 -20,-22 L-18,10 Q-28,16 -38,10 Z"
        fill="rgba(59,111,245,0.15)" />
      {/* 手臂 */}
      <line x1="-20" y1="-15" x2="-10" y2="5" stroke="rgba(59,111,245,0.18)" strokeWidth="3" strokeLinecap="round" />
    </g>

    {/* ── 虚拟交互界面面板 ── */}
    <g opacity="0.35">
      {/* 面板1 */}
      <rect x="50" y="160" width="70" height="50" rx="8"
        fill="rgba(255,255,255,0.5)" stroke="rgba(139,92,246,0.25)" strokeWidth="1" />
      <rect x="58" y="170" width="54" height="4" rx="2" fill="rgba(139,92,246,0.2)" />
      <rect x="58" y="180" width="40" height="3" rx="1.5" fill="rgba(59,111,245,0.15)" />
      <rect x="58" y="188" width="48" height="3" rx="1.5" fill="rgba(59,111,245,0.12)" />
      <circle cx="108" cy="192" r="10" fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="1" strokeDasharray="3,2" />

      {/* 面板2 */}
      <rect x="300" y="200" width="60" height="44" rx="8"
        fill="rgba(255,255,255,0.45)" stroke="rgba(59,111,245,0.2)" strokeWidth="1" />
      <circle cx="330" cy="218" r="12" fill="none" stroke="rgba(59,111,245,0.2)" strokeWidth="1.5" />
      <circle cx="330" cy="218" r="6" fill="rgba(59,111,245,0.12)" />
      <line x1="316" y1="234" x2="344" y2="234" stroke="rgba(59,111,245,0.15)" strokeWidth="1" />

      {/* 面板3 */}
      <rect x="60" y="250" width="55" height="20" rx="6"
        fill="rgba(139,92,246,0.08)" stroke="rgba(139,92,246,0.2)" strokeWidth="0.8" />
      <circle cx="75" cy="260" r="4" fill="rgba(59,111,245,0.2)" />
      <line x1="84" y1="258" x2="105" y2="258" stroke="rgba(139,92,246,0.2)" strokeWidth="1" />
      <line x1="84" y1="263" x2="100" y2="263" stroke="rgba(139,92,246,0.15)" strokeWidth="1" />
    </g>

    {/* ── 渐变光带 ── */}
    <g opacity="0.2">
      <path d="M330,60 Q360,100 340,140 Q320,180 350,220"
        stroke="url(#rg1)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M100,380 Q80,420 100,460 Q120,500 90,540"
        stroke="url(#rg2)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M380,330 Q360,360 380,390"
        stroke="rgba(139,92,246,0.15)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </g>

    {/* ── 星光点 ── */}
    {[
      [370, 80, 3], [340, 160, 2], [90, 140, 3], [380, 270, 2],
      [70, 340, 2], [360, 440, 3], [110, 550, 2], [340, 550, 3],
    ].map(([cx, cy, r], i) => (
      <g key={`s${i}`} transform={`translate(${cx},${cy})`} opacity={0.3 + i * 0.04}>
        {/* 四角星 */}
        <path d={`M0,${-r} L${r * 0.3},${-r * 0.3} L${r},0 L${r * 0.3},${r * 0.3} L0,${r} L${-r * 0.3},${r * 0.3} L${-r},0 L${-r * 0.3},${-r * 0.3} Z`}
          fill="rgba(139,92,246,0.35)" />
      </g>
    ))}

    {/* ── 浮动科技圆环 ── */}
    {[[100, 200, 18], [310, 340, 14], [370, 480, 12], [140, 460, 16]].map(([cx, cy, r], i) => (
      <circle key={`c${i}`} cx={cx} cy={cy} r={r}
        fill="none" stroke="rgba(59,111,245,0.15)" strokeWidth="1"
        strokeDasharray={i % 2 === 0 ? "4,3" : "2,4"} opacity={0.3 + i * 0.05} />
    ))}

    {/* ── 小方块装饰 ── */}
    {[[340, 110, 5], [80, 170, 4], [310, 290, 5], [130, 390, 4]].map(([x, y, s], i) => (
      <rect key={`sq${i}`} x={x} y={y} width={s} height={s} rx={1.5}
        fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="0.8"
        opacity={0.25 + i * 0.03}
        transform={`rotate(${15 + i * 20}, ${x + s / 2}, ${y + s / 2})`} />
    ))}
  </svg>
);
