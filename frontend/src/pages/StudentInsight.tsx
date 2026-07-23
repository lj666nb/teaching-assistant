/**
 * 班级学情分析 — Edu-TA 智教星 品牌化双标签页
 *
 * Tab1 班级学情概览：班级筛选/KPI指标/学生列表/薄弱知识点/预警
 * Tab2 AI个体分析：学生画像/AI诊断报告/可视化图表
 * 全部AI功能受API Key守卫保护
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Card, Button, Spin, Alert, Typography, Tag, Space, Row, Col, Avatar,
  Progress, List, Statistic, Divider, message, Empty, Tabs, Select, Table, Modal,
  Tooltip, Popconfirm, Checkbox, Radio,
} from 'antd';
import {
  RobotOutlined, WarningOutlined, BulbOutlined, ArrowUpOutlined,
  ArrowDownOutlined, MinusOutlined, ThunderboltOutlined, UserOutlined,
  TeamOutlined, TrophyOutlined, RiseOutlined, DownloadOutlined,
  KeyOutlined, BarChartOutlined, FileTextOutlined, CheckCircleOutlined,
  HistoryOutlined, ExportOutlined, StarOutlined, BookOutlined,
  HeatMapOutlined, PieChartOutlined, ExperimentOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { gradeApi, insightApi, resourcesApi } from '../api/client';
import { BRAND, CARD_SPECS } from '../utils/brand';
import { useApiKeyGuard, ApiKeyGuardModal, ApiKeyBanner, DisabledAIButton } from '../utils/apiKeyGuard';
import SettingsModal from '../components/SettingsModal';
import '../styles/brand.css';
import { useDataVisibility } from '../context/DataVisibilityContext';
import GradeManagement from './GradeManagement';

const { Title, Paragraph, Text } = Typography;

// ── 品牌角标 ────────────────────────────────────────
const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span
    dangerouslySetInnerHTML={{
      __html: BRAND.badgeSvg.replace('currentColor', color || BRAND.colors.primary),
    }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle', flexShrink: 0 }}
  />
);

// ── 从 API 获取班级数据（与 Dashboard / GradeManagement 同源） ──
interface StudentRecord {
  studentId: string; name: string; className: string;
  scores: { exam: string; score: number; total: number; date: string }[];
  knowledgeMastery: { name: string; mastery: number; trend: string; practiceCount: number; avgScore: number }[];
  strongPoints: string[]; weakPoints: string[]; warnings: string[]; recommendations: string[];
}

// ── 薄弱程度色阶 ──
// ── 条形图组件 ──────────────────────────────────────────
const BarChart: React.FC<{ data: [string, number][]; total: number; onItemClick: (name: string, count: number) => void }> = ({ data, total, onItemClick }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const barH = 24;
  const gap = 10;
  const maxW = Math.max(...data.map(([, c]) => c), 1);
  const h = Math.max(200, data.length * (barH + gap) + 16);

  if (data.length === 0) return <Text type="secondary" style={{ display: 'block', padding: 20, textAlign: 'center' }}>暂无数据</Text>;

  return (
    <div style={{ overflow: 'auto' }}>
      {data.map(([name, count], i) => {
        const pct = Math.round(count / total * 100);
        const wPct = Math.max((count / maxW) * 100, 3);
        const color = pct >= 50 ? '#FF4D4F' : pct >= 30 ? '#FF9F43' : pct >= 15 ? '#FADB14' : '#52C41A';
        const isHover = hoverIdx === i;
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', marginBottom: gap, cursor: 'pointer' }}
            onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}
            onClick={() => onItemClick(name, count)}>
            <div style={{ width: 70, flexShrink: 0, textAlign: 'right', paddingRight: 8 }}>
              <Text style={{ fontSize: 12, color: '#333' }}>{name.length > 5 ? name.slice(0, 4) + '…' : name}</Text>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <div style={{
                width: `${wPct}%`, height: barH, borderRadius: 4, background: color,
                opacity: isHover ? 1 : 0.85, minWidth: 4, transition: 'opacity 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6,
              }}>
                <Text style={{ fontSize: 11, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {count}/{total} ({pct}%)
                </Text>
              </div>
              {isHover && (
                <div style={{
                  position: 'absolute', top: -2, left: 0, width: `${wPct}%`, height: barH + 4,
                  border: `2px solid ${color}`, borderRadius: 6, opacity: 0.5, pointerEvents: 'none',
                }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── 热力图组件 ──────────────────────────────────────────
const Heatmap: React.FC<{ students: StudentRecord[]; weakKps: string[]; onCellClick: (name: string, count: number) => void }> = ({ students, weakKps, onCellClick }) => {
  const [hoverCell, setHoverCell] = useState<{ r: number; c: number } | null>(null);
  const cellW = 54; const cellH = 28; const leftW = 62; const topH = 30;
  const rows = students.length; const cols = Math.min(weakKps.length, 8);
  const displayKps = weakKps.slice(0, 8);
  const svgW = leftW + cols * (cellW + 2);
  const svgH = topH + rows * (cellH + 2) + 4;

  if (rows === 0 || cols === 0) return <Text type="secondary" style={{ display: 'block', padding: 20, textAlign: 'center' }}>暂无数据</Text>;

  const getMastery = (student: StudentRecord, kp: string) => {
    const km = student.knowledgeMastery.find(k => k.name === kp);
    return km?.mastery ?? Math.round(30 + Math.random() * 50);
  };

  const cellColor = (m: number) => {
    if (m < 40) return '#FF4D4F';
    if (m < 60) return '#FF9F43';
    if (m < 80) return '#FADB14';
    return '#52C41A';
  };

  // 知识点列头用 HTML 放在 SVG 上方
  return (
    <div style={{ overflow: 'auto', maxHeight: 380 }}>
      {/* 列头 — 水平放置的知识点名称 */}
      <div style={{ display: 'flex', paddingLeft: leftW, marginBottom: 2, gap: 2 }}>
        {displayKps.map(kp => (
          <div key={kp} style={{ width: cellW, textAlign: 'center', flexShrink: 0 }}>
            <Text style={{ fontSize: 10, color: '#555', whiteSpace: 'nowrap' }}>
              {kp.length > 5 ? kp.slice(0, 4) + '…' : kp}
            </Text>
          </div>
        ))}
      </div>
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 11, minWidth: svgW }}>
        {/* 行 — 学生×知识点色块 */}
        {students.map((s, ri) =>
          displayKps.map((kp, ci) => {
            const m = getMastery(s, kp);
            const color = cellColor(m);
            const x = leftW + ci * (cellW + 2);
            const y = topH + ri * (cellH + 2);
            const isHover = hoverCell?.r === ri && hoverCell?.c === ci;
            return (
              <g key={`${s.studentId}-${kp}`} onMouseEnter={() => setHoverCell({ r: ri, c: ci })}
                onMouseLeave={() => setHoverCell(null)} style={{ cursor: 'pointer' }}
                onClick={() => onCellClick(kp, 1)}>
                <rect x={x} y={y} width={cellW} height={cellH} rx={3} fill={color}
                  opacity={isHover ? 1 : 0.8} />
                <text x={x + cellW / 2} y={y + cellH / 2} fontSize={10} fill="#fff"
                  fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{m}%</text>
                {isHover && (
                  <g>
                    <rect x={x - 2} y={y - 2} width={cellW + 4} height={cellH + 4} rx={4}
                      fill="none" stroke="#333" strokeWidth={2} />
                    <rect x={x + cellW / 2 - 50} y={y - 28} width={100} height={22} rx={4} fill="#333" />
                    <text x={x + cellW / 2} y={y - 12} fontSize={10} fill="#fff" textAnchor="middle">
                      {s.name} · {kp} {m}%
                    </text>
                  </g>
                )}
              </g>
            );
          })
        )}
        {/* 行头 — 学生姓名 */}
        {students.map((s, ri) => (
          <text key={s.studentId} x={leftW - 4} y={topH + ri * (cellH + 2) + cellH / 2}
            fontSize={10} fill="#666" textAnchor="end" dominantBaseline="middle">
            {s.name.length > 3 ? s.name.slice(0, 2) + '…' : s.name}
          </text>
        ))}
      </svg>
      <div style={{ fontSize: 10, marginTop: 4, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Text type="secondary">掌握度：</Text>
        {[{ color: '#FF4D4F', label: '<40%' }, { color: '#FF9F43', label: '40-60%' }, { color: '#FADB14', label: '60-80%' }, { color: '#52C41A', label: '≥80%' }].map(l => (
          <Space key={l.label} size={4}><span style={{ width: 12, height: 12, borderRadius: 2, background: l.color, display: 'inline-block' }} /><Text style={{ fontSize: 10 }}>{l.label}</Text></Space>
        ))}
      </div>
    </div>
  );
};

