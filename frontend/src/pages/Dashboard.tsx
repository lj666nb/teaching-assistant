/**
 * 智能工作台 — Edu-TA 智教星 品牌化首页
 *
 * 品牌视觉特色：
 * - 专属 Logo + 品牌色（深海科技蓝 #0F52BA / 教研紫 #7B61FF）
 * - 代码流暗纹背景、二进制粒子动效
 * - 卡片悬浮发光、数字滚动动画、趋势波纹
 * - 胶囊渐变标签、浮动 AI 机器人
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Row, Col, Card, Statistic, Typography, Space, List, Tag,
  Table, Progress, Avatar, Button, Tooltip, Spin,
} from 'antd';
import {
  FileTextOutlined, CheckCircleOutlined, TeamOutlined, ClockCircleOutlined,
  ArrowUpOutlined, ArrowDownOutlined, WarningOutlined, BarChartOutlined,
  BookOutlined, MessageOutlined, RobotOutlined, ThunderboltOutlined,
  EyeOutlined, EyeInvisibleOutlined, DatabaseOutlined, FormOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { gradeApi, knowledgeApi } from '../api/client';
import { BRAND, CARD_SPECS } from '../utils/brand';
import { useDataVisibility } from '../context/DataVisibilityContext';
import '../styles/brand.css';

const { Title, Paragraph, Text } = Typography;

// ── 品牌角标组件 ─────────────────────────────────────
const BrandBadge: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <span
    dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle' }}
  />
);

// ── 二进制飘落粒子 ────────────────────────────────────
const BinaryParticles: React.FC = () => {
  const particles = useRef(
    Array.from({ length: 8 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 4,
      duration: 3 + Math.random() * 3,
      text: Math.random() > 0.5 ? '01' : '101',
    }))
  );
  return (
    <>
      {particles.current.map(p => (
        <div
          key={p.id}
          className="binary-particle"
          style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }}
        >
          {p.text}
        </div>
      ))}
    </>
  );
};

// ── 数字滚动组件 ─────────────────────────────────────
const CountUp: React.FC<{ value: number; duration?: number }> = ({ value, duration = 800 }) => {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(value);

  useEffect(() => {
    const start = performance.now();
    const startVal = display; // 从当前显示值动画到目标值
    const diff = value - startVal;
    if (diff === 0) { setDisplay(value); return; }

    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(startVal + eased * diff));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value, duration]);

  prevValue.current = value;
  return <span className="count-animate">{display.toLocaleString()}</span>;
};

// ── 主组件 ─────────────────────────────────────────────
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [kbStatus, setKbStatus] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ── 全局数据可见性（来自 Context） ──
  const { visible, toggleVisibility } = useDataVisibility();
  const [useCaseData, setUseCaseData] = useState<any>(null);
  const [useCaseLoading, setUseCaseLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      knowledgeApi.status().then(res => setKbStatus(res.data.data)).catch(() => {}),
      gradeApi.stats().then(res => setStats(res.data.data)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  // 用户自有数据（隐藏模式下显示用户添加的成绩和班级概览）
  const [userStats, setUserStats] = useState({ total: 0, courses: 0, classes: 0 });
  const [userClasses, setUserClasses] = useState<any[]>([]);
  useEffect(() => {
    gradeApi.list('', '').then(res => {
      if (res.data.success) {
        const items = (res.data.data.items || []).filter((i: any) => i._source !== 'seed');
        setUserStats({ total: items.length, courses: new Set(items.map((i: any) => i.course)).size, classes: new Set(items.map((i: any) => `${i.course}_${i.className}`)).size });
        // 按班级汇总用户数据
        const classMap = new Map<string, { course: string; className: string; scores: number[]; studentCount: number }>();
        items.forEach((r: any) => {
          const key = `${r.course}_${r.className}`;
          if (!classMap.has(key)) classMap.set(key, { course: r.course, className: r.className, scores: [], studentCount: 0 });
          const c = classMap.get(key)!;
          c.scores.push(r.score || 0);
          c.studentCount++;
        });
        setUserClasses(Array.from(classMap.values()).map(c => ({
          key: `${c.course}_${c.className}`,
          course: c.course,
          className: c.className,
          student_count: c.studentCount,
          avg_score: +(c.scores.reduce((a, b) => a + b, 0) / c.scores.length).toFixed(1),
          pass_rate: Math.round(c.scores.filter(s => s >= 60).length / c.scores.length * 100),
          failed_count: c.scores.filter(s => s < 60).length,
        })));
      }
    }).catch(() => {});
  }, [visible]);

  // 切换显示用例数据时拉取详细数据
  useEffect(() => {
    if (!visible || useCaseData) return;
    setUseCaseLoading(true);
    Promise.all([
      gradeApi.list('', '').catch(() => ({ data: { data: { items: [] } } })),
      knowledgeApi.collections().catch(() => ({ data: { data: [] } })),
      knowledgeApi.listCourses().catch(() => ({ data: { data: { courses: [] } } })),
    ]).then(([gradeRes, collRes, courseRes]) => {
      setUseCaseData({
        grades: gradeRes.data?.data?.items || [],
        collections: collRes.data?.data || [],
        courses: courseRes.data?.data?.courses || courseRes.data?.data || [],
      });
    }).finally(() => setUseCaseLoading(false));
  }, [visible, useCaseData]);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h >= 5 && h < 9) return '早上好';
    if (h >= 9 && h < 12) return '上午好';
    if (h >= 12 && h < 18) return '下午好';
    return '晚上好';
  };

  // ── 数据隐藏模式：所有数值归零（global context） ──

  // ── 班级成绩（来自 API，按平均分降序） ──
  const gradeClassesRaw = stats?.classes || [];
  const pendingReviewRaw = stats?.pending_review || 126;
  const totalClassesRaw = stats?.total_classes || gradeClassesRaw.length || 6;
  const aiGradingCountRaw = stats?.ai_grading_count || 1856;
  const totalGradesRaw = stats?.total_grades || 0;

  const gradeClasses = visible ? gradeClassesRaw : userClasses;
  const pendingReview = visible ? pendingReviewRaw : userStats.total;
  const totalClasses = visible ? totalClassesRaw : userStats.classes;
  const aiGradingCount = visible ? aiGradingCountRaw : userStats.total;
  const totalGrades = visible ? totalGradesRaw : userStats.total;
  const kbDocs = visible ? (kbStatus?.total_documents || 0) : 0;
  const kbChunks = visible ? (kbStatus?.total_chunks || 0) : 0;

  // ── 快捷功能（带品牌分色） ──
  const quickActions = [
    {
      key: '/assignments', title: '快速布置作业', desc: '一键下发班级作业',
      icon: <FormOutlined />, gradient: 'linear-gradient(135deg, #7B61FF, #A78BFA)',
    },
    {
      key: '/homework', title: '待批改作业', desc: 'AI 智能批改，一键完成',
      icon: <FileTextOutlined />, gradient: 'linear-gradient(135deg, #0F52BA, #1A6BE0)',
      badge: pendingReview,
    },
    {
      key: '/insight', title: '学情分析', desc: '多维度数据洞察',
      icon: <BarChartOutlined />, gradient: 'linear-gradient(135deg, #36D399, #5EE8B0)',
    },
    {
      key: '/lesson', title: '教学台账', desc: '数据沉淀可追溯',
      icon: <BookOutlined />, gradient: 'linear-gradient(135deg, #FF9F43, #FFB976)',
    },
  ];

  // ── 近期待办（基于课程动态生成，隐藏模式下为空） ──
  interface PendingItem { title: string; submissions: number; deadline: string; urgent: boolean; }
  const pendingItemsRaw: PendingItem[] = (stats?.courses || []).slice(0, 4).map((c: any, i: number) => ({
    title: `${c.course} · 作业批改`,
    submissions: c.student_count || 0,
    deadline: i === 0 ? '今日 18:00' : i === 1 ? '明日 12:00' : `${i + 2}天后`,
    urgent: (c.avg_score || 100) < 75,
  }));
  const fallbackItems: PendingItem[] = [
    { title: '机器学习 · KNN算法作业', submissions: 42, deadline: '今日 18:00', urgent: true },
    { title: '深度学习 · CNN实验报告批改', submissions: 28, deadline: '明日 12:00', urgent: false },
    { title: 'NLP · Transformer模型期中试卷', submissions: 56, deadline: '3天后', urgent: false },
    { title: '计算机视觉 · 课堂练习', submissions: 15, deadline: '已完成80%', urgent: false },
  ];
  const pendingItems: PendingItem[] = visible
    ? (pendingItemsRaw.length > 0 ? pendingItemsRaw : fallbackItems)
    : [];

  return (
    <div className="page-enter" style={{ position: 'relative' }}>
      <BinaryParticles />

      {/* ════════════════════════════════════════════ */}
      {/* 顶部欢迎横幅 — 蓝紫渐变流体 + 浮动机器人  */}
      {/* ════════════════════════════════════════════ */}
      <Card className="banner-fluid" style={{ marginBottom: 24, borderRadius: CARD_SPECS.borderRadius, border: 'none' }} bodyStyle={{ padding: '24px 28px' }}>
        <Row align="middle" gutter={24}>
          <Col flex="auto">
            <Space align="center" size={12}>
              <span
                dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }}
                style={{ width: 42, height: 42, display: 'inline-flex', flexShrink: 0 }}
              />
              <div>
                <Title level={3} style={{ color: '#fff', margin: 0, fontSize: 22, fontWeight: 700 }}>
                  👋 {getGreeting()}，欢迎使用 <span style={{ background: 'rgba(255,255,255,0.15)', padding: '0 8px', borderRadius: 4 }}>Edu-TA 智教星</span>
                </Title>
                <Paragraph style={{ color: 'rgba(255,255,255,0.85)', marginTop: 6, marginBottom: 10, fontSize: 14, maxWidth: 580 }}>
                  今日有 <Text strong style={{ color: '#fff' }}>{pendingItems.length} 项待办任务</Text> 需要处理，
                  共 <Text strong style={{ color: '#fff' }}>{pendingReview} 份</Text> 作业待批改。
                  AI 智能批改可为您节省约 80% 的时间。
                </Paragraph>
                <Space>
                  {visible && (
                    <Tag color="volcano" style={{ borderRadius: 12, padding: '0 12px', lineHeight: '22px' }} className="tag-glow">
                      🔥 高峰期：{totalClasses}门课程作业待批
                    </Tag>
                  )}
                  <Tag color="lime" style={{ borderRadius: 12, padding: '0 12px', lineHeight: '22px' }}>
                    {visible ? `📊 学情报告已更新 · ${totalGrades}条记录` : '📊 数据已隐藏'}
                  </Tag>
                </Space>
              </div>
            </Space>
          </Col>
          <Col>
            <Space direction="vertical" align="center" size={4}>
              <div className="float-bot">
                <RobotOutlined style={{ fontSize: 72, color: 'rgba(255,255,255,0.2)' }} />
              </div>
              <Button
                icon={visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                size="small"
                onClick={toggleVisibility}
                style={{
                  borderRadius: 8,
                  background: visible ? 'rgba(255,255,255,0.2)' : '#fff',
                  color: visible ? '#fff' : BRAND.colors.primary,
                  border: visible ? '1px solid rgba(255,255,255,0.4)' : `1px solid ${BRAND.colors.primary}`,
                  fontSize: 12,
                  fontWeight: 500,
                  boxShadow: visible ? 'none' : `0 2px 6px rgba(0,0,0,0.15)`,
                }}
              >
                {visible ? '隐藏用例数据' : '显示用例数据'}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* ════════════════════════════════════════════ */}
      {/* 核心指标行 — 4张数据卡片（带品牌角标）    */}
      {/* ════════════════════════════════════════════ */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {[
          { value: pendingReview, title: '待批改作业', icon: <FileTextOutlined />, color: BRAND.colors.primary, suffix: `${totalGrades} 条记录`, suffixColor: BRAND.colors.green, path: '/homework' },
          { value: totalClasses, title: '覆盖班级', icon: <TeamOutlined />, color: BRAND.colors.green, suffix: '个', suffixColor: BRAND.colors.textSecondary, path: '/insight' },
          { value: aiGradingCount, title: 'AI 批改次数', icon: <ThunderboltOutlined />, color: BRAND.colors.orange, suffix: `${totalGrades} 次`, suffixColor: BRAND.colors.green, path: '/homework' },
          { value: totalGrades, title: '成绩记录数', icon: <MessageOutlined />, color: BRAND.colors.purple, suffix: `${totalClasses} 个班`, suffixColor: BRAND.colors.orange, path: '/insight' },
        ].map((item: any, idx: number) => (
          <Col xs={12} sm={6} key={idx}>
            <Card
              hoverable
              className="brand-card"
              bodyStyle={{ padding: '18px 22px', position: 'relative' }}
              onClick={() => navigate(item.path)}
            >
              {/* 品牌角标 */}
              <span style={{ position: 'absolute', top: 8, right: 10, color: item.color, opacity: 0.5 }}>
                <BrandBadge />
              </span>

              <Statistic
                title={<Text type="secondary" style={{ fontSize: 13 }}>{item.title}</Text>}
                valueRender={() => (
                  <Space align="baseline" size={6}>
                    <span style={{ color: item.color, fontSize: 22, verticalAlign: 'middle' }}>
                      {item.icon}
                    </span>
                    <Text style={{ fontSize: 28, fontWeight: 700, color: BRAND.colors.textPrimary }}>
                      <CountUp value={item.value} />
                    </Text>
                    <span style={{ display: 'inline-flex' }}>
                      <Text style={{ fontSize: 13, color: item.suffixColor, fontWeight: 500 }}>
                        {item.suffix}
                      </Text>
                    </span>
                  </Space>
                )}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* ════════════════════════════════════════════ */}
      {/* 用例数据面板（可切换显示/隐藏）            */}
      {/* ════════════════════════════════════════════ */}
      {visible && (
        <Card
          className="brand-card"
          style={{ marginBottom: 24 }}
          bodyStyle={{ padding: '16px 24px', position: 'relative' }}
          title={
            <Space>
              <DatabaseOutlined style={{ color: BRAND.colors.purple }} />
              <Text strong style={{ fontSize: 15 }}>系统用例数据</Text>
              <Tag color="purple" style={{ borderRadius: 6 }}>学生成绩 · 文件资料 · 课程信息</Tag>
              {useCaseLoading && <Spin size="small" />}
            </Space>
          }
          extra={
            <Button
              type="text"
              size="small"
              icon={<EyeInvisibleOutlined />}
              onClick={toggleVisibility}
              style={{ color: BRAND.colors.textSecondary, fontSize: 12 }}
            >
              隐藏
            </Button>
          }
        >
          {/* ── 数据概括卡片 ── */}
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            {[
              { label: '成绩记录', value: totalGrades, unit: '条', icon: <FileTextOutlined />, color: BRAND.colors.primary, bg: `${BRAND.colors.primary}10` },
              { label: '班级数', value: totalClasses, unit: '个', icon: <TeamOutlined />, color: BRAND.colors.green, bg: `${BRAND.colors.green}10` },
              { label: '知识库文档', value: kbDocs, unit: '份', icon: <BookOutlined />, color: BRAND.colors.orange, bg: `${BRAND.colors.orange}10` },
              { label: '知识切片', value: kbChunks, unit: '段', icon: <ThunderboltOutlined />, color: BRAND.colors.purple, bg: `${BRAND.colors.purple}10` },
              { label: '课程集合', value: (useCaseData?.collections?.length || kbStatus?.collections?.length || 0), unit: '个', icon: <DatabaseOutlined />, color: '#13c2c2', bg: '#13c2c210' },
              { label: '已批改', value: aiGradingCount, unit: '次', icon: <CheckCircleOutlined />, color: '#eb2f96', bg: '#eb2f9610' },
            ].map((item, idx) => (
              <Col xs={8} sm={4} key={idx}>
                <div style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: item.bg,
                  border: `1px solid ${item.color}20`,
                  textAlign: 'center',
                }}>
                  <div style={{ color: item.color, fontSize: 20, marginBottom: 4 }}>{item.icon}</div>
                  <Text strong style={{ fontSize: 20, color: item.color, display: 'block' }}>
                    <CountUp value={item.value} />
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {item.label} <span style={{ color: item.color }}>{item.unit}</span>
                  </Text>
                </div>
              </Col>
            ))}
          </Row>

          <Row gutter={[16, 16]}>
            {/* ── 学生成绩列表 ── */}
            <Col xs={24} lg={12}>
              <Card
                size="small"
                title={
                  <Space>
                    <FileTextOutlined style={{ color: BRAND.colors.primary }} />
                    <Text strong style={{ fontSize: 13 }}>学生成绩记录</Text>
                    <Tag style={{ borderRadius: 6, fontSize: 10 }}>
                      {useCaseData?.grades?.length || 0} 条
                    </Tag>
                  </Space>
                }
                style={{ borderRadius: 10, borderColor: BRAND.colors.border }}
                bodyStyle={{ padding: '8px 16px', maxHeight: 300, overflow: 'auto' }}
              >
                {(useCaseData?.grades?.length || 0) === 0 ? (
                  <div style={{ textAlign: 'center', padding: 20 }}>
                    <Text type="secondary">暂无成绩记录</Text>
                  </div>
                ) : (
                  (useCaseData?.grades || []).slice(0, 20).map((g: any, i: number) => (
                    <Row key={i} style={{ padding: '6px 0', borderBottom: i < Math.min((useCaseData?.grades?.length || 0), 20) - 1 ? `1px solid ${BRAND.colors.border}` : 'none' }}
                      justify="space-between" align="middle">
                      <Col>
                        <Space size={4}>
                          <Text style={{ fontSize: 12 }}>{g.name || g.student_name || g.student || g.studentId || '学生'}</Text>
                          <Tag style={{ borderRadius: 4, fontSize: 10 }}>{g.course_name || g.course || '-'}</Tag>
                        </Space>
                      </Col>
                      <Col>
                        <Text strong style={{
                          fontSize: 13,
                          color: (g.score || 0) >= 80 ? BRAND.colors.green : (g.score || 0) >= 60 ? BRAND.colors.orange : BRAND.colors.error,
                        }}>
                          {g.score != null ? `${g.score}分` : '-'}
                        </Text>
                      </Col>
                    </Row>
                  ))
                )}
              </Card>
            </Col>

            {/* ── 知识库文件列表 ── */}
            <Col xs={24} lg={12}>
              <Card
                size="small"
                title={
                  <Space>
                    <BookOutlined style={{ color: BRAND.colors.orange }} />
                    <Text strong style={{ fontSize: 13 }}>知识库文件资料</Text>
                    <Tag style={{ borderRadius: 6, fontSize: 10 }}>
                      {useCaseData?.collections?.length || kbStatus?.collections?.length || 0} 个集合
                    </Tag>
                  </Space>
                }
                style={{ borderRadius: 10, borderColor: BRAND.colors.border }}
                bodyStyle={{ padding: '8px 16px', maxHeight: 300, overflow: 'auto' }}
              >
                {((useCaseData?.collections || kbStatus?.collections || [])?.length || 0) === 0 ? (
                  <div style={{ textAlign: 'center', padding: 20 }}>
                    <Text type="secondary">暂无知识库文件</Text>
                  </div>
                ) : (
                  (useCaseData?.collections || kbStatus?.collections || []).slice(0, 20).map((col: any, i: number) => (
                    <Row key={i} style={{ padding: '6px 0', borderBottom: i < Math.min(((useCaseData?.collections || kbStatus?.collections || [])?.length || 0), 20) - 1 ? `1px solid ${BRAND.colors.border}` : 'none' }}
                      justify="space-between" align="middle">
                      <Col>
                        <Space size={4}>
                          <BookOutlined style={{ color: BRAND.colors.orange, fontSize: 12 }} />
                          <Text style={{ fontSize: 12 }}>{col.name || col.course || col.collection || '未命名'}</Text>
                        </Space>
                      </Col>
                      <Col>
                        {col.document_count != null ? (
                          <Tag style={{ borderRadius: 4, fontSize: 10, background: `${BRAND.colors.orange}10`, color: BRAND.colors.orange, border: 'none' }}>
                            {col.document_count} 份文档
                          </Tag>
                        ) : col.count != null ? (
                          <Tag style={{ borderRadius: 4, fontSize: 10 }}>{col.count} 条</Tag>
                        ) : null}
                      </Col>
                    </Row>
                  ))
                )}
              </Card>
            </Col>
          </Row>

          {/* ── 课程信息行 ── */}
          {(visible && (useCaseData?.courses?.length || (stats?.courses || [])?.length || 0) > 0) && (
            <Row gutter={[12, 8]} style={{ marginTop: 16 }}>
              <Col span={24}>
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                  📋 课程 / 班级信息
                </Text>
                <Space wrap size={[8, 8]}>
                  {(useCaseData?.courses || stats?.courses || []).map((c: any, i: number) => {
                    const courseLabel = c.course || c.name || '';
                    if (!courseLabel) return null;  // 跳过空名称的记录
                    return (
                    <Tag key={i}
                      style={{
                        borderRadius: 8,
                        padding: '4px 12px',
                        fontSize: 12,
                        background: `${BRAND.colors.purple}08`,
                        color: BRAND.colors.purple,
                        border: `1px solid ${BRAND.colors.purple}25`,
                      }}
                    >
                      <Space size={4}>
                        <BookOutlined style={{ fontSize: 11 }} />
                        {courseLabel}
                        {c.student_count != null && (
                          <span style={{ opacity: 0.7 }}>· {c.student_count}人</span>
                        )}
                      </Space>
                    </Tag>
                    );
                  })}
                </Space>
              </Col>
            </Row>
          )}
        </Card>
      )}

      {/* ════════════════════════════════════════════ */}
      {/* 快捷功能 + 近期待办 + 成绩概览            */}
      {/* ════════════════════════════════════════════ */}
      <Row gutter={[16, 16]}>
        {/* ── 快捷功能（渐变分色卡片） ── */}
        <Col xs={24} lg={6}>
          <Card
            className="brand-card"
            title={
              <Space>
                <ThunderboltOutlined style={{ color: BRAND.colors.primary }} />
                <Text strong>快捷功能</Text>
              </Space>
            }
            bodyStyle={{ padding: '16px 20px' }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              {quickActions.map(item => (
                <Card
                  key={item.key}
                  hoverable
                  size="small"
                  bodyStyle={{ padding: '12px 16px' }}
                  style={{
                    border: 'none',
                    borderRadius: 10,
                    background: item.gradient,
                    cursor: 'pointer',
                    transition: CARD_SPECS.transition,
                  }}
                  className="brand-card"
                  onClick={() => navigate(item.key)}
                >
                  <Space>
                    <Avatar icon={item.icon} style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff' }} />
                    <div>
                      <Space size={4}>
                        <Text strong style={{ fontSize: 13, color: '#fff' }}>{item.title}</Text>
                        {(item as any).badge && (item as any).badge > 0 && (
                          <Tag color="red" style={{ borderRadius: 10, fontSize: 10, margin: 0, lineHeight: '16px' }}>
                            {(item as any).badge}
                          </Tag>
                        )}
                      </Space>
                      <br />
                      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{item.desc}</Text>
                    </div>
                  </Space>
                </Card>
              ))}
            </Space>

            {/* 系统状态 */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid ' + BRAND.colors.border }}>
              <Text strong style={{ fontSize: 13, color: BRAND.colors.textPrimary }}>系统状态</Text>
              <Row gutter={8} style={{ marginTop: 8 }}>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>知识库文档</Text>
                  <br />
                  <Text strong style={{ color: BRAND.colors.primary }}>{kbDocs}</Text>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>知识库切片</Text>
                  <br />
                  <Text strong style={{ color: BRAND.colors.primary }}>{kbChunks}</Text>
                </Col>
              </Row>
              <Tag color="success" style={{ marginTop: 8, borderRadius: 8 }}>LLM 服务已连接</Tag>
            </div>
          </Card>
        </Col>

        {/* ── 近期待办 ── */}
        <Col xs={24} lg={9}>
          <Card
            className="brand-card"
            title={
              <Space>
                <ClockCircleOutlined style={{ color: BRAND.colors.orange }} />
                <Text strong>近期待办</Text>
              </Space>
            }
            bodyStyle={{ padding: '12px 20px' }}
          >
            <List
              dataSource={pendingItems}
              locale={{ emptyText: visible ? '暂无待办' : '📭 隐藏模式下不显示用例待办' }}
              renderItem={item => (
                <List.Item
                  style={{ cursor: 'pointer', padding: '12px 0', borderBottom: '1px solid ' + BRAND.colors.border }}
                  onClick={() => navigate('/homework')}
                  extra={
                    <Tag
                      color={item.urgent ? 'error' : 'default'}
                      style={{ borderRadius: 10, fontSize: 11 }}
                    >
                      {item.deadline}
                    </Tag>
                  }
                >
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, width: '100%' }}>
                    {/* 紧急标记竖条 */}
                    {item.urgent && <div className="urgent-bar" style={{ minHeight: 40 }} />}

                    <List.Item.Meta
                      avatar={
                        <Avatar
                          icon={<FileTextOutlined />}
                          style={{
                            backgroundColor: item.urgent ? BRAND.colors.error : BRAND.colors.primary,
                            boxShadow: item.urgent ? `0 0 8px ${BRAND.colors.error}40` : 'none',
                          }}
                        />
                      }
                      title={
                        <Space>
                          <Text strong style={{ fontSize: 13, color: BRAND.colors.textPrimary }}>
                            {item.title}
                          </Text>
                          {item.urgent && (
                            <Tag color="error" style={{ borderRadius: 8, fontSize: 10, lineHeight: '18px' }}>
                              紧急
                            </Tag>
                          )}
                        </Space>
                      }
                      description={
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.submissions} 份提交
                        </Text>
                      }
                    />
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>

        {/* ── 班级成绩概览 ── */}
        <Col xs={24} lg={9}>
          <Card
            className="brand-card"
            title={
              <Space>
                <BarChartOutlined style={{ color: BRAND.colors.green }} />
                <Text strong>班级成绩概览</Text>
              </Space>
            }
            bodyStyle={{ padding: '12px 20px' }}
          >
            <Table
              dataSource={(() => {
                const allAvgs = gradeClasses.map((c: any) => c.avg_score).filter((v: number) => v > 0);
                const overallAvg = allAvgs.length > 0 ? allAvgs.reduce((a: number, b: number) => a + b, 0) / allAvgs.length : 0;
                return gradeClasses.map((c: any) => {
                  const diff = Math.round((c.avg_score || 0) - overallAvg);
                  return {
                    key: c.key, label: `${c.course} · ${c.className}`, avgScore: c.avg_score,
                    passRate: c.pass_rate, trend: diff > 0 ? 'up' : diff < 0 ? 'down' : '-',
                    trendDiff: Math.abs(diff), attention: (c.avg_score || 100) < 75,
                    failedCount: c.failed_count || 0, studentCount: c.student_count,
                  };
                });
              })()}
              pagination={false}
              size="small"
              className="table-header-brand"
              locale={{ emptyText: visible ? '暂无班级数据' : '📭 隐藏模式 · 显示用例数据后可查看' }}
              columns={[
                {
                  title: '班级',
                  dataIndex: 'label',
                  key: 'label',
                  render: (v: string) => (
                    <Space>
                      <BookOutlined style={{ color: BRAND.colors.primary }} />
                      <Text strong style={{ color: BRAND.colors.textPrimary, fontSize: 12 }}>{v}</Text>
                    </Space>
                  ),
                },
                { title: '人数', dataIndex: 'studentCount', key: 'studentCount', width: 50,
                  render: (v: number) => <Text style={{ fontSize: 12 }}>{v}</Text>,
                },
                {
                  title: '平均分',
                  dataIndex: 'avgScore',
                  key: 'avgScore',
                  width: 65,
                  render: (v: number) => (
                    <Text strong style={{
                      color: v >= 80 ? BRAND.colors.green : v >= 60 ? BRAND.colors.orange : BRAND.colors.error,
                      fontSize: 15,
                    }}>
                      {v}
                    </Text>
                  ),
                },
                {
                  title: '通过率',
                  dataIndex: 'passRate',
                  key: 'passRate',
                  render: (v: number) => (
                    <Progress
                      percent={Math.round(v)}
                      size="small"
                      strokeColor={v >= 90 ? BRAND.colors.green : v >= 60 ? BRAND.colors.orange : BRAND.colors.error}
                      trailColor="#E8EEF8"
                      style={{ width: 60 }}
                    />
                  ),
                },
                {
                  title: '趋势',
                  dataIndex: 'trend',
                  key: 'trend',
                  width: 70,
                  render: (_t: string, r: any) => r.trend === 'up'
                    ? <Tag color="success" style={{ borderRadius: 8, fontSize: 11 }}>↑{r.trendDiff}</Tag>
                    : r.trend === 'down'
                    ? <Tag color="error" style={{ borderRadius: 8, fontSize: 11 }}>↓{r.trendDiff}</Tag>
                    : <Tag style={{ borderRadius: 8, fontSize: 10, color: '#999' }}>---</Tag>,
                },
              ]}
            />
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid ' + BRAND.colors.border }}>
              <Space style={{ marginBottom: 8 }}>
                <WarningOutlined style={{ color: BRAND.colors.orange }} />
                <Text type="secondary" style={{ fontSize: 12 }}>需要重点关注：</Text>
              </Space>
              {gradeClasses.filter((c: any) => c.failed_count > 0).slice(0, 3).map((c: any) => (
                <div key={c.key} style={{ marginBottom: 6 }}>
                  <Tag color="error" style={{ borderRadius: 8 }}>
                    <Space size={4}>
                      <BrandBadge />
                      <span>{c.course} · {c.className} · {c.failed_count}人不及格</span>
                    </Space>
                  </Tag>
                </div>
              ))}
              {gradeClasses.filter((c: any) => c.failed_count > 0).length === 0 && (
                <Tag color="success" style={{ borderRadius: 8 }}>暂无预警班级</Tag>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* ════════════════════════════════════════════ */}
      {/* 底部：技术架构 + 品牌水印              */}
      {/* ════════════════════════════════════════════ */}
      <Card
        className="brand-card"
        style={{ marginTop: 24, background: '#FAFBFF' }}
        bodyStyle={{ padding: '14px 22px' }}
      >
        <Row justify="space-between" align="middle">
          <Col>
            <Space wrap>
              <Text type="secondary" style={{ fontSize: 12 }}>技术架构：</Text>
              <Tag style={{ borderRadius: 6 }}>FastAPI</Tag>
              <Tag style={{ borderRadius: 6 }}>React 18</Tag>
              <Tag style={{ borderRadius: 6 }}>Ant Design</Tag>
              <Tag style={{ borderRadius: 6 }}>RAG</Tag>
              <Tag style={{ borderRadius: 6 }}>PyTorch</Tag>
              <Tag style={{ borderRadius: 6, borderColor: BRAND.colors.primary }} color="blue">LLM</Tag>
              <Tag style={{ borderRadius: 6, borderColor: BRAND.colors.purple }} color="purple">AI 课程教学</Tag>
            </Space>
          </Col>
          <Col>
            <Space>
              <BrandBadge />
              <Text type="secondary" style={{ fontSize: 11, color: BRAND.colors.textTertiary }}>
                AI 赋能 AI 教学 · 垂类大模型赛道
              </Text>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 品牌水印 */}
      <div className="brand-watermark">{BRAND.watermark}</div>
    </div>
  );
};

export default Dashboard;
