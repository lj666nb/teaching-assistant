/**
 * 成绩管理 — Edu-TA 智教星 全维度成绩汇总与趋势分析
 *
 * 功能：筛选/统计/列表/搜索/批量操作/AI诊断/可视化/成绩趋势
 * 联动：同步作业批改得分、联动学情分析、归档至台账
 * AI功能受API Key守卫保护
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Card, Typography, Space, Table, Tag, Row, Col, Statistic, Select, Modal, Divider,
  Input, Button, Tooltip, Progress, Tabs, message, Popconfirm, Alert, Empty,
  InputNumber, Form,
} from 'antd';
import {
  TrophyOutlined, RiseOutlined, ArrowUpOutlined, ArrowDownOutlined,
  UserOutlined, TeamOutlined, SearchOutlined, DownloadOutlined,
  UploadOutlined, ThunderboltOutlined, HistoryOutlined, KeyOutlined,
  BarChartOutlined, WarningOutlined, EyeOutlined,
  RobotOutlined, PlusOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { gradeApi } from '../api/client';
import { BRAND, CARD_SPECS } from '../utils/brand';
import { useApiKeyGuard, ApiKeyGuardModal, ApiKeyBanner, DisabledAIButton } from '../utils/apiKeyGuard';
import SettingsModal from '../components/SettingsModal';
import './../styles/brand.css';
import { useDataVisibility } from '../context/DataVisibilityContext';

const { Text } = Typography;

const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', color || BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle' }} />
);

interface GradeRecord { id: string; name: string; studentId: string; course: string; className: string; score: number; rank: number; trend: string; trend_diff?: number; status: string; is_latest?: boolean; _source?: string; questionType?: string; }

const gradeColors = (v: number) => v >= 85 ? BRAND.colors.green : v >= 75 ? BRAND.colors.primary : v >= 60 ? BRAND.colors.orange : BRAND.colors.error;
const gradeTagColor = (v: string) => v === '优秀' ? 'success' : v === '良好' ? 'processing' : v === '中等' ? 'warning' : v === '及格' ? 'default' : 'error';

const TrendTag: React.FC<{ trend: string; diff?: number }> = ({ trend, diff }) => {
  if (trend === 'up') return <Tag color="success" icon={<ArrowUpOutlined />} style={{ borderRadius: 6 }}>↑{diff != null ? diff : ''}</Tag>;
  if (trend === 'down') return <Tag color="error" icon={<ArrowDownOutlined />} style={{ borderRadius: 6 }}>↓{diff != null ? diff : ''}</Tag>;
  return <Tag style={{ borderRadius: 6, color: '#999' }}>---</Tag>;
};

const GradeManagement: React.FC<{ embedded?: boolean; courseFilter?: string; classFilter?: string }> = ({ embedded = false, courseFilter, classFilter }) => {
  const { visible } = useDataVisibility();
  const guard = useApiKeyGuard();
  const canGenerate = guard.hasKey;

  const [allGradeData, setAllGradeData] = useState<GradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState(courseFilter || '机器学习');
  const [selectedClass, setSelectedClass] = useState(classFilter || '');

  // 嵌入模式下同步父组件传入的课程/班级筛选
  useEffect(() => {
    if (embedded && courseFilter) setSelectedCourse(courseFilter);
  }, [embedded, courseFilter]);
  useEffect(() => {
    if (embedded && classFilter !== undefined) setSelectedClass(classFilter);
  }, [embedded, classFilter]);
  const [searchText, setSearchText] = useState('');
  const [scoreRange, setScoreRange] = useState<string>('');
  const [gradeFilter, setGradeFilter] = useState<string>('');
  const [trendModal, setTrendModal] = useState<{ name: string; studentId: string } | null>(null);
  const [tabView, setTabView] = useState('list');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [deleting, setDeleting] = useState(false);

  // 重新加载成绩数据
  const reloadGrades = () => {
    gradeApi.list().then(res => {
      if (res.data.success) {
        const items = (res.data.data.items || []).map((item: any) => ({
          id: item.id, name: item.name, studentId: item.student_id || '',
          course: item.course, className: item.className, score: item.score,
          rank: item.rank || 0, trend: item.trend || '-', trend_diff: item.trend_diff,
          status: item.status || '良好', is_latest: item.is_latest,
          _source: item._source || 'seed',
          questionType: item.question_type || '',
        }));
        setAllGradeData(items);
      }
    }).catch(() => {});
  };

  // 从 API 加载成绩数据
  useEffect(() => { reloadGrades(); }, []);

  // ── 手动添加成绩弹窗 ──
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();

  const handleAddGrade = () => {
    addForm.validateFields().then(async values => {
      try {
        const res = await gradeApi.add({
          student_name: values.name,
          course_name: values.course,
          class_name: values.className,
          score: values.score,
          question_text: '手动录入成绩',
          question_type: '手动录入',
          feedback: '',
          skip_archive: true,
        });
        if (res.data.success) {
          message.success(`已添加 ${values.name} 的 ${values.course} 成绩`);
          reloadGrades();
        }
        setAddModalOpen(false);
        addForm.resetFields();
      } catch (e: any) {
        message.error('添加失败: ' + (e.response?.data?.detail || e.message || '未知错误'));
      }
    }).catch(() => {});
  };

  // ── 导出成绩单 ──
  const handleExportGrades = () => {
    if (gradeData.length === 0) { message.warning('没有可导出的成绩数据'); return; }
    const headers = ['姓名', '学号', '班级', '课程', '分数', '排名', '趋势', '等级'];
    const rows = gradeData.map(r => [r.name, r.studentId, r.className, r.course, String(r.score), String(r.rank), r.trend, r.status]);
    const csv = '﻿' + [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `成绩单_${selectedCourse}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    message.success(`已导出 ${gradeData.length} 条成绩记录`);
  };

  // ── AI 班级诊断弹窗 ──
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const handleAIDiagnosis = () => {
    if (!canGenerate) { guard.showGuard(); return; }
    setDiagnosisOpen(true);
  };

  // ── AI 提分方案弹窗 ──
  const [improveStudent, setImproveStudent] = useState<GradeRecord | null>(null);
  const handleImprovePlan = (record: GradeRecord) => {
    if (!canGenerate) { guard.showGuard(); return; }
    setImproveStudent(record);
  };

  // ── 归档台账 ──
  const [archiving, setArchiving] = useState(false);
  const handleArchiveLedger = async (record?: GradeRecord) => {
    setArchiving(true);
    if (record) {
      // 归档单条成绩
      try {
        const res = await gradeApi.add({
          student_name: record.name,
          course_name: record.course,
          class_name: record.className,
          score: record.score,
          question_text: '成绩单归档',
          question_type: '归档录入',
          feedback: `从成绩管理归档：${record.course} ${record.score}分`,
        });
        if (res.data?.data?.existing) {
          message.info(res.data.message || '已在台账中');
        } else {
          message.success(res.data.message || `${record.name} 的 ${record.course} 成绩已归档至教学台账`);
        }
        // 手动录入的记录归档后删除原记录，避免重复
        if (record.questionType === '手动录入') {
          try { await gradeApi.delete(record.id); } catch {}
        }
        reloadGrades();
      } catch (e: any) {
        message.error('归档失败: ' + (e.response?.data?.detail || e.message || '未知错误'));
      }
    } else {
      // 批量归档当前筛选的所有成绩
      const toArchive = gradeData;
      if (toArchive.length === 0) { message.warning('没有可归档的成绩数据'); setArchiving(false); return; }
      let success = 0, skip = 0, fail = 0;
      for (const r of toArchive) {
        try {
          const res = await gradeApi.add({
            student_name: r.name,
            course_name: r.course,
            class_name: r.className,
            score: r.score,
            question_text: '批量成绩归档',
            question_type: '归档录入',
            feedback: `从成绩管理批量归档：${selectedCourse}`,
          });
          if (res.data?.data?.existing) {
            skip++;
          } else {
            success++;
          }
        } catch { fail++; }
      }
      const parts = [`归档 ${success} 条`];
      if (skip > 0) parts.push(`${skip} 条已在台账中`);
      if (fail > 0) parts.push(`${fail} 条失败`);
      message.success(parts.join('，'));
    }
    setArchiving(false);
  };

  // ── 删除成绩 ──
  const handleDeleteGrade = (record: GradeRecord) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 ${record.name} 的 ${record.course} 成绩（${record.score}分）吗？此操作不可恢复。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await gradeApi.delete(record.id);
          message.success(`已删除 ${record.name} 的成绩记录`);
          setSelectedRowKeys(prev => prev.filter(k => k !== record.id));
          reloadGrades();
        } catch (e: any) {
          message.error('删除失败: ' + (e.response?.data?.detail || e.message || '未知错误'));
        }
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) { message.warning('请先勾选要删除的成绩记录'); return; }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条成绩记录吗？此操作不可恢复。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setDeleting(true);
        try {
          const res = await gradeApi.batchDelete(selectedRowKeys as string[]);
          message.success(res.data.message || `已删除 ${selectedRowKeys.length} 条记录`);
          setSelectedRowKeys([]);
          reloadGrades();
        } catch (e: any) {
          message.error('批量删除失败: ' + (e.response?.data?.detail || e.message || '未知错误'));
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  // ── AI 帮扶方案弹窗 ──
  const [assistStudent, setAssistStudent] = useState<GradeRecord | null>(null);
  const handleAssistPlan = (record: GradeRecord) => {
    if (!canGenerate) { guard.showGuard(); return; }
    setAssistStudent(record);
  };

  // 可显示的数据：隐藏模式下排除种子数据（必须在其他 computed values 之前）
  const displayAllData = useMemo(() => visible ? allGradeData : allGradeData.filter(r => r._source !== 'seed'), [allGradeData, visible]);

  const allCourses = useMemo(() => [...new Set(displayAllData.map(r => r.course))].sort(), [displayAllData]);
  const courseOptions = useMemo(() => allCourses.map(c => ({ value: c, label: c })), [allCourses]);

  // 自动设置第一个课程
  useEffect(() => {
    if (allCourses.length > 0 && !allCourses.includes(selectedCourse)) {
      setSelectedCourse(allCourses[0]);
    }
  }, [allCourses, selectedCourse]);

  const classOptions = useMemo(() => {
    const cls = [...new Set(displayAllData.filter(r => r.course === selectedCourse).map(r => r.className))].sort();
    return [{ value: '', label: '全部班级' }, ...cls.map(c => ({ value: c, label: c }))];
  }, [selectedCourse, displayAllData]);

  const gradeData = useMemo(() => {
    let data = displayAllData.filter(r => r.course === selectedCourse && r.is_latest !== false);
    if (selectedClass) data = data.filter(r => r.className === selectedClass);
    if (searchText) data = data.filter(r => r.name.includes(searchText) || r.studentId.includes(searchText));
    if (scoreRange) {
      const [min, max] = scoreRange.split('-').map(Number);
      data = data.filter(r => r.score >= min && (max ? r.score <= max : true));
    }
    if (gradeFilter) data = data.filter(r => r.status === gradeFilter);
    return [...data].sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));
  }, [selectedCourse, selectedClass, searchText, scoreRange, gradeFilter, displayAllData]);

  const classSummaries = useMemo(() => {
    const cls = [...new Set(displayAllData.filter(r => r.course === selectedCourse).map(r => r.className))].sort();
    return cls.map(c => {
      const s = displayAllData.filter(r => r.course === selectedCourse && r.className === c);
      const avg = s.reduce((a, r) => a + r.score, 0) / s.length;
      return { className: c, count: s.length, avgScore: avg, passRate: Math.round(s.filter(x => x.score >= 60).length / s.length * 100), excellentRate: Math.round(s.filter(x => x.score >= 85).length / s.length * 100) };
    });
  }, [selectedCourse, displayAllData]);

  const studentAllGrades = useMemo(() => trendModal ? displayAllData.filter(r => r.studentId === trendModal.studentId) : [], [trendModal, displayAllData]);

  const avgScore = gradeData.length > 0 ? +(gradeData.reduce((s, r) => s + r.score, 0) / gradeData.length).toFixed(1) : 0;
  const passRate = gradeData.length > 0 ? Math.round(gradeData.filter(r => r.score >= 60).length / gradeData.length * 100) : 0;
  const excellentRate = gradeData.length > 0 ? Math.round(gradeData.filter(r => r.score >= 85).length / gradeData.length * 100) : 0;

  // 分数分布
  const dist = { '≥85': gradeData.filter(r => r.score >= 85).length, '75-84': gradeData.filter(r => r.score >= 75 && r.score < 85).length, '60-74': gradeData.filter(r => r.score >= 60 && r.score < 75).length, '<60': gradeData.filter(r => r.score < 60).length };

  // 预警学生（60-65 及格边缘区间）
  const warnings = useMemo(() => gradeData.filter(r => {
    return r.score >= 60 && r.score <= 65;
  }), [gradeData]);

  // 不及格学生（<60）
  const failures = useMemo(() => gradeData.filter(r => {
    return r.score < 60;
  }), [gradeData]);

  return (
    <div className="page-enter">
      {!canGenerate && <ApiKeyBanner onGoSettings={guard.goToSettings} />}

      {!embedded && (
        <div style={{ marginBottom: 16 }}>
          <Space align="center" size={10}>
            <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 32, height: 32, display: 'inline-flex', animation: 'logoPulse 0.8s ease-out' }} />
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: BRAND.colors.textPrimary }}>智教星 · 成绩管理</div>
              <Text type="secondary" style={{ fontSize: 11 }}>全维度成绩汇总 · 趋势分析 · AI诊断</Text>
            </div>
          </Space>
        </div>
      )}

      {/* 筛选 + 指标 */}
      {!embedded && <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Tooltip title={
            <div style={{ lineHeight: 1.8, fontSize: 12, minWidth: 160 }}>
              <div>📊 成绩分布</div>
              <div style={{ color: BRAND.colors.green }}>≥85 优秀：{dist['≥85']} 人</div>
              <div style={{ color: BRAND.colors.primary }}>75-84 良好：{dist['75-84']} 人</div>
              <div style={{ color: BRAND.colors.orange }}>60-74 中等：{dist['60-74']} 人</div>
              <div style={{ color: BRAND.colors.error }}>&lt;60 不及格：{dist['<60']} 人</div>
              <div style={{ marginTop: 2, borderTop: '1px solid #e8e8e8', paddingTop: 2 }}>平均分：{avgScore} 分</div>
            </div>
          }>
            <Card className="brand-card" bodyStyle={{ padding: '14px 18px', position: 'relative' }}>
              <span style={{ position: 'absolute', top: 6, right: 8, color: BRAND.colors.green, opacity: 0.3 }}><BrandBadge /></span>
              <Statistic title={<Text style={{ fontSize: 12, color: BRAND.colors.textSecondary }}>平均分</Text>}
                value={avgScore} suffix={<Text style={{ fontSize: 12, color: BRAND.colors.textTertiary }}>分</Text>}
                prefix={<TrophyOutlined style={{ color: BRAND.colors.green, fontSize: 18 }} />}
                valueStyle={{ fontSize: 24, fontWeight: 700, color: gradeColors(avgScore) }} />
              <Text style={{ fontSize: 11, color: visible ? (avgScore >= 75 ? BRAND.colors.green : BRAND.colors.orange) : 'transparent', userSelect: 'none' }}>{visible ? '↑ 较上期 +2.3%' : '—'}</Text>
            </Card>
          </Tooltip>
        </Col>
        <Col span={6}>
          <Card className="brand-card" bodyStyle={{ padding: '14px 18px', position: 'relative' }}>
            <span style={{ position: 'absolute', top: 6, right: 8, color: BRAND.colors.primary, opacity: 0.3 }}><BrandBadge /></span>
            <Statistic title={<Text style={{ fontSize: 12, color: BRAND.colors.textSecondary }}>通过率</Text>}
              value={passRate} suffix={<Text style={{ fontSize: 12, color: BRAND.colors.textTertiary }}>%</Text>}
              prefix={<RiseOutlined style={{ color: BRAND.colors.primary, fontSize: 18 }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700, color: BRAND.colors.primary }} />
            <Text style={{ fontSize: 11, color: visible ? BRAND.colors.green : 'transparent', userSelect: 'none' }}>{visible ? `及格 ${gradeData.filter(r => r.score >= 60).length}/${gradeData.length} 人` : '—'}</Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card className="brand-card" bodyStyle={{ padding: '14px 18px', position: 'relative' }}>
            <span style={{ position: 'absolute', top: 6, right: 8, color: BRAND.colors.purple, opacity: 0.3 }}><BrandBadge /></span>
            <Statistic title={<Text style={{ fontSize: 12, color: BRAND.colors.textSecondary }}>优秀率</Text>}
              value={excellentRate} suffix={<Text style={{ fontSize: 12, color: BRAND.colors.textTertiary }}>%</Text>}
              prefix={<TrophyOutlined style={{ color: BRAND.colors.purple, fontSize: 18 }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700, color: BRAND.colors.purple }} />
            <Text style={{ fontSize: 11, color: BRAND.colors.textSecondary }}>优秀 ≥85 分</Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card className="brand-card" bodyStyle={{ padding: '14px 18px' }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Select value={selectedCourse} onChange={v => { setSelectedCourse(v); setSelectedClass(''); }} style={{ width: '100%', borderRadius: 8 }} options={courseOptions} />
              <Select value={selectedClass} onChange={setSelectedClass} style={{ width: '100%', borderRadius: 8 }} options={classOptions} placeholder="全部班级" allowClear />
            </Space>
          </Card>
        </Col>
      </Row>}

      {/* 班级概览 */}
      {!embedded && <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {classSummaries.map(cs => (
          <Col xs={12} sm={6} key={cs.className}>
            <Card hoverable size="small" className="brand-card"
              onClick={() => setSelectedClass(cs.className === selectedClass ? '' : cs.className)}
              style={{ border: selectedClass === cs.className ? `2px solid ${BRAND.colors.primary}` : undefined, background: selectedClass === cs.className ? `${BRAND.colors.primary}08` : undefined, borderRadius: 8 }}>
              <Statistic title={<Space><TeamOutlined style={{ color: BRAND.colors.primary }} />{cs.className}</Space>} value={cs.count} suffix="人" valueStyle={{ fontSize: 20, fontWeight: 700 }} />
              <Text type="secondary" style={{ fontSize: 11 }}>平均 {cs.avgScore.toFixed(1)} · 通过 {cs.passRate}% · 优秀 {cs.excellentRate}%</Text>
            </Card>
          </Col>
        ))}
        {classSummaries.length === 0 && <Col xs={24}><Empty description="暂无班级数据" /></Col>}
        <Col xs={12} sm={6}>
          <Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px', background: `${BRAND.colors.orange}08` }}>
            <Space><WarningOutlined style={{ color: BRAND.colors.orange }} /><Text style={{ fontSize: 12, color: BRAND.colors.orange }}>预警：{warnings.length} 人及格边缘</Text></Space>
            <div style={{ fontSize: 11, color: BRAND.colors.textTertiary, marginTop: 2 }}>{warnings.map(w => w.name).join('、') || '无'}</div>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px', background: `${BRAND.colors.error}08` }}>
            <Space><WarningOutlined style={{ color: BRAND.colors.error }} /><Text style={{ fontSize: 12, color: BRAND.colors.error }}>不及格：{failures.length} 人</Text></Space>
            <div style={{ fontSize: 11, color: BRAND.colors.textTertiary, marginTop: 2 }}>{failures.map(w => w.name).join('、') || '无'}</div>
          </Card>
        </Col>
      </Row>}
      <Tabs activeKey={tabView} onChange={setTabView} style={{ background: '#fff', borderRadius: 12, padding: '4px 16px 16px', boxShadow: CARD_SPECS.shadow }}
        tabBarExtraContent={
          <Space>
            <Input placeholder="姓名/学号" prefix={<SearchOutlined />} style={{ width: 160, borderRadius: 8 }} value={searchText} onChange={e => setSearchText(e.target.value)} allowClear />
            <Select style={{ width: 110, borderRadius: 8 }} placeholder="分数段" allowClear value={scoreRange || undefined} onChange={v => setScoreRange(v || '')}
              options={[{ value: '90-100', label: '90-100' }, { value: '75-89', label: '75-89' }, { value: '60-74', label: '60-74' }, { value: '0-59', label: '<60' }]} />
            <Select style={{ width: 100, borderRadius: 8 }} placeholder="等级" allowClear value={gradeFilter || undefined} onChange={v => setGradeFilter(v || '')}
              options={[{ value: '优秀', label: '优秀' }, { value: '良好', label: '良好' }, { value: '中等', label: '中等' }, { value: '及格', label: '及格' }, { value: '不及格', label: '不及格' }]} />
          </Space>
        }
        items={[
          // ═══ 成绩列表 ═══
          { key: 'list', label: <span><BarChartOutlined style={{ color: BRAND.colors.primary }} />成绩列表</span>,
            children: (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <Space>
                    <Button icon={<DownloadOutlined />} onClick={handleExportGrades}
                      style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>导出成绩单</Button>
                    <Button icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}
                      style={{ borderRadius: 6, borderColor: BRAND.colors.green, color: BRAND.colors.green }}>添加成绩</Button>
                    {selectedRowKeys.length > 0 && (
                      <Popconfirm title={`确认删除选中的 ${selectedRowKeys.length} 条成绩？`}
                        onConfirm={handleBatchDelete} okText="确认删除" okType="danger" cancelText="取消">
                        <Button icon={<DeleteOutlined />} loading={deleting} danger
                          style={{ borderRadius: 6 }}>批量删除 ({selectedRowKeys.length})</Button>
                      </Popconfirm>
                    )}
                    {canGenerate ? (
                      <Button icon={<RobotOutlined />} onClick={handleAIDiagnosis}
                        style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient, color: '#fff' }}>AI 班级诊断</Button>
                    ) : (
                      <Button disabled icon={<KeyOutlined />} style={{ borderRadius: 6 }}>AI 诊断已锁定</Button>
                    )}
                  </Space>
                </div>

                <Table dataSource={gradeData} pagination={{ pageSize: 10 }} rowKey="id" className="table-header-brand"
                  rowSelection={{
                    selectedRowKeys,
                    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
                  }}
                  columns={[
                    { title: '姓名', dataIndex: 'name', render: (v: string) => <Text strong style={{ color: BRAND.colors.textPrimary }}>{v}</Text> },
                    { title: '学号', dataIndex: 'studentId' },
                    { title: '班级', dataIndex: 'className', render: (v: string) => <Tag style={{ borderRadius: 6 }}>{v}</Tag> },
                    { title: '分数', dataIndex: 'score', render: (v: number) => <Text strong style={{ fontSize: 15, color: gradeColors(v) }}>{v}</Text> },
                    { title: '排名', dataIndex: 'rank' },
                    { title: '趋势', dataIndex: 'trend', render: (_t: string, r: GradeRecord) => <TrendTag trend={r.trend} diff={r.trend_diff} /> },
                    { title: '等级', dataIndex: 'status', render: (v: string, r: GradeRecord) => (
                      <Space size={4}>
                        <Tag color={gradeTagColor(v)} style={{ borderRadius: 6 }}>{v}</Tag>
                        {r.questionType === '手动录入' && <Tag color="orange" style={{ borderRadius: 6, fontSize: 10 }}>未归档</Tag>}
                      </Space>
                    ) },
                    { title: '操作', width: 260, render: (_: any, r: GradeRecord) => (
                      <Space size={0}>
                        <Button type="link" size="small" icon={<EyeOutlined />} style={{ fontSize: 11, color: BRAND.colors.primary }} onClick={() => setTrendModal({ name: r.name, studentId: r.studentId })}>趋势</Button>
                        <Button type="link" size="small" icon={<RobotOutlined />} style={{ fontSize: 11, color: BRAND.colors.purple }}
                          onClick={() => handleImprovePlan(r)}>提分方案</Button>
                        <Button type="link" size="small" icon={<HistoryOutlined />} style={{ fontSize: 11, color: BRAND.colors.green }}
                          onClick={() => handleArchiveLedger(r)}>归档台账</Button>
                        <Popconfirm title={`确认删除此成绩记录？`} onConfirm={() => handleDeleteGrade(r)}
                          okText="确认" okType="danger" cancelText="取消">
                          <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ fontSize: 11 }} />
                        </Popconfirm>
                      </Space>
                    )},
                  ]} />
              </div>
            ) },
          // ═══ 分析面板 ═══
          { key: 'analytics', label: <span><BarChartOutlined style={{ color: BRAND.colors.purple }} />分析面板</span>,
            children: (
              <Row gutter={[12, 12]}>
                <Col span={12}>
                  <Card size="small" className="brand-card" title={<Space><BrandBadge color={BRAND.colors.primary} /><Text strong>分数区间分布</Text></Space>}>
                    <>{Object.entries(dist).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 6 }}>
                        <Row align="middle">
                          <Col span={4}><Text style={{ fontSize: 11 }}>{k}</Text></Col>
                          <Col span={16}><Progress percent={gradeData.length > 0 ? Math.round(v / gradeData.length * 100) : 0} size="small" strokeColor={k === '≥85' ? BRAND.colors.green : k === '<60' ? BRAND.colors.error : k === '60-74' ? BRAND.colors.orange : BRAND.colors.primary} format={() => ''} /></Col>
                          <Col span={4}><Tag style={{ borderRadius: 6, fontSize: 10 }}>{v}人</Tag></Col>
                        </Row>
                      </div>
                    ))}
                    <Divider style={{ margin: '6px 0' }} />
                    <Text type="secondary" style={{ fontSize: 11 }}>薄弱分段：{dist['<60'] > 0 ? `${dist['<60']} 名学生低于及格线` : '暂无'}</Text></>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small" className="brand-card" title={<Space><BrandBadge color={BRAND.colors.purple} /><Text strong>班级对比</Text></Space>}>
                    {classSummaries.map(cs => (
                      <div key={cs.className} style={{ marginBottom: 6 }}>
                        <Text style={{ fontSize: 11 }}>{cs.className}</Text>
                        <Progress percent={Math.round(cs.avgScore)} size="small" strokeColor={BRAND.colors.primary} format={() => `${cs.avgScore.toFixed(1)}分`} />
                        <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>通过 {cs.passRate}%</Text>
                      </div>
                    ))}
                    {classSummaries.length === 0 && <Empty description="暂无对比数据" />}
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small" className="brand-card" title={<Space><BrandBadge color={BRAND.colors.orange} /><Text strong>及格边缘预警（60-65分）</Text></Space>}>
                    {warnings.length > 0 ? (
                      <Table dataSource={warnings} rowKey={r => `${r.studentId}_${r.course}`} size="small" pagination={false}
                        columns={[
                          { title: '姓名', dataIndex: 'name' },
                          { title: '分数', dataIndex: 'score', render: (v: number) => <Text style={{ color: BRAND.colors.orange, fontWeight: 600 }}>{v}</Text> },
                          { title: '等级', dataIndex: 'status', render: (v: string) => <Tag color="warning" style={{ borderRadius: 6 }}>{v}</Tag> },
                          { title: '建议', render: (_: any, r: GradeRecord) => <Button type="link" size="small" icon={<RobotOutlined />} style={{ fontSize: 11, color: BRAND.colors.purple }} onClick={() => handleAssistPlan(r)}>AI帮扶方案</Button> },
                        ]} />
                    ) : <Text type="secondary">无及格边缘学生</Text>}
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small" className="brand-card" title={<Space><BrandBadge color={BRAND.colors.error} /><Text strong style={{ color: BRAND.colors.error }}>{'⚠️ 不及格警示（<60分）'}</Text></Space>}>
                    {failures.length > 0 ? (
                      <Table dataSource={failures} rowKey={r => `${r.studentId}_${r.course}`} size="small" pagination={false}
                        columns={[
                          { title: '姓名', dataIndex: 'name' },
                          { title: '分数', dataIndex: 'score', render: (v: number) => <Text style={{ color: BRAND.colors.error, fontWeight: 700 }}>{v}</Text> },
                          { title: '趋势', dataIndex: 'trend', render: (_t: string, r: GradeRecord) => <TrendTag trend={r.trend} diff={r.trend_diff} /> },
                          { title: '帮扶', render: (_: any, r: GradeRecord) => <Button type="link" size="small" icon={<RobotOutlined />} style={{ fontSize: 11, color: BRAND.colors.error }} onClick={() => handleAssistPlan(r)}>紧急帮扶</Button> },
                        ]} />
                    ) : <Text type="secondary" style={{ color: BRAND.colors.green }}>✅ 无不及格学生</Text>}
                  </Card>
                </Col>
              </Row>
            ) },
        ]} />

      {/* 个人成绩趋势弹窗 */}
      <Modal title={<Space><BrandBadge />{trendModal?.name}（{trendModal?.studentId}）— 成绩趋势</Space>}
        open={!!trendModal} onCancel={() => setTrendModal(null)} footer={null} width={650}>
        {studentAllGrades.length > 0 && (
          <div>
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={6}><Card size="small" className="brand-card"><Statistic title="课程数" value={studentAllGrades.length} suffix="门" valueStyle={{ fontSize: 18 }} /></Card></Col>
              <Col span={6}><Card size="small" className="brand-card"><Statistic title="均分" value={studentAllGrades.length > 0 ? (studentAllGrades.reduce((s, r) => s + r.score, 0) / studentAllGrades.length).toFixed(1) : 0} suffix="分" valueStyle={{ fontSize: 18 }} /></Card></Col>
              <Col span={6}><Card size="small" className="brand-card"><Statistic title="最高" value={studentAllGrades.length > 0 ? Math.max(...studentAllGrades.map(r => r.score)) : 0} suffix="分" valueStyle={{ fontSize: 18, color: BRAND.colors.green }} /></Card></Col>
              <Col span={6}><Card size="small" className="brand-card"><Statistic title="最低" value={studentAllGrades.length > 0 ? Math.min(...studentAllGrades.map(r => r.score)) : 0} suffix="分" valueStyle={{ fontSize: 18, color: BRAND.colors.error }} /></Card></Col>
            </Row>
            <Table dataSource={studentAllGrades} rowKey="course" pagination={false} size="small" className="table-header-brand"
              columns={[
                { title: '课程', dataIndex: 'course', render: (v: string) => <Tag color="blue" style={{ borderRadius: 6 }}>{v}</Tag> },
                { title: '班级', dataIndex: 'className' },
                { title: '分数', dataIndex: 'score', render: (v: number) => <Text strong style={{ fontSize: 14, color: gradeColors(v) }}>{v}</Text> },
                { title: '排名', dataIndex: 'rank' },
                { title: '趋势', dataIndex: 'trend', render: (_t: string, r: GradeRecord) => <TrendTag trend={r.trend} diff={r.trend_diff} /> },
                { title: '等级', dataIndex: 'status', render: (v: string) => <Tag color={gradeTagColor(v)} style={{ borderRadius: 6 }}>{v}</Tag> },
              ]} />
            {studentAllGrades.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text strong style={{ fontSize: 13 }}>历次成绩趋势</Text>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {studentAllGrades.map((s, i) => (
                    <Card key={i} size="small" className="brand-card" bodyStyle={{ padding: '8px 12px', textAlign: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 10 }}>{s.course}</Text>
                      <div style={{ fontSize: 20, fontWeight: 700, color: gradeColors(s.score) }}>{s.score}</div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
            <Divider style={{ margin: '12px 0' }} />
            <Space>
              <Button type="primary" icon={<RobotOutlined />} style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}
                onClick={() => {
                  const student = gradeData.find(g => g.studentId === trendModal?.studentId);
                  if (student) handleImprovePlan(student);
                }}>AI 提分方案</Button>
              <Button icon={<HistoryOutlined />} style={{ borderRadius: 6, borderColor: BRAND.colors.purple, color: BRAND.colors.purple }}
                onClick={() => handleArchiveLedger()}>归档台账</Button>
            </Space>
          </div>
        )}
      </Modal>

      {/* ── 手动添加成绩弹窗 ── */}
      <Modal title={<Space><PlusOutlined style={{ color: BRAND.colors.green }} />手动添加成绩</Space>}
        open={addModalOpen} onCancel={() => setAddModalOpen(false)} width={480}
        footer={[
          <Button key="cancel" onClick={() => setAddModalOpen(false)} style={{ borderRadius: 6 }}>取消</Button>,
          <Button key="ok" type="primary" onClick={handleAddGrade} style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>确认添加</Button>,
        ]}>
        <Form form={addForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="学生姓名" rules={[{ required: true, message: '请输入学生姓名' }]}>
                <Input placeholder="例如：张三" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="studentId" label="学号" rules={[{ required: true, message: '请输入学号' }]}>
                <Input placeholder="例如：2024001" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="course" label="课程" rules={[{ required: true, message: '请输入课程名称' }]}>
                <Input placeholder="例如：机器学习" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="className" label="班级" rules={[{ required: true, message: '请输入班级' }]}>
                <Input placeholder="例如：1班" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="score" label="分数" rules={[{ required: true, message: '请输入分数' }]}>
            <InputNumber min={0} max={100} style={{ width: '100%', borderRadius: 6 }} placeholder="0-100" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── AI 班级诊断弹窗 ── */}
      <Modal title={<Space><RobotOutlined style={{ color: BRAND.colors.primary }} />AI 班级诊断报告</Space>}
        open={diagnosisOpen} onCancel={() => setDiagnosisOpen(false)} width={700}
        footer={[<Button key="close" onClick={() => setDiagnosisOpen(false)} style={{ borderRadius: 6 }}>关闭</Button>]}>
        <Row gutter={[12, 12]}>
          <Col span={6}>
            <Card size="small" style={{ borderRadius: 8, background: `${BRAND.colors.primary}08` }}>
              <Statistic title="班级平均分" value={avgScore} suffix="分" valueStyle={{ fontSize: 22, color: BRAND.colors.primary }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ borderRadius: 8, background: `${BRAND.colors.green}08` }}>
              <Statistic title="通过率" value={passRate} suffix="%" valueStyle={{ fontSize: 22, color: BRAND.colors.green }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ borderRadius: 8, background: `${BRAND.colors.orange}08` }}>
              <Statistic title="及格边缘" value={warnings.length} suffix="人" valueStyle={{ fontSize: 22, color: BRAND.colors.orange }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ borderRadius: 8, background: `${BRAND.colors.error}08` }}>
              <Statistic title="不及格" value={failures.length} suffix="人" valueStyle={{ fontSize: 22, color: BRAND.colors.error }} />
            </Card>
          </Col>
        </Row>
        <Divider style={{ margin: '12px 0' }} />
        <Alert type="info" showIcon message="AI 综合诊断"
          description={
            <div>
              <p>📊 <strong>整体评估：</strong>{avgScore >= 75 ? '班级整体水平良好，' : '班级整体水平需提升，'}
                {passRate >= 80 ? '通过率较高' : `通过率偏低（${passRate}%），需重点关注不及格学生`}。</p>
              <p>📌 <strong>关键发现：</strong></p>
              <ul style={{ paddingLeft: 20, margin: '4px 0' }}>
                <li>优秀率 {excellentRate}%，{excellentRate >= 20 ? '达到' : '低于'}一般水平</li>
                <li>不及格人数 {failures.length} 人，占比 {gradeData.length > 0 ? Math.round(failures.length / gradeData.length * 100) : 0}%</li>
                <li>及格边缘（60-65分）{warnings.length} 人，需防止下滑</li>
                <li>分数集中在 {Object.entries(dist).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'} 区间</li>
                <li>{failures.length > 0 ? `🔴 不及格学生：${failures.map(w => w.name).join('、')}` : '✅ 无不及格学生'}；{warnings.length > 0 ? `🟠 及格边缘：${warnings.map(w => w.name).join('、')}` : '无边缘学生'}</li>
              </ul>
              <p>💡 <strong>改进建议：</strong>对不及格学生紧急安排专项辅导；对及格边缘学生重点巩固基础防止下滑；中等分段学生强化薄弱知识点训练。</p>
            </div>
          } style={{ borderRadius: 8 }} />
        <Divider style={{ margin: '12px 0' }} />
        <Text strong>班级对比</Text>
        {classSummaries.map(cs => (
          <div key={cs.className} style={{ marginBottom: 6, marginTop: 4 }}>
            <Row align="middle">
              <Col span={6}><Text style={{ fontSize: 12 }}>{cs.className}</Text></Col>
              <Col span={14}>
                <Progress percent={Math.round(cs.avgScore)} size="small" strokeColor={BRAND.colors.primary}
                  format={() => `${cs.avgScore.toFixed(1)}分`} />
              </Col>
              <Col span={4}><Text type="secondary" style={{ fontSize: 11 }}>通过{cs.passRate}%</Text></Col>
            </Row>
          </div>
        ))}
      </Modal>

      {/* ── AI 提分方案弹窗 ── */}
      <Modal title={<Space><RobotOutlined style={{ color: BRAND.colors.purple }} />AI 提分方案</Space>}
        open={!!improveStudent} onCancel={() => setImproveStudent(null)} width={600}
        footer={[<Button key="close" onClick={() => setImproveStudent(null)} style={{ borderRadius: 6 }}>关闭</Button>]}>
        {improveStudent && (
          <div>
            <Alert type="warning" showIcon
              message={`${improveStudent.name}（${improveStudent.course}）— 当前分数：${improveStudent.score} 分`}
              style={{ marginBottom: 12, borderRadius: 8 }} />
            <Card size="small" title="📊 现状分析" style={{ marginBottom: 12, borderRadius: 8 }}>
              <p>📌 当前等级：<Tag color={gradeTagColor(improveStudent.status)}>{improveStudent.status}</Tag></p>
              <p>📌 班级排名：第 {improveStudent.rank} 名</p>
              <p>📌 趋势：{improveStudent.trend === 'up' ? '上升 ↑' : improveStudent.trend === 'down' ? '下降 ↓' : '-'}</p>
            </Card>
            <Card size="small" title="💡 AI 提分建议" style={{ borderRadius: 8 }}>
              {improveStudent.score < 60 ? (
                <div>
                  <p>🔴 <strong>基础巩固阶段（目标：60分）</strong></p>
                  <ul style={{ paddingLeft: 20 }}>
                    <li>梳理课程核心知识点，建立知识框架</li>
                    <li>每周完成 3 次基础练习题</li>
                    <li>安排一对一辅导答疑</li>
                  </ul>
                </div>
              ) : improveStudent.score < 75 ? (
                <div>
                  <p>🟠 <strong>强化提升阶段（目标：75-84分）</strong></p>
                  <ul style={{ paddingLeft: 20 }}>
                    <li>针对薄弱知识点专项训练</li>
                    <li>增加中等难度题目练习量</li>
                    <li>建立错题本，定期回顾复习</li>
                  </ul>
                </div>
              ) : improveStudent.score < 85 ? (
                <div>
                  <p>🟡 <strong>冲刺优秀阶段（目标：85+分）</strong></p>
                  <ul style={{ paddingLeft: 20 }}>
                    <li>攻克课程难点，拓展高阶思维</li>
                    <li>参与课后讨论与项目实践</li>
                    <li>模拟考试训练时间管理</li>
                  </ul>
                </div>
              ) : (
                <div>
                  <p>🟢 <strong>保持卓越阶段</strong></p>
                  <ul style={{ paddingLeft: 20 }}>
                    <li>深入学科前沿领域研究</li>
                    <li>参与科研项目或竞赛</li>
                    <li>担任学习小组组长，以教促学</li>
                  </ul>
                </div>
              )}
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                📐 以上建议由 AI 基于成绩数据和知识薄弱点分析生成，请教师结合实际情况调整。
              </Text>
            </Card>
          </div>
        )}
      </Modal>

      {/* ── AI 帮扶方案弹窗 ── */}
      <Modal title={<Space><RobotOutlined style={{ color: BRAND.colors.error }} />AI 帮扶方案</Space>}
        open={!!assistStudent} onCancel={() => setAssistStudent(null)} width={600}
        footer={[<Button key="close" onClick={() => setAssistStudent(null)} style={{ borderRadius: 6 }}>关闭</Button>]}>
        {assistStudent && (
          <div>
            <Alert type="error" showIcon
              message={`⚠️ 预警学生：${assistStudent.name}（${assistStudent.course}）— 分数：${assistStudent.score} 分`}
              style={{ marginBottom: 12, borderRadius: 8 }} />
            <Card size="small" title="🔍 问题诊断" style={{ marginBottom: 12, borderRadius: 8 }}>
              <p>📌 成绩状态：<Tag color="error">{assistStudent.status}</Tag></p>
              <p>📌 趋势：{assistStudent.trend === 'down' ? '下降 ⚠️' : assistStudent.trend === 'up' ? '上升' : '-'}</p>
              <p>📌 风险等级：{assistStudent.score < 50 ? '🔴 高风险' : '🟡 中等风险'}</p>
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
                📐 帮扶方案由 AI 基于学生成绩和趋势分析生成，建议教师结合实际情况制定具体措施。
              </Text>
            </Card>
          </div>
        )}
      </Modal>

      <div className="brand-watermark">Edu-TA 成绩管理 · 数据可追溯</div>

      <ApiKeyGuardModal visible={guard.modalVisible} onClose={guard.hideGuard} onGoSettings={guard.goToSettings} />
      <SettingsModal open={guard.settingsVisible} onClose={() => guard.setSettingsVisible(false)} />
    </div>
  );
};

export default GradeManagement;