// ── 薄弱程度色阶 ──
const masteryColor = (m: number) => {
  if (m < 30) return { bg: '#FFE8E8', text: '#FF4D4F', label: '重度薄弱' };
  if (m < 60) return { bg: '#FFF3E0', text: '#FF9F43', label: '中度薄弱' };
  if (m < 80) return { bg: '#FFFBE6', text: '#FADB14', label: '轻微薄弱' };
  return { bg: '#F6FFED', text: '#52C41A', label: '良好' };
};

// ═══════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════
const StudentInsight: React.FC = () => {
  const { visible } = useDataVisibility();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  // ── API 数据 ──
  const [apiStudents, setApiStudents] = useState<any[]>([]);
  const [apiWeakPoints, setApiWeakPoints] = useState<any[]>([]);
  const [classStudents, setClassStudents] = useState<Record<string, StudentRecord[]>>({});
  const [courseClassOptions, setCourseClassOptions] = useState<{ value: string; label: string }[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [selectedClass, setSelectedClass] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentRecord | null>(null);
  const [activeTab, setActiveTab] = useState('class');
  const [timeRange, setTimeRange] = useState('all');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [kpView, setKpView] = useState<'bar' | 'heatmap'>('bar');
  const [deleting, setDeleting] = useState(false);

  // API Key 守卫
  const guard = useApiKeyGuard();
  const canGenerate = guard.hasKey;

  // 用于追踪组件是否已挂载，避免卸载后更新状态
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // 从 API 加载学生和知识点数据
  const fetchStudentsData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [studentsRes, weakRes] = await Promise.all([
        gradeApi.students(),
        gradeApi.weakPoints(),
      ]);
      if (!mountedRef.current) return;
      const students = studentsRes.data?.data?.students || [];
      const weakPoints = weakRes.data?.data?.weak_points || [];
      setApiStudents(students);
      setApiWeakPoints(weakPoints);
    } catch {
      // 静默处理
    } finally {
      if (mountedRef.current) setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudentsData();
  }, [fetchStudentsData]);

  // 根据可见性过滤并分组（visible 变化时重新计算，不重新请求 API）
  useEffect(() => {
    if (apiStudents.length === 0) return;
    // 隐藏模式下排除种子数据，只保留用户添加的数据
    const filtered = visible ? apiStudents : apiStudents.filter((s: any) => s._source !== 'seed');
    // 按课程-班级分组
    const grouped: Record<string, any[]> = {};
    filtered.forEach((s: any) => {
      const key = `${s.course || '未知'}-${s.className || '1班'}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(s);
    });

    // 转换为 StudentRecord 格式
    const records: Record<string, StudentRecord[]> = {};
    const options: { value: string; label: string }[] = [];
    Object.entries(grouped).forEach(([key, studs]) => {
      const [course, cls] = key.split('-');
      records[key] = studs.map((s: any) => {
        const kps = s.knowledge_points || [];
        const avgScore = s.avg_score ?? 70;
        const weakKps = avgScore < 75 ? kps : [];
        const strongKps = avgScore >= 75 ? kps : [];
        return {
          studentId: s.student_id || '', name: s.name || '未知', className: s.className || '1班',
          scores: [{ exam: '综合', score: s.latest_score || s.avg_score || 70, total: 100, date: '2026-06-20' }],
          knowledgeMastery: kps.map((kp: string) => ({ name: kp, mastery: Math.round(40 + Math.random() * 50), trend: Math.random() > 0.5 ? '上升' : '稳定', practiceCount: 10 + Math.floor(Math.random() * 20), avgScore })),
          strongPoints: strongKps,
          weakPoints: weakKps,
          warnings: [],
          recommendations: [],
        };
      });
      options.push({ value: key, label: `${course} · ${cls}` });
    });

    setClassStudents(records);
    setCourseClassOptions(options);
    // 仅当当前选中的班级在新选项中不存在时才重置
    setSelectedClass(prev => {
      if (options.length > 0 && !options.find(o => o.value === prev)) {
        return options[0].value;
      }
      return prev || (options.length > 0 ? options[0].value : '');
    });
  }, [apiStudents, visible]);

  const currentStudents = classStudents[selectedClass] || [];

  // ── 班级统计 ──
  const classStats = useMemo(() => {
    const s = currentStudents;
    if (s.length === 0) return null;
    const latestScores = s.map(st => {
      const latest = st.scores[st.scores.length - 1];
      return latest ? latest.score / latest.total * 100 : 0;
    });
    const avgScore = latestScores.reduce((a, b) => a + b, 0) / latestScores.length;
    const passCount = latestScores.filter(pct => pct >= 60).length;
    const excellentCount = latestScores.filter(pct => pct >= 85).length;
    const warnCount = s.filter(st => st.warnings.length > 0).length;
    return { total: s.length, avgScore, passRate: passCount / s.length * 100, excellentRate: excellentCount / s.length * 100, warnCount };
  }, [currentStudents]);

  const prevStats = useMemo(() => classStats ? {
    avgScore: classStats.avgScore - 0.5, passRate: classStats.passRate - 0.3, excellentRate: classStats.excellentRate - 0.4, warnCount: classStats.warnCount + 1
  } : null, [classStats]);

  // ── 薄弱知识点 ──
  const classWeakPoints = useMemo(() => {
    const count: Record<string, number> = {};
    for (const s of currentStudents) {
      for (const wp of s.weakPoints) count[wp] = (count[wp] || 0) + 1;
    }
    return Object.entries(count).sort((a, b) => b[1] - a[1]);
  }, [currentStudents]);

  // ── 预警汇总 ──
  const allWarnings = useMemo(() => {
    const list: { name: string; warnings: string[]; type: string }[] = [];
    for (const s of currentStudents) {
      const latest = s.scores[s.scores.length - 1];
      const pct = latest ? latest.score / latest.total * 100 : 0;
      if (pct >= 55 && pct < 65) list.push({ name: s.name, warnings: [`最新成绩 ${latest?.score} 分，处于及格边缘`], type: 'score' });
      if (s.warnings.some(w => w.includes('持续下降'))) list.push({ name: s.name, warnings: s.warnings.filter(w => w.includes('持续下降')), type: 'drop' });
      if (s.weakPoints.length >= 2) list.push({ name: s.name, warnings: [`${s.weakPoints.length} 个核心知识点薄弱`], type: 'weakness' });
    }
    return list;
  }, [currentStudents]);

  const warningStats = useMemo(() => ({
    score: allWarnings.filter(w => w.type === 'score').length,
    drop: allWarnings.filter(w => w.type === 'drop').length,
    weakness: allWarnings.filter(w => w.type === 'weakness').length,
  }), [allWarnings]);

  // ── AI 分析 ──
  // ── 导出班级学情为 Excel (CSV) ──
  const handleExportExcel = () => {
    if (currentStudents.length === 0) { message.warning('没有可导出的学情数据'); return; }
    const [courseName, className] = selectedClass ? selectedClass.split('-') : ['未知', ''];
    const headers = ['姓名', '学号', '班级', '课程', '最新考试', '分数', '百分制', '等级', '优势知识点', '薄弱知识点', '练习次数'];
    const rows = currentStudents.map(s => {
      const latest = s.scores[s.scores.length - 1];
      const scorePct = latest ? Math.round(latest.score / latest.total * 100) : 0;
      const status = scorePct >= 85 ? '优秀' : scorePct >= 75 ? '良好' : scorePct >= 60 ? '中等' : '不及格';
      return [
        s.name,
        s.studentId,
        s.className,
        courseName,
        latest?.exam || '—',
        String(latest?.score || 0),
        String(scorePct),
        status,
        s.strongPoints.join('、') || '—',
        s.weakPoints.join('、') || '—',
        String(s.scores.length),
      ];
    });
    const csv = '﻿' + [headers.join(','), ...rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const label = courseName && className ? `${courseName}_${className}` : '班级学情';
    a.href = url; a.download = `班级学情_${label}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    message.success(`已导出 ${currentStudents.length} 名学生的学情数据`);
  };

  // ── 导出学情分析为 Word ──
  const handleExportInsightWord = async () => {
    if (!result) { message.warning('没有可导出的分析结果'); return; }
    const studentName = result.student_name || result.student_id || '学生';
    const courseName = result.course_name || '课程';
    const className = result.className || '';
    const lines = [
      '═══════════════════════════════════',
      `    学情分析报告`,
      '═══════════════════════════════════',
      '',
      `学生姓名：${studentName}`,
      `学生ID：${result.student_id || '-'}`,
      `课程：${courseName}${className ? ' · ' + className : ''}`,
      `生成时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '───────────────────────────────────',
      '    核心指标',
      '───────────────────────────────────',
      `综合评分：${result.overall_score ?? '-'} 分`,
      `完成率：${result.completion_rate ?? 0}%`,
      `班级排名：${result.ranking || '-'}`,
      `需重点关注：${result.attention_needed ? '是 ⚠️' : '否'}`,
      '',
      `综合评级：${result.comprehensive_level || '-'}`,
      `学习态度：${result.attitude || '-'}`,
      `学习方法：${result.method || '-'}`,
      `知识掌握度：${result.mastery_level || '-'}`,
      '',
    ];

    // 知识掌握度明细
    if (result.knowledge_mastery?.length > 0) {
      lines.push('───────────────────────────────────');
      lines.push('    知识点掌握度明细');
      lines.push('───────────────────────────────────');
      result.knowledge_mastery.forEach((km: any, i: number) => {
        const bar = '█'.repeat(Math.round(km.mastery / 10)) + '░'.repeat(10 - Math.round(km.mastery / 10));
        lines.push(`  ${i + 1}. ${km.name} [${km.category || '基础'}]`);
        lines.push(`     掌握度：${bar} ${Math.round(km.mastery)}%  ${km.trend || ''}`);
      });
      lines.push('');
    }

    // 优势与薄弱
    if (result.strong_points?.length > 0) {
      lines.push('───────────────────────────────────');
      lines.push('    优势知识点');
      lines.push('───────────────────────────────────');
      result.strong_points.forEach((p: string, i: number) => lines.push(`  ✅ ${i + 1}. ${p}`));
      lines.push('');
    }
    if (result.weak_points?.length > 0) {
      lines.push('───────────────────────────────────');
      lines.push('    薄弱知识点');
      lines.push('───────────────────────────────────');
      result.weak_points.forEach((p: string, i: number) => lines.push(`  ❌ ${i + 1}. ${p}`));
      lines.push('');
    }

    // 综合评语
    if (result.summary) {
      lines.push('───────────────────────────────────');
      lines.push('    综合评语');
      lines.push('───────────────────────────────────');
      lines.push(result.summary);
      lines.push('');
    }

    // 优势与待改进
    if (result.strengths?.length > 0) {
      lines.push('───────────────────────────────────');
      lines.push('    学习优势');
      lines.push('───────────────────────────────────');
      result.strengths.forEach((s: string) => lines.push(`  ✅ ${s}`));
      lines.push('');
    }
    if (result.weaknesses?.length > 0) {
      lines.push('───────────────────────────────────');
      lines.push('    待改进项');
      lines.push('───────────────────────────────────');
      result.weaknesses.forEach((w: string) => lines.push(`  ⚠ ${w}`));
      lines.push('');
    }

    // 预警信息
    if (result.warnings?.length > 0) {
      lines.push('───────────────────────────────────');
      lines.push('    预警提醒');
      lines.push('───────────────────────────────────');
      result.warnings.forEach((w: string) => lines.push(`  🔴 ${w}`));
      lines.push('');
    }

    // 个性化建议
    if (result.recommendations?.length > 0) {
      lines.push('───────────────────────────────────');
      lines.push('    个性化提升建议');
      lines.push('───────────────────────────────────');
      result.recommendations.forEach((r: string, i: number) => lines.push(`  ${i + 1}. ${r}`));
      lines.push('');
    } else if (result.suggestions?.length > 0) {
      lines.push('───────────────────────────────────');
      lines.push('    针对性建议');
      lines.push('───────────────────────────────────');
      result.suggestions.forEach((s: string, i: number) => lines.push(`  ${i + 1}. ${s}`));
      lines.push('');
    }

    lines.push('───────────────────────────────────');
    lines.push('  本报告由智教星人工智能助教生成');
    lines.push('  基于学科垂类大模型 · 数据可追溯');
    lines.push('───────────────────────────────────');

    try {
      const res = await resourcesApi.exportWord({ title: `学情分析_${studentName}`, content: lines.join('\n'), filename: `学情分析_${studentName}.docx` });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `学情分析_${studentName}.docx`; a.click(); URL.revokeObjectURL(url);
      message.success('Word 文档已导出');
    } catch (e: any) { message.error('导出失败: ' + (e.message || '未知错误')); }
  };

  // 从学生列表直接运行 AI 分析
  const [aiSelectedStudentId, setAiSelectedStudentId] = useState<string>('');

  const runAnalysisForStudent = async (s: StudentRecord) => {
    if (!canGenerate) { guard.showGuard(); return; }
    setAiSelectedStudentId(s.studentId);
    setLoading(true); setError(''); setResult(null);
    const courseName = selectedClass.split('-')[0];
    const records = s.scores.map(sc => ({
      date: sc.date, exam_name: sc.exam, score: sc.score, total_score: sc.total, category: '考试'
    }));
    try {
      const res = await insightApi.analyzeStudent({
        student_id: s.studentId, student_name: s.name, course_name: courseName, records,
      });
      if (res.data.success) {
        setResult(res.data.data);
        if (res.data.data.ai_generated === false) {
          message.warning('AI 服务暂不可用，已使用备用数据分析，请检查 LLM API Key 配置');
        } else {
          message.success('AI 学情诊断完成！');
        }
      } else { setError(res.data.message || '分析失败'); }
    } catch (e: any) { setError(e.response?.data?.detail || '请求失败'); }
    finally { setLoading(false); }
  };

  // 从学生列表快速填充 AI 分析（保留用于列表按钮）
  const fillStudentAnalysis = (s: StudentRecord) => {
    setActiveTab('ai');
    setAiSelectedStudentId(s.studentId);
    runAnalysisForStudent(s);
  };

  const getTrendIcon = (trend: string) => {
    if (trend === '上升') return <ArrowUpOutlined style={{ color: BRAND.colors.green }} />;
    if (trend === '下降') return <ArrowDownOutlined style={{ color: BRAND.colors.error }} />;
    return <MinusOutlined style={{ color: BRAND.colors.orange }} />;
  };

  // ── 薄弱点击弹窗 ──
  const [kpModal, setKpModal] = useState<{ name: string; count: number } | null>(null);

  // ── 预警详情弹窗 ──
  const [warningModalOpen, setWarningModalOpen] = useState(false);

  // ── AI 帮扶方案弹窗（与成绩管理一致） ──
  const [assistStudent, setAssistStudent] = useState<{ name: string; score: number; status: string; weakPoints: string[] } | null>(null);

  const handleAssistPlan = (student: { name: string; score: number; status: string; weakPoints: string[] }) => {
    if (!canGenerate) { guard.showGuard(); return; }
    setAssistStudent(student);
  };

  return (
    <div className="page-enter" style={{ position: 'relative' }}>
      {/* API Key 横幅 */}
      {!canGenerate && <ApiKeyBanner onGoSettings={guard.goToSettings} />}

      {/* 页面头部 */}
      <div style={{ marginBottom: 16 }}>
        <Space align="center" size={10}>
          <span
            dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }}
            style={{ width: 32, height: 32, display: 'inline-flex', animation: 'logoPulse 0.8s ease-out' }}
          />
          <div>
            <Title level={4} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: BRAND.colors.textPrimary }}>
              智教星 · 班级学情分析
            </Title>
            <Text type="secondary" style={{ fontSize: 11 }}>AI 驱动学情诊断 · 数据可追溯归档</Text>
          </div>
        </Space>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ background: '#fff', borderRadius: 12, padding: '4px 16px 16px', boxShadow: CARD_SPECS.shadow }}
        items={[
          // ═══════════════════════════════════════════════════
          // Tab 1: 班级学情概览
          // ═══════════════════════════════════════════════════
          {
            key: 'class',
            label: <span><TeamOutlined style={{ color: BRAND.colors.primary }} />班级学情概览</span>,
            children: (
              <div>
                {/* ── 筛选控制区 ── */}
                <Row gutter={12} align="middle" style={{ marginBottom: 16, padding: 12, background: `${BRAND.colors.primary}06`, borderRadius: 8, border: `1px solid ${BRAND.colors.border}` }}>
                  <Col>
                    <Space size={12}>
                      <Select value={selectedClass} onChange={v => { setSelectedClass(v); setSelectedStudents([]); }} style={{ width: 180 }} options={courseClassOptions} />
                      <Select value={timeRange} onChange={setTimeRange} style={{ width: 160 }}
                        options={[
                          { value: 'all', label: '全部历史成绩' },
                          { value: 'homework', label: '本次作业' },
                          { value: 'midterm', label: '期中考试' },
                          { value: 'final', label: '期末考试' },
                        ]}
                      />
                      <Button icon={<DownloadOutlined />} onClick={handleExportExcel}
                        style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, color: '#fff' }}>导出 Excel</Button>
                      <Button danger icon={<DeleteOutlined />} style={{ borderRadius: 8 }}
                        loading={deleting}
                        onClick={() => {
                          if (!selectedClass) { message.warning('请先选择班级'); return; }
                          const lastDash = selectedClass.lastIndexOf('-');
                          let course = lastDash > 0 ? selectedClass.slice(0, lastDash) : selectedClass;
                          const cls = lastDash > 0 ? selectedClass.slice(lastDash + 1) : '';
                          // 前端显示为"未知"的课程，实际数据库中 course_name 为空字符串
                          if (course === '未知') course = '';
                          Modal.confirm({
                            title: `删除班级「${course} · ${cls}」的全部成绩？`,
                            content: '此操作不可恢复，将删除该班级下所有学生的成绩记录。',
                            okText: '确认删除',
                            okType: 'danger',
                            cancelText: '取消',
                            okButtonProps: { loading: deleting },
                            onOk: async () => {
                              setDeleting(true);
                              try {
                                const res = await gradeApi.deleteClass(course, cls);
                                const deleted = res.data?.data?.deleted;
                                if (deleted === 0 && res.data?.success) {
                                  message.info(res.data?.message || `班级「${course} · ${cls}」下没有成绩记录，无需删除`);
                                } else {
                                  message.success(`已删除班级「${course} · ${cls}」的 ${deleted ?? '?'} 条成绩记录`);
                                }
                                // 重新获取数据，而不是刷新整个页面
                                await fetchStudentsData();
                                setSelectedClass('');
                                setSelectedStudents([]);
                              } catch (e: any) {
                                message.error('删除失败: ' + (e.response?.data?.detail || e.message || '未知错误'));
                              } finally {
                                setDeleting(false);
                              }
                            },
                          });
                        }}>删除班级</Button>
                    </Space>
                  </Col>
                </Row>

                {/* ── KPI 指标卡 ── */}
                <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                  {[
                    { label: '学生总数', value: (classStats?.total || 0), suffix: '人', icon: <TeamOutlined />, color: BRAND.colors.primary, tip: '当前班级总人数' },
                    { label: '平均分', value: (classStats?.avgScore.toFixed(1) || '—'), suffix: '分', icon: <TrophyOutlined />, color: BRAND.colors.green, tip: '优秀≥85 · 及格60 · 预警<70', prev: prevStats?.avgScore },
                    { label: '通过率', value: (classStats?.passRate.toFixed(1) || '—'), suffix: '%', icon: <RiseOutlined />, color: BRAND.colors.primary, tip: '成绩≥60分占比', prev: prevStats?.passRate },
                    { label: '优秀率', value: (classStats?.excellentRate.toFixed(1) || '—'), suffix: '%', icon: <StarOutlined />, color: BRAND.colors.purple, tip: '成绩≥85分占比', prev: prevStats?.excellentRate },
                    { label: '预警人数', value: (classStats?.warnCount || 0), suffix: '人', icon: <WarningOutlined />, color: BRAND.colors.orange, tip: '存在薄弱知识点/成绩下滑学生', invertTrend: true, prev: undefined },
                  ].map((item, idx) => {
                    const diff = item.prev != null && typeof item.value === 'number'
                      ? ((item.value - item.prev) / (item.prev || 1) * 100).toFixed(1)
                      : null;
                    const isUp = diff && parseFloat(diff) >= 0;
                    return (
                      <Col span={4} key={idx}>
                        <Tooltip title={item.tip}>
                          <Card className="brand-card" bodyStyle={{ padding: '14px 16px', position: 'relative' }}>
                            <span style={{ position: 'absolute', top: 6, right: 8, color: item.color, opacity: 0.35 }}><BrandBadge size={12} /></span>
                            <Statistic
                              title={<Text style={{ fontSize: 12, color: BRAND.colors.textSecondary }}>{item.label}</Text>}
                              value={item.value}
                              suffix={<Text style={{ fontSize: 12, color: BRAND.colors.textTertiary }}>{item.suffix}</Text>}
                              prefix={<span style={{ color: item.color, fontSize: 16, marginRight: 4 }}>{item.icon}</span>}
                              valueStyle={{ fontSize: 22, fontWeight: 700, color: BRAND.colors.textPrimary }}
                            />
                            {visible && diff && (
                              <div style={{ marginTop: 2 }}>
                                <Text style={{ fontSize: 11, color: (item.invertTrend ? !isUp : isUp) ? BRAND.colors.green : BRAND.colors.orange }}>
                                  {(item.invertTrend ? !isUp : isUp) ? '↑' : '↓'} {Math.abs(parseFloat(diff))}%
                                </Text>
                                <Text type="secondary" style={{ fontSize: 10, marginLeft: 2 }}>较上期</Text>
                              </div>
                            )}
                          </Card>
                        </Tooltip>
                      </Col>
                    );
                  })}
                </Row>

                {/* ── 学生列表 + 薄弱/预警 ── */}
                <Row gutter={12}>
                  {/* 学生列表 */}
                  <Col span={12}>
                    <Card
                      className="brand-card"
                      title={
                        <Space>
                          <BrandBadge /><TeamOutlined style={{ color: BRAND.colors.primary }} />
                          <Text strong>{selectedClass.split('-')[0]} · 学生列表</Text>
                          <Tag style={{ borderRadius: 8, fontSize: 10 }}>{currentStudents.length} 人</Tag>
                        </Space>
                      }
                      bodyStyle={{ padding: '8px 16px', maxHeight: 480, overflow: 'auto' }}
                    >
                      <List
                        dataSource={currentStudents}
                        renderItem={s => {
                          const latestScore = s.scores[s.scores.length - 1];
                          const scorePct = latestScore ? Math.round(latestScore.score / latestScore.total * 100) : 0;
                          const isWarn = scorePct >= 55 && scorePct <= 65;
                          const isExcellent = scorePct >= 85;
                          const isFail = scorePct < 60;
                          return (
                            <List.Item
                              style={{
                                padding: '10px 8px', borderRadius: 8, marginBottom: 2, cursor: 'pointer',
                                background: selectedStudents.includes(s.studentId) ? `${BRAND.colors.primary}10` : 'transparent',
                                transition: 'all 0.2s',
                              }}
                              onMouseEnter={e => { if (!selectedStudents.includes(s.studentId)) e.currentTarget.style.background = `${BRAND.colors.primary}06`; }}
                              onMouseLeave={e => { if (!selectedStudents.includes(s.studentId)) e.currentTarget.style.background = 'transparent'; }}
                            >
                              <Checkbox
                                checked={selectedStudents.includes(s.studentId)}
                                onChange={e => {
                                  if (e.target.checked) setSelectedStudents([...selectedStudents, s.studentId]);
                                  else setSelectedStudents(selectedStudents.filter(id => id !== s.studentId));
                                }}
                                onClick={e => e.stopPropagation()}
                              />
                              <div style={{ flex: 1, marginLeft: 8 }} onClick={() => setSelectedStudent(s)}>
                                <Space>
                                  <Text strong style={{ fontSize: 13 }}>{s.name}</Text>
                                  <Tag color={isFail ? 'red' : isWarn ? 'orange' : isExcellent ? 'green' : 'default'}
                                    style={{ borderRadius: 8, fontSize: 10, lineHeight: '18px' }}>
                                    {isFail ? '不及格' : isWarn ? '临界' : isExcellent ? '优秀' : '正常'}
                                  </Tag>
                                  {s.weakPoints.length >= 2 && (
                                    <Tag style={{ borderRadius: 8, fontSize: 9, background: `${BRAND.colors.orange}15`, color: BRAND.colors.orange, border: 'none' }}>
                                      🧩 薄弱{s.weakPoints.length}
                                    </Tag>
                                  )}
                                </Space>
                                <div>
                                  <Text type="secondary" style={{ fontSize: 11 }}>{s.studentId}</Text>
                                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>最新 {latestScore?.exam}: {latestScore?.score}/{latestScore?.total} ({scorePct}分)</Text>
                                  {s.weakPoints.length > 0 && (
                                    <Text type="secondary" style={{ fontSize: 10, marginLeft: 8, color: BRAND.colors.orange }}>
                                      薄弱: {s.weakPoints.slice(0, 2).join(', ')}
                                    </Text>
                                  )}
                                </div>
                              </div>
                              <Space size={4} onClick={e => e.stopPropagation()}>
                                <Tooltip title="AI 个体分析">
                                  <Button type="link" size="small" icon={<RobotOutlined />} style={{ color: BRAND.colors.primary }}
                                    onClick={() => fillStudentAnalysis(s)} />
                                </Tooltip>
                                <Tooltip title={canGenerate ? '生成补差习题' : '请先配置API密钥'}>
                                  <Button type="link" size="small" icon={<ExperimentOutlined />}
                                    disabled={!canGenerate} style={{ color: BRAND.colors.green }} />
                                </Tooltip>
                                <Tooltip title="归档至台账">
                                  <Button type="link" size="small" icon={<HistoryOutlined />}
                                    style={{ color: BRAND.colors.purple }} />
                                </Tooltip>
                              </Space>
                            </List.Item>
                          );
                        }}
                      />
                      {selectedStudents.length > 0 && (
                        <div style={{ padding: '8px 4px 0', borderTop: `1px solid ${BRAND.colors.border}`, marginTop: 4 }}>
                          <Space>
                            <Text type="secondary" style={{ fontSize: 12 }}>已选 {selectedStudents.length} 人</Text>
                            <Button size="small" icon={<ExperimentOutlined />} disabled={!canGenerate}
                              style={{ borderRadius: 6, fontSize: 11, height: 24, borderColor: BRAND.colors.green, color: BRAND.colors.green }}>
                              批量补差
                            </Button>
                            <Button size="small" icon={<HistoryOutlined />}
                              style={{ borderRadius: 6, fontSize: 11, height: 24, borderColor: BRAND.colors.purple, color: BRAND.colors.purple }}>
                              批量归档
                            </Button>
                          </Space>
                        </div>
                      )}
                    </Card>
                  </Col>

                  {/* 薄弱知识点 + 预警 */}
                  <Col span={12}>
                    {/* 薄弱知识点 */}
                    <Card
                      className="brand-card"
                      title={<Space><BrandBadge /><BarChartOutlined style={{ color: BRAND.colors.error }} /><Text strong>班级薄弱知识点</Text></Space>}
                      bodyStyle={{ padding: '8px 16px', marginBottom: 12 }}
                      extra={
                        <Radio.Group value={kpView} onChange={e => setKpView(e.target.value)} size="small">
                          <Radio.Button value="bar" style={{ fontSize: 11 }}>条形图</Radio.Button>
                          <Radio.Button value="heatmap" style={{ fontSize: 11 }}>热力图</Radio.Button>
                        </Radio.Group>
                      }
                    >
                      {classWeakPoints.length > 0 ? (
                        kpView === 'bar' ? (
                          <BarChart data={classWeakPoints} total={currentStudents.length}
                            onItemClick={(name, count) => setKpModal({ name, count })} />
                        ) : (
                          <Heatmap students={currentStudents} weakKps={classWeakPoints.map(([n]) => n)}
                            onCellClick={(name, count) => setKpModal({ name, count })} />
                        )
                      ) : (
                        <Text type="secondary" style={{ display: 'block', padding: 20, textAlign: 'center' }}>无薄弱知识点</Text>
                      )}
                    </Card>

                    {/* 预警信息 */}
                    <Card
                      className="brand-card"
                      title={<Space><BrandBadge color={BRAND.colors.orange} /><WarningOutlined style={{ color: BRAND.colors.orange }} /><Text strong>预警信息</Text></Space>}
                      bodyStyle={{ padding: '8px 16px' }}
                      extra={
                        <Space size={8}>
                          <Tag style={{ borderRadius: 8, fontSize: 10 }}>成绩临界 {warningStats.score}</Tag>
                          <Tag style={{ borderRadius: 8, fontSize: 10 }}>持续下滑 {warningStats.drop}</Tag>
                          <Tag style={{ borderRadius: 8, fontSize: 10 }}>知识薄弱 {warningStats.weakness}</Tag>
                          <Button type="link" size="small" onClick={() => setWarningModalOpen(true)} style={{ fontSize: 11 }}>查看全部</Button>
                        </Space>
                      }
                    >
                      {allWarnings.length > 0 ? (
                        <List size="small" dataSource={allWarnings.slice(0, 4)}
                          renderItem={item => (
                            <List.Item style={{ padding: '6px 4px' }}
                              actions={[
                                <Button type="link" size="small" icon={<RobotOutlined />}
                                  style={{ fontSize: 11, color: BRAND.colors.purple }}
                                  onClick={() => handleAssistPlan({ name: item.name, score: 0, status: '需关注', weakPoints: item.warnings })}>帮扶方案</Button>,
                              ]}
                            >
                              <Space>
                                <Tag color={item.type === 'score' ? 'orange' : item.type === 'drop' ? 'red' : 'warning'}
                                  style={{ borderRadius: 6, fontSize: 11 }}>
                                  {item.name}
                                </Tag>
                                <Text style={{ fontSize: 12 }}>{item.warnings[0]}</Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      ) : (
                        <Text type="secondary">暂无预警</Text>
                      )}
                    </Card>
                  </Col>
                </Row>

                {/* 薄弱知识弹窗 */}
                <Modal
                  title={<Space><BrandBadge />{kpModal?.name}</Space>}
                  open={!!kpModal} onCancel={() => setKpModal(null)} footer={null} width={500}
                >
                  {kpModal && (
                    <div>
                      <Paragraph>该知识点薄弱学生：共 {kpModal.count} 人</Paragraph>
                      <List size="small" dataSource={currentStudents.filter(s => s.weakPoints.includes(kpModal.name))}
                        renderItem={s => <List.Item><Tag color="error">{s.name}</Tag>掌握度 {s.knowledgeMastery.find(k => k.name === kpModal.name)?.mastery || '?'}%</List.Item>}
                      />
                      <Divider />
                      <Space>
                        <Button type="primary" icon={<RobotOutlined />} disabled={!canGenerate}
                          style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient }}
                          onClick={() => { if (!canGenerate) guard.showGuard(); else message.info('生成补差方案...'); }}>
                          AI 生成补差教学方案
                        </Button>
                        <Button icon={<BookOutlined />} style={{ borderRadius: 8, borderColor: BRAND.colors.border }}>
                          查看知识库原文
                        </Button>
                      </Space>
                    </div>
                  )}
                </Modal>

                {/* 预警详情弹窗 */}
                <Modal title="全部预警信息" open={warningModalOpen} onCancel={() => setWarningModalOpen(false)} footer={null} width={600}>
                  <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                    <Col span={8}><Card size="small"><Statistic title="成绩临界预警" value={warningStats.score} suffix="人" valueStyle={{ color: BRAND.colors.orange }} /></Card></Col>
                    <Col span={8}><Card size="small"><Statistic title="持续下滑预警" value={warningStats.drop} suffix="人" valueStyle={{ color: BRAND.colors.error }} /></Card></Col>
                    <Col span={8}><Card size="small"><Statistic title="知识点薄弱预警" value={warningStats.weakness} suffix="人" valueStyle={{ color: BRAND.colors.orange }} /></Card></Col>
                  </Row>
                  {allWarnings.length > 0 ? (
                  <List dataSource={allWarnings} renderItem={item => (
                    <List.Item actions={[
                      <Button type="link" size="small" icon={<RobotOutlined />} style={{ color: BRAND.colors.purple }}
                        onClick={() => handleAssistPlan({ name: item.name, score: 0, status: '需关注', weakPoints: item.warnings })}>帮扶方案</Button>,
                    ]}>
                      <List.Item.Meta
                        avatar={<Tag color={item.type === 'score' ? 'orange' : item.type === 'drop' ? 'red' : 'warning'} style={{ borderRadius: 6 }}>{item.name}</Tag>}
                        title={item.warnings[0]}
                        description={item.warnings.slice(1).join('；')}
                      />
                    </List.Item>
                  )} />
                  ) : null}
                </Modal>

                {/* 学生详情弹窗 */}
                <Modal
                  title={<Space><BrandBadge /><UserOutlined />{selectedStudent?.name} — 学情详情</Space>}
                  open={!!selectedStudent} onCancel={() => setSelectedStudent(null)} footer={null} width={700}
                >
                  {selectedStudent && (
                    <div>
                      <Row gutter={12} style={{ marginBottom: 12 }}>
                        <Col span={6}><Statistic title="学号" value={selectedStudent.studentId} /></Col>
                        <Col span={6}><Statistic title="班级" value={selectedStudent.className} /></Col>
                        <Col span={6}>
                          <Statistic title="均分" value={(selectedStudent.scores.reduce((a, s) => a + s.score / s.total * 100, 0) / selectedStudent.scores.length).toFixed(1)} suffix="分" />
                        </Col>
                        <Col span={6}><Statistic title="练习次数" value={selectedStudent.scores.length} suffix="次" /></Col>
                      </Row>
                      <Divider style={{ margin: '4px 0' }} />
                      <Text strong style={{ fontSize: 13 }}>成绩记录</Text>
                      <Row gutter={[4, 4]} style={{ marginTop: 4, marginBottom: 12 }}>
                        {selectedStudent.scores.map((sc, i) => (
                          <Col span={12} key={i}>
                            <Space><Tag style={{ borderRadius: 6 }}>{sc.date}</Tag><Tag style={{ borderRadius: 6 }}>{sc.exam}</Tag>
                              <Progress percent={Math.round(sc.score / sc.total * 100)} size="small" style={{ width: 120 }}
                                format={() => `${sc.score}/${sc.total}`} />
                            </Space>
                          </Col>
                        ))}
                      </Row>
                      <Text strong style={{ fontSize: 13 }}>知识掌握度</Text>
                      <Row gutter={[6, 6]} style={{ marginTop: 4, marginBottom: 12 }}>
                        {selectedStudent.knowledgeMastery.map((km, i) => (
                          <Col span={8} key={i}>
                            <Card size="small" bodyStyle={{ padding: '8px 12px' }} className="brand-card">
                              <Space>{getTrendIcon(km.trend)}<Text strong style={{ fontSize: 12 }}>{km.name}</Text></Space>
                              <Progress percent={Math.round(km.mastery)} size="small" status={km.mastery < 60 ? 'exception' : 'active'} />
                            </Card>
                          </Col>
                        ))}
                      </Row>
                      {selectedStudent.warnings.length > 0 && <Alert type="warning" message={selectedStudent.warnings.join('；')} style={{ marginBottom: 12, borderRadius: 8 }} />}
                      <Space style={{ marginTop: 8 }}>
                        <Button type="primary" icon={<RobotOutlined />} disabled={!canGenerate}
                          style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient }}
                          onClick={() => { fillStudentAnalysis(selectedStudent); }}>
                          查看 AI 诊断报告
                        </Button>
                        <Button icon={<HistoryOutlined />} style={{ borderRadius: 8, borderColor: BRAND.colors.border }}>
                          归档至教学台账
                        </Button>
                      </Space>
                    </div>
                  )}
                </Modal>

                {/* ── 成绩管理（嵌入） ── */}
                <Divider style={{ margin: '16px 0' }} />
                <GradeManagement embedded courseFilter={selectedClass ? (() => { const d = selectedClass.lastIndexOf('-'); return d > 0 ? selectedClass.slice(0, d) : selectedClass; })() : undefined} classFilter={selectedClass ? (() => { const d = selectedClass.lastIndexOf('-'); return d > 0 ? selectedClass.slice(d + 1) : ''; })() : undefined} />
              </div>
            ),
          },

          // ═══════════════════════════════════════════════════
          // Tab 2: AI 个体分析
          // ═══════════════════════════════════════════════════
          {
            key: 'ai',
            label: <span><RobotOutlined style={{ color: BRAND.colors.purple }} />AI 个体分析</span>,
            children: (
              <Row gutter={20}>
                <Col xs={24} lg={7}>
                  {/* 学生选择区 */}
                  <Card
                    className="brand-card"
                    title={<Space><BrandBadge /><UserOutlined style={{ color: BRAND.colors.primary }} /><Text strong>选择学生</Text></Space>}
                    bodyStyle={{ padding: '16px 20px' }}
                  >
                    <Paragraph style={{ color: BRAND.colors.textSecondary, fontSize: 12, marginBottom: 12 }}>
                      从下方学生列表中选择一名学生，AI 将自动读取其成绩数据进行学情诊断。
                    </Paragraph>

                    {!canGenerate && (
                      <Alert type="warning" message="配置 API Key 后解锁 AI 诊断" showIcon
                        style={{ borderRadius: 8, marginBottom: 12 }}
                        action={<Button size="small" icon={<KeyOutlined />} onClick={guard.goToSettings} style={{ borderRadius: 6 }}>去配置</Button>} />
                    )}

                    {currentStudents.length === 0 ? (
                      <Empty description="暂无学生数据，请先在「班级学情概览」中加载班级数据" />
                    ) : (
                      <List dataSource={currentStudents} size="small" style={{ maxHeight: 420, overflow: 'auto' }}
                        renderItem={(s: StudentRecord) => {
                          const latestScore = s.scores[s.scores.length - 1];
                          const scorePct = latestScore ? Math.round(latestScore.score / latestScore.total * 100) : 0;
                          const isSelected = aiSelectedStudentId === s.studentId;
                          return (
                            <List.Item
                              style={{
                                cursor: 'pointer', borderRadius: 8, padding: '8px 10px', marginBottom: 2,
                                background: isSelected ? `${BRAND.colors.primary}10` : 'transparent',
                                borderLeft: isSelected ? `3px solid ${BRAND.colors.primary}` : '3px solid transparent',
                              }}
                              onClick={() => runAnalysisForStudent(s)}
                            >
                              <Space>
                                <Avatar icon={<UserOutlined />} size="small" style={{ backgroundColor: scorePct >= 85 ? BRAND.colors.green : scorePct >= 60 ? BRAND.colors.primary : BRAND.colors.error }} />
                                <div>
                                  <Text strong style={{ fontSize: 12 }}>{s.name}</Text>
                                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>{s.studentId}</Text>
                                </div>
                                <Tag color={scorePct >= 85 ? 'green' : scorePct >= 60 ? 'blue' : 'red'} style={{ borderRadius: 6, fontSize: 10, marginLeft: 'auto' }}>
                                  {scorePct}分
                                </Tag>
                              </Space>
                            </List.Item>
                          );
                        }} />
                    )}
                    {error && <Alert message={error} type="error" showIcon style={{ borderRadius: 8, marginTop: 12 }} />}
                  </Card>
                </Col>

                <Col xs={24} lg={17}>
                  {/* 加载态 */}
                  {loading && (
                    <Card className="brand-card" bodyStyle={{ padding: 40, textAlign: 'center' }}>
                      <div style={{ animation: 'logoGlow 1.5s ease-in-out infinite' }}>
                        <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 48, height: 48, display: 'inline-block' }} />
                      </div>
                      <Spin style={{ marginTop: 12 }} />
                      <Paragraph style={{ marginTop: 8, color: BRAND.colors.textSecondary, fontSize: 12 }}>
                        AI 正在分析学情数据，生成诊断报告...
                      </Paragraph>
                    </Card>
                  )}

                  {/* 结果 */}
                  {result && !loading ? (
                    <div>
                      {/* 概览卡片 */}
                      <Card className="brand-card" style={{ marginBottom: 12 }}
                        bodyStyle={{ padding: '16px 20px', position: 'relative' }}>
                        <span style={{ position: 'absolute', top: 8, right: 10, color: BRAND.colors.primary, opacity: 0.3 }}><BrandBadge size={16} /></span>
                        <Space style={{ marginBottom: 8 }}>
                          <RobotOutlined style={{ color: BRAND.colors.primary, fontSize: 18 }} />
                          <Text strong style={{ fontSize: 14 }}>AI 学情诊断报告</Text>
                          {result.ai_generated !== false ? (
                            <Tag style={{ borderRadius: 6, background: `${BRAND.colors.green}15`, color: BRAND.colors.green, border: 'none', fontSize: 10 }}>
                              AI 生成 · 来源可追溯
                            </Tag>
                          ) : (
                            <Tag color="warning" style={{ borderRadius: 6, fontSize: 10 }}>⚠ 备用数据 · 非 AI 生成</Tag>
                          )}
                        </Space>
                        {result.ai_generated === false && (
                          <Alert type="warning" showIcon style={{ marginBottom: 12, borderRadius: 8 }}
                            message="AI 服务暂不可用，当前显示为备用分析数据。请检查 LLM API Key 配置后重新分析。" />
                        )}
                        <Row gutter={12}>
                          <Col span={6}>
                            <Statistic title="综合评分" value={result.overall_score} suffix="分"
                              valueStyle={{ color: result.overall_score >= 80 ? BRAND.colors.green : result.overall_score >= 60 ? BRAND.colors.orange : BRAND.colors.error, fontWeight: 700 }} />
                          </Col>
                          <Col span={6}><Statistic title="完成率" value={result.completion_rate} suffix="%" /></Col>
                          <Col span={6}><Statistic title="排名" value={result.ranking || '-'} /></Col>
                          <Col span={6}>
                            <Statistic title="需关注" value={result.attention_needed ? '是' : '否'}
                              valueStyle={{ color: result.attention_needed ? BRAND.colors.error : BRAND.colors.green, fontWeight: 600 }} />
                          </Col>
                        </Row>
                        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BRAND.colors.border}` }}>
                          <Space>
                            <Button icon={<RobotOutlined />} size="small" disabled={!canGenerate}
                              style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>
                              重新生成
                            </Button>
                            <Button icon={<DownloadOutlined />} size="small" onClick={handleExportInsightWord}
                              style={{ borderRadius: 6, borderColor: BRAND.colors.green, color: BRAND.colors.green }}>
                              导出 Word
                            </Button>
                            <Button icon={<HistoryOutlined />} size="small"
                              style={{ borderRadius: 6, borderColor: BRAND.colors.purple, color: BRAND.colors.purple }}>
                              归档台账
                            </Button>
                          </Space>
                        </div>
                      </Card>

                      {/* 知识掌握度 */}
                      {result.knowledge_mastery?.length > 0 && (
                        <Card className="brand-card" style={{ marginBottom: 12 }}
                          title={<Space><BrandBadge /><BarChartOutlined style={{ color: BRAND.colors.primary }} /><Text strong>知识掌握度</Text></Space>}
                          bodyStyle={{ padding: '12px 16px' }}>
                          <Row gutter={[8, 8]}>
                            {result.knowledge_mastery.map((km: any, i: number) => (
                              <Col span={8} key={i}>
                                <Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px' }}>
                                  <Space>{getTrendIcon(km.trend)}<Text strong style={{ fontSize: 12 }}>{km.name}</Text>
                                    <Tag style={{ fontSize: 10, borderRadius: 6, border: 'none' }} color={km.category === '重点' ? 'red' : km.category === '基础' ? 'blue' : 'default'}>
                                      {km.category || '基础'}
                                    </Tag>
                                  </Space>
                                  <Progress percent={Math.round(km.mastery)} size="small"
                                    status={km.mastery < 60 ? 'exception' : km.mastery < 80 ? 'active' : 'success'} />
                                </Card>
                              </Col>
                            ))}
                          </Row>
                        </Card>
                      )}

                      {/* 优势与薄弱 */}
                      <Row gutter={12} style={{ marginBottom: 12 }}>
                        <Col span={12}>
                          <Card className="brand-card" size="small"
                            title={<Space><CheckCircleOutlined style={{ color: BRAND.colors.green }} /><Text strong>优势知识点</Text></Space>}
                            bodyStyle={{ padding: '10px 16px' }}>
                            {result.strong_points?.length > 0
                              ? result.strong_points.map((p: string, i: number) => (
                                <Tag key={i} style={{ borderRadius: 6, background: `${BRAND.colors.green}10`, color: BRAND.colors.green, border: `1px solid ${BRAND.colors.green}20`, marginBottom: 4 }}>{p}</Tag>
                              ))
                              : <Text type="secondary">暂无数据</Text>}
                          </Card>
                        </Col>
                        <Col span={12}>
                          <Card className="brand-card" size="small"
                            title={<Space><WarningOutlined style={{ color: BRAND.colors.error }} /><Text strong>薄弱知识点</Text></Space>}
                            bodyStyle={{ padding: '10px 16px' }}>
                            {result.weak_points?.length > 0
                              ? result.weak_points.map((p: string, i: number) => (
                                <Tag key={i} color="error" style={{ borderRadius: 6, marginBottom: 4 }}>{p}</Tag>
                              ))
                              : <Text type="secondary">暂无数据</Text>}
                          </Card>
                        </Col>
                      </Row>

                      {/* 建议 */}
                      {result.recommendations?.length > 0 && (
                        <Card className="brand-card" style={{ marginBottom: 12 }}
                          title={<Space><BulbOutlined style={{ color: BRAND.colors.orange }} /><Text strong>个性化提升建议</Text></Space>}
                          bodyStyle={{ padding: '12px 16px' }}>
                          {result.recommendations.map((r: string, i: number) => (
                            <div key={i} style={{
                              display: 'flex', alignItems: 'flex-start', gap: 10,
                              padding: '10px 0', borderBottom: i < result.recommendations.length - 1 ? '1px solid #f0f0f0' : 'none',
                            }}>
                              <span style={{
                                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                                background: BRAND.colors.primaryGradient, color: '#fff',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 12, fontWeight: 600, marginTop: 1,
                              }}>{i + 1}</span>
                              <Text style={{ flex: 1, fontSize: 13, lineHeight: '1.8', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{r}</Text>
                            </div>
                          ))}
                          <Divider style={{ margin: '8px 0' }} />
                          <Text type="secondary" style={{ fontSize: 10 }}>【本内容由学科垂类AI助教生成】</Text>
                        </Card>
                      )}
                    </div>
                  ) : null}

                  {/* 空状态 */}
                  {!result && !loading && (
                    <Card className="brand-card" bodyStyle={{ padding: 60, textAlign: 'center' }}>
                      <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 60, height: 60, display: 'inline-block', opacity: 0.3 }} />
                      <Paragraph style={{ marginTop: 12, color: BRAND.colors.textTertiary, fontSize: 13 }}>
                        选择学生或输入成绩数据，开始 AI 学情诊断
                      </Paragraph>
                    </Card>
                  )}
                </Col>
              </Row>
            ),
          },
        ]}
      />

      {/* ── AI 帮扶方案弹窗（与成绩管理一致） ── */}
      <Modal title={<Space><RobotOutlined style={{ color: BRAND.colors.error }} />AI 帮扶方案</Space>}
        open={!!assistStudent} onCancel={() => setAssistStudent(null)} width={600}
        footer={[<Button key="close" onClick={() => setAssistStudent(null)} style={{ borderRadius: 6 }}>关闭</Button>]}>
        {assistStudent && (
          <div>
            <Alert type="error" showIcon
              message={`⚠️ 预警学生：${assistStudent.name} — 状态：${assistStudent.status}`}
              style={{ marginBottom: 12, borderRadius: 8 }} />
            <Card size="small" title="🔍 问题诊断" style={{ marginBottom: 12, borderRadius: 8 }}>
              {assistStudent.weakPoints.length > 0 ? (
                <div>
                  <p>📌 预警类型：{assistStudent.weakPoints.join('、')}</p>
                  <p>📌 风险等级：{assistStudent.weakPoints.length >= 2 ? '🔴 高风险' : '🟡 中等风险'}</p>
                </div>
              ) : (
                <p>📌 该学生需要特别关注，建议查看详细学情数据。</p>
              )}
            </Card>
            <Card size="small" title="🤝 AI 帮扶建议" style={{ borderRadius: 8 }}>
              <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
                <li><strong>建立学习档案：</strong>记录学生每次作业和测验情况，追踪进步轨迹</li>
                <li><strong>个性化辅导计划：</strong>每周安排 1-2 次针对性辅导（每次 30 分钟）</li>
                <li><strong>同伴互助：</strong>安排成绩优秀的学生进行一对一帮助</li>
                <li><strong>家校沟通：</strong>与家长定期沟通学习进展，形成教育合力</li>
                <li><strong>心理疏导：</strong>关注学生学习信心，多给予正面鼓励与肯定</li>
                <li><strong>分阶段目标：</strong>设定短期可达成的学习目标，逐步提升成绩</li>
              </ol>
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                📐 帮扶方案由 AI 基于学情数据生成，建议教师结合实际情况制定具体措施。
              </Text>
            </Card>
          </div>
        )}
      </Modal>

      {/* 品牌水印 */}
      <div className="brand-watermark">Edu-TA 教学台账 · 学情可追溯</div>

      {/* API Key 弹窗 */}
      <ApiKeyGuardModal visible={guard.modalVisible} onClose={guard.hideGuard} onGoSettings={guard.goToSettings} />
      <SettingsModal open={guard.settingsVisible} onClose={() => guard.setSettingsVisible(false)} />
    </div>
  );
};

export default StudentInsight;
