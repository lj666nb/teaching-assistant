/**
 * 资料与题库 — Edu-TA 智教星 教学资料 + AI题库 + 作业发布
 *
 * 功能：PDF上传 → AI出题 → 作业发布 全流程闭环
 * 布局：左（上传+资料列表）右（预览 + 出题 + 发布）
 * AI出题受API Key守卫保护
 */

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Card, Typography, Space, Upload, Button, Select, Input, InputNumber,
  Table, Tag, message, Modal, Tabs, Row, Col, Statistic, List, Avatar, Empty,
  Spin, Alert, Tooltip, Divider, Progress, Form, Checkbox, Popconfirm, Drawer,
} from 'antd';
import {
  UploadOutlined, FilePdfOutlined, RobotOutlined, SendOutlined,
  DeleteOutlined, EyeOutlined, ReloadOutlined, ThunderboltOutlined,
  CheckCircleOutlined, BookOutlined, DownloadOutlined, InboxOutlined,
  PlusOutlined, KeyOutlined, HistoryOutlined, EditOutlined,
} from '@ant-design/icons';
import { materialApi, knowledgeApi } from '../api/client';
import { BRAND, CARD_SPECS } from '../utils/brand';
import { useApiKeyGuard, ApiKeyGuardModal, ApiKeyBanner, DisabledAIButton } from '../utils/apiKeyGuard';
import SettingsModal from '../components/SettingsModal';
import '../styles/brand.css';
import { useDataVisibility } from '../context/DataVisibilityContext';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', color || BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle', flexShrink: 0 }} />
);


const MaterialCenter: React.FC = () => {
  const { visible } = useDataVisibility();
  const guard = useApiKeyGuard();
  const canGenerate = guard.hasKey;

  const [materials, setMaterials] = useState<any[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<any>(null);
  const [materialDetail, setMaterialDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [questionCount, setQuestionCount] = useState(5);
  const [questionDifficulty, setQuestionDifficulty] = useState('中等');
  const [questionTypes, setQuestionTypes] = useState<string[]>(['选择题', '填空题', '判断题', '简答题']);
  const [generating, setGenerating] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('generate');

  const [published, setPublished] = useState<any[]>([]);
  const [pubLoading, setPubLoading] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishTitle, setPublishTitle] = useState('');
  const [publishDeadline, setPublishDeadline] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');

  // 全部题目（草稿 + 已发布），用于 AI 已出题计数
  const [allQuestions, setAllQuestions] = useState<any[]>([]);

  // 题目编辑
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [editForm] = Form.useForm();

  // 多选发布
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);

  // 查看已发布题目
  const [viewPubModalOpen, setViewPubModalOpen] = useState(false);
  const [viewPubQuestions, setViewPubQuestions] = useState<any[]>([]);
  const [viewPubTitle, setViewPubTitle] = useState('');

  // 上传
  const [uploadCourse, setUploadCourse] = useState('');
  const [uploadChapter, setUploadChapter] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadModal, setUploadModal] = useState(false);
  const [uploadLog, setUploadLog] = useState<string[]>([]);

  // AI 已出题浮窗
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCourseFilter, setDrawerCourseFilter] = useState<string>('');
  const [drawerTypeFilter, setDrawerTypeFilter] = useState<string>('');

  // 动态课程列表
  const [courseList, setCourseList] = useState<string[]>([]);
  useEffect(() => {
    knowledgeApi.listCourses().then(res => {
      if (res.data.success) setCourseList(res.data.data.courses);
    }).catch(() => {});
  }, []);

  const loadMaterials = async () => {
    setMaterialsLoading(true);
    try { const res = await materialApi.list(); if (res.data.success) setMaterials(res.data.data.items || []); }
    catch { /* ignore */ }
    finally { setMaterialsLoading(false); }
  };

  const loadPublished = async () => {
    setPubLoading(true);
    try { const res = await materialApi.listPublished(); if (res.data.success) setPublished(res.data.data.items || []); }
    catch { /* ignore */ }
    finally { setPubLoading(false); }
  };

  const loadAllQuestions = async () => {
    // 先清理孤立题目，再加载（确保计数准确）
    try { await materialApi.clearOrphanedQuestions(); } catch { /* ignore */ }
    try { const res = await materialApi.listQuestions(); if (res.data.success) setAllQuestions(res.data.data.items || []); }
    catch { /* ignore */ }
  };

  useEffect(() => { loadMaterials(); loadPublished(); loadAllQuestions(); }, []);

  // ── 从 Agent 编排工作台跳转时自动定位资料并加载题目 ──
  const [searchParams] = useSearchParams();
  const autoMaterialId = searchParams.get('material_id') || '';
  const autoSelectRef = useRef(false);

  useEffect(() => {
    if (!autoMaterialId || materials.length === 0 || autoSelectRef.current) return;
    const target = materials.find((m: any) => m.id === autoMaterialId);
    if (target) {
      autoSelectRef.current = true;
      // 自动选中资料
      setSelectedMaterial(target);
      setDetailLoading(true);
      setGeneratedQuestions([]);
      materialApi.detail(target.id).then(res => {
        if (res.data.success) setMaterialDetail(res.data.data);
      }).catch(() => {}).finally(() => setDetailLoading(false));
      // 自动加载该资料的题目
      materialApi.listQuestions(autoMaterialId).then(res => {
        if (res.data.success) {
          const qs = res.data.data.items || [];
          setGeneratedQuestions(qs);
          if (qs.length > 0) setActiveTab('generate');
        }
      }).catch(() => {});
      message.info(`已定位到 Agent 工作流生成的资料：${target.filename}`);
    }
  }, [autoMaterialId, materials]);

  // 隐藏模式下只过滤种子数据，保留用户数据
  const displayMaterials = visible ? materials : materials.filter((m: any) => m._source !== 'seed');
  const displayPublished = visible ? published : published.filter((p: any) => p._source !== 'seed');

  const handleSelectMaterial = async (item: any) => {
    setSelectedMaterial(item); setDetailLoading(true); setGeneratedQuestions([]);
    try { const res = await materialApi.detail(item.id); if (res.data.success) setMaterialDetail(res.data.data); }
    catch { /* ignore */ }
    finally { setDetailLoading(false); }
  };

  // 使用 customRequest 替代 beforeUpload，正确处理多文件上传
  // beforeUpload 返回 false 会阻止 Ant Design 处理后续文件
  const handleUploadRequest = async (options: any) => {
    const { file, onSuccess, onError } = options;
    if (!uploadModal) { setUploadModal(true); setUploadLog([]); }
    const label = uploadCourse ? '' : '（AI 自动识别课程）';
    setUploadLog(prev => [...prev, `📄 ${file.name} ${label}`]);
    try {
      const res = await materialApi.upload(file, uploadCourse, uploadChapter);
      if (res.data.success) {
        const detected = res.data.data;
        setUploadLog(prev => [...prev, `  ✅ 导入成功 → 课程: ${detected.course}${detected.chapter ? ' / ' + detected.chapter : ''}`]);
        message.success(`${file.name} 导入成功`);
        loadMaterials();
        onSuccess(res.data, file);
      } else {
        setUploadLog(prev => [...prev, `  ❌ ${res.data.message}`]);
        onError(new Error(res.data.message));
      }
    } catch (e: any) {
      setUploadLog(prev => [...prev, `  ❌ ${e.response?.data?.detail || e.message}`]);
      onError(e);
    }
  };

  const handleDelete = async (id: string) => {
    Modal.confirm({
      title: '确认删除', content: '删除后资料无法恢复，关联的 AI 题目将同步删除。',
      onOk: async () => {
        try { const res = await materialApi.delete(id); if (res.data.success) { message.success('已删除，关联题目已同步清理'); if (selectedMaterial?.id === id) { setSelectedMaterial(null); setMaterialDetail(null); setGeneratedQuestions([]); } loadMaterials(); loadAllQuestions(); } }
        catch { message.error('删除失败'); }
      },
    });
  };

  const handleGenerate = async () => {
    if (!canGenerate) { guard.showGuard(); return; }
    if (!selectedMaterial) { message.warning('请先选择一个教学资料'); return; }
    setGenerating(true); setGeneratedQuestions([]);
    try {
      const res = await materialApi.generateQuestions(selectedMaterial.id, questionCount, questionDifficulty, questionTypes);
      if (res.data.success) { setGeneratedQuestions(res.data.data.questions || []); loadAllQuestions(); message.success(res.data.message); }
      else message.error(res.data.message || '出题失败');
    } catch (e: any) { message.error(e.response?.data?.detail || '请求失败'); }
    finally { setGenerating(false); }
  };

  const handleEditQuestion = (q: any) => {
    setEditingQuestion(q);
    editForm.setFieldsValue({
      question: q.question, type: q.type, difficulty: q.difficulty,
      answer: q.answer, explanation: q.explanation || '', knowledge_point: q.knowledge_point || '',
      options: (q.options || []).join('\n'),
    });
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingQuestion) return;
    const vals = await editForm.validateFields().catch(() => null);
    if (!vals) return;
    try {
      const payload = {
        id: editingQuestion.id,
        question: vals.question,
        type: vals.type,
        difficulty: vals.difficulty,
        answer: vals.answer,
        explanation: vals.explanation || '',
        knowledge_point: vals.knowledge_point || '',
        options: vals.options ? vals.options.split('\n').filter((l: string) => l.trim()) : [],
      };
      const res = await materialApi.updateQuestion(payload);
      if (res.data.success) {
        message.success('题目已更新');
        setEditModalOpen(false);
        // 更新本地列表
        setGeneratedQuestions(prev => prev.map(q => q.id === editingQuestion.id ? { ...q, ...payload } : q));
      } else message.error(res.data.message || '更新失败');
    } catch (e: any) { message.error(e.response?.data?.detail || '更新失败'); }
  };

  const handleUnpublish = async (publishId: string) => {
    Modal.confirm({
      title: '撤销发布', content: '确认撤销此发布？所有题目将恢复为草稿状态。',
      onOk: async () => {
        try {
          const res = await materialApi.unpublish(publishId);
          if (res.data.success) { message.success(res.data.message); loadPublished(); loadAllQuestions(); }
          else message.error(res.data.message || '撤销失败');
        } catch (e: any) { message.error(e.response?.data?.detail || '撤销失败'); }
      },
    });
  };

  const handleExportWord = (questions: any[], title: string) => {
    if (questions.length === 0) { message.warning('没有题目可导出'); return; }
    const ids = questions.map(q => q.id);
    materialApi.exportWord(ids, title).then(res => {
      if (res.data.success) {
        const b64 = res.data.data.base64;
        const byteChars = atob(b64);
        const byteNums = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = res.data.data.filename; a.click();
        URL.revokeObjectURL(url);
        message.success('已导出 Word 文档');
      } else message.error(res.data.message || '导出失败');
    }).catch(() => message.error('导出失败'));
  };

  const handleViewPublished = async (publishId: string) => {
    try {
      const res = await materialApi.getPublishedQuestions(publishId);
      if (res.data.success) {
        setViewPubQuestions(res.data.data.questions || []);
        setViewPubTitle(res.data.data.title || '');
        setViewPubModalOpen(true);
      }
    } catch { message.error('加载失败'); }
  };

  const handlePublish = async () => {
    const ids = selectedQuestionIds.length > 0 ? selectedQuestionIds : generatedQuestions.map(q => q.id);
    if (ids.length === 0) { message.warning('请先选择要发布的题目'); return; }
    if (selectedQuestionIds.length === 0 && generatedQuestions.length > 1) {
      message.info('提示：可勾选题目进行多选发布，未勾选则默认发布全部');
    }
    const course = selectedMaterial?.course || '';
    setPublishing(true);
    try {
      const res = await materialApi.publish(ids, course, publishTitle || `${selectedMaterial?.filename}练习题`, publishDeadline);
      if (res.data.success) {
        message.success(`已发布 ${res.data.data.question_count} 道题`);
        setPublishModalOpen(false);
        setSelectedQuestionIds([]);
        // 从本地列表移除已发布的题目
        setGeneratedQuestions(prev => prev.filter(q => !ids.includes(q.id)));
        loadPublished();
        loadAllQuestions();
      } else message.error(res.data.message || '发布失败');
    } catch (e: any) { message.error(e.response?.data?.detail || '发布失败'); }
    finally { setPublishing(false); }
  };

  // AI 已出题 = 全部AI生成的题目（发布/撤销不改变数量，仅生成时增加、资料删除时减少）
  const totalQuestions = allQuestions.length;
  const courseCount = new Set(displayMaterials.map(m => m.course)).size;

  return (
    <div className="page-enter" style={{ position: 'relative' }}>
      {!canGenerate && <ApiKeyBanner onGoSettings={guard.goToSettings} />}

      {/* 页面头部 */}
      <div style={{ marginBottom: 16 }}>
        <Space align="center" size={10}>
          <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }}
            style={{ width: 32, height: 32, display: 'inline-flex', animation: 'logoPulse 0.8s ease-out' }} />
          <div>
            <Title level={4} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: BRAND.colors.textPrimary }}>
              智教星 · 资料与题库
            </Title>
            <Text type="secondary" style={{ fontSize: 11 }}>教学资料存储 · AI 习题题库 · 作业发布</Text>
          </div>
        </Space>
      </div>

      {/* 顶部统计 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { value: displayMaterials.length, label: '教学资料', icon: <FilePdfOutlined />, color: BRAND.colors.error, suffix: '份', onClick: () => setActiveTab('preview') },
          { value: totalQuestions, label: 'AI 已出题', icon: <RobotOutlined />, color: BRAND.colors.purple, suffix: '道', onClick: () => setDrawerOpen(true),
            extra: totalQuestions > 0 ? (
              <Popconfirm title="清空所有AI生成的草稿题目？已发布的题目不受影响。" onConfirm={async () => {
                try { await materialApi.clearOrphanedQuestions(true); loadAllQuestions(); message.success('已清空'); } catch { message.error('清空失败'); }
              }} okText="确认清空" cancelText="取消">
                <Button type="link" size="small" danger style={{ fontSize: 10, padding: 0, position: 'absolute', bottom: 4, right: 8 }}>清空</Button>
              </Popconfirm>
            ) : null,
          },
          { value: published.length, label: '已发布作业', icon: <SendOutlined />, color: BRAND.colors.primary, suffix: '次', onClick: () => setActiveTab('published') },
          { value: courseCount, label: '覆盖课程', icon: <BookOutlined />, color: BRAND.colors.green, suffix: '门', onClick: () => {} },
        ].map((item, idx) => (
          <Col xs={12} sm={6} key={idx}>
            <Card hoverable className="brand-card" bodyStyle={{ padding: '14px 18px', position: 'relative' }} onClick={item.onClick}>
              <span style={{ position: 'absolute', top: 6, right: 8, color: item.color, opacity: 0.35 }}><BrandBadge size={12} color={item.color} /></span>
              <Statistic title={<Text style={{ fontSize: 12, color: BRAND.colors.textSecondary }}>{item.label}</Text>}
                value={item.value} suffix={<Text style={{ fontSize: 12, color: BRAND.colors.textTertiary }}>{item.suffix}</Text>}
                prefix={<span style={{ color: item.color, fontSize: 18, marginRight: 4 }}>{item.icon}</span>}
                valueStyle={{ fontSize: 24, fontWeight: 700, color: BRAND.colors.textPrimary }} />
              {item.extra}
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        {/* ── 左侧：资料管理 ── */}
        <Col xs={24} lg={8}>
          {/* 上传 */}
          <Card className="brand-card" style={{ marginBottom: 16 }}
            title={<Space><BrandBadge color={BRAND.colors.green} /><UploadOutlined style={{ color: BRAND.colors.green }} /><Text strong>上传教学资料</Text></Space>}
            bodyStyle={{ padding: '14px 18px' }}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Select
                mode="tags" maxCount={1}
                style={{ width: '100%', borderRadius: 8 }}
                placeholder="输入或选择课程（可选，不选则 AI 自动识别）"
                options={courseList.map(c => ({ value: c, label: c }))}
                value={uploadCourse ? [uploadCourse] : undefined}
                onChange={v => setUploadCourse(Array.isArray(v) ? (v[0] || '') : (v || ''))}
                showSearch
              />
              <Input placeholder="章节名称（可选，不填则 AI 自动识别）" style={{ borderRadius: 8 }} value={uploadChapter} onChange={e => setUploadChapter(e.target.value)} />
              <Dragger
                accept=".pdf,.docx,.doc"
                customRequest={handleUploadRequest}
                showUploadList={false}
                multiple
                style={{ borderRadius: 8, padding: '8px 0' }}
                onChange={(info) => {
                  const { file } = info;
                  if (file.status === 'uploading') { setUploading(true); }
                  else if (file.status === 'done' || file.status === 'error') {
                    // 检查是否还有文件在处理中
                    const uploadingCount = info.fileList.filter((f: any) => f.status === 'uploading').length;
                    if (uploadingCount === 0) setUploading(false);
                  }
                }}
              >
                {uploading ? <Spin tip="正在导入并 AI 分析..." /> : (
                  <div>
                    <InboxOutlined style={{ fontSize: 28, color: BRAND.colors.primary }} />
                    <Paragraph style={{ marginBottom: 0, fontSize: 12 }}>点击或拖拽 PDF/Word，支持多文件</Paragraph>
                    <Text type="secondary" style={{ fontSize: 10 }}>AI 自动识别课程和章节</Text>
                  </div>
                )}
              </Dragger>
            </Space>
          </Card>

          {/* 资料列表 */}
          <Card className="brand-card"
            title={<Space><BrandBadge /><FilePdfOutlined style={{ color: BRAND.colors.error }} /><Text strong>教学资料列表</Text></Space>}
            extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadMaterials} style={{ borderRadius: 6 }}>刷新</Button>}>
            {materialsLoading ? <Spin><div style={{ padding: 24 }} /></Spin> : displayMaterials.length === 0 ? (
              <Empty description="暂无资料，请上传 PDF" />
            ) : (
              <List size="small" dataSource={displayMaterials} renderItem={(item: any) => (
                <List.Item style={{ cursor: 'pointer', background: selectedMaterial?.id === item.id ? `${BRAND.colors.primary}10` : 'transparent', borderRadius: 6, padding: '6px 10px' }}
                  onClick={() => handleSelectMaterial(item)}
                  actions={[<Tooltip title="删除" key="del"><DeleteOutlined style={{ color: BRAND.colors.error }} onClick={e => { e.stopPropagation(); handleDelete(item.id); }} /></Tooltip>]}>
                  <List.Item.Meta avatar={<Avatar icon={<FilePdfOutlined />} style={{ backgroundColor: BRAND.colors.error }} />}
                    title={<Text strong style={{ fontSize: 12 }}>{item.filename}</Text>}
                    description={<Space size={4} style={{ fontSize: 11 }}><Tag style={{ borderRadius: 6, fontSize: 10 }}>{item.course}</Tag><Text type="secondary">{item.size_display}</Text><Text type="secondary">{item.pages || '?'}页</Text></Space>} />
                </List.Item>
              )} />
            )}
          </Card>
        </Col>

        {/* ── 右侧 ── */}
        <Col xs={24} lg={16}>
          {detailLoading ? (
            <Card className="brand-card" bodyStyle={{ padding: 60, textAlign: 'center' }}>
              <div style={{ animation: 'logoGlow 1.5s ease-in-out infinite' }}>
                <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 40, height: 40, display: 'inline-block' }} /></div>
              <Spin style={{ marginTop: 8 }} /><Paragraph style={{ marginTop: 4, color: BRAND.colors.textSecondary, fontSize: 12 }}>加载资料中...</Paragraph>
            </Card>
          ) : selectedMaterial && materialDetail ? (
            <Tabs activeKey={activeTab} onChange={setActiveTab}
              style={{ background: '#fff', borderRadius: 12, padding: '4px 12px', boxShadow: CARD_SPECS.shadow }}
              items={[
                // ═══ 资料预览 ═══
                { key: 'preview', label: <span><EyeOutlined style={{ color: BRAND.colors.primary }} />资料预览</span>,
                  children: (
                    <Card className="brand-card">
                      <Space align="start" style={{ marginBottom: 8 }}>
                        <BrandBadge size={18} /><Title level={5} style={{ margin: 0 }}>{materialDetail.filename}</Title>
                        <Tag color="blue" style={{ borderRadius: 6 }}>{materialDetail.course}</Tag>
                        {materialDetail.chapter && <Tag style={{ borderRadius: 6 }}>{materialDetail.chapter}</Tag>}
                        <Text type="secondary" style={{ fontSize: 11 }}>{materialDetail.size_display} · {materialDetail.pages} 页</Text>
                      </Space>
                      <Divider style={{ margin: '4px 0' }} />
                      <Paragraph style={{ background: '#fafafa', padding: 14, borderRadius: 8, maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.8 }}>
                        {materialDetail.text_preview || '（无可预览文本）'}
                      </Paragraph>
                      {materialDetail.text_content?.length > 5000 && (
                        <Button type="link" icon={<EyeOutlined />} onClick={() => { setPreviewContent(materialDetail.text_content); setPreviewModalOpen(true); }}>查看完整内容</Button>
                      )}
                      <Divider style={{ margin: '4px 0' }} />
                      <Space>
                        <Button icon={<DownloadOutlined />} style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>下载原文件</Button>
                        <Button icon={<RobotOutlined />} style={{ borderRadius: 6, borderColor: BRAND.colors.purple, color: BRAND.colors.purple }} onClick={() => setActiveTab('generate')}>去出题</Button>
                      </Space>
                    </Card>
                  ) },

                // ═══ AI 出题 ═══
                { key: 'generate', label: <span><RobotOutlined style={{ color: BRAND.colors.purple }} />AI 智能出题</span>,
                  children: (
                    <div>
                      <Card className="brand-card" size="small" style={{ marginBottom: 12 }} bodyStyle={{ padding: '12px 16px' }}>
                        <Row gutter={[12, 8]} align="middle">
                          <Col span={6}><Text style={{ fontSize: 11, color: BRAND.colors.textSecondary }}>数量</Text><InputNumber min={1} max={50} value={questionCount} onChange={v => setQuestionCount(v || 5)} style={{ width: '100%', borderRadius: 6 }} /></Col>
                          <Col span={6}><Text style={{ fontSize: 11, color: BRAND.colors.textSecondary }}>难度</Text>
                            <Select value={questionDifficulty} onChange={setQuestionDifficulty} style={{ width: '100%' }} options={[{ value: '基础', label: '基础' }, { value: '中等', label: '中等' }, { value: '提高', label: '提高' }, { value: '综合', label: '综合' }, { value: '前沿', label: '前沿' }]} />
                          </Col>
                          <Col span={12}><Text style={{ fontSize: 11, color: BRAND.colors.textSecondary }}>题型</Text>
                            <Select mode="multiple" value={questionTypes} onChange={setQuestionTypes} style={{ width: '100%' }}
                              options={[{ value: '选择题', label: '选择题' }, { value: '判断题', label: '判断题' }, { value: '填空题', label: '填空题' }, { value: '简答题', label: '简答题' }, { value: '论述题', label: '论述题' }, { value: '计算题', label: '计算题' }]} />
                          </Col>
                          <Col span={24}>
                            <Space>
                              {canGenerate ? (
                                <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleGenerate} loading={generating}
                                  style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient }}>
                                  {generating ? 'AI 出题中...' : '开始生成题目'}
                                </Button>
                              ) : (
                                <DisabledAIButton label="AI 出题已锁定" icon={<KeyOutlined />} />
                              )}
                              <Text type="secondary" style={{ fontSize: 11 }}>基于「{materialDetail.filename}」内容生成</Text>
                            </Space>
                          </Col>
                        </Row>
                      </Card>

                      {generating && (
                        <Card className="brand-card" bodyStyle={{ padding: 40, textAlign: 'center' }}>
                          <div style={{ animation: 'logoGlow 1.5s ease-in-out infinite' }}>
                            <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 48, height: 48, display: 'inline-block' }} /></div>
                          <Spin style={{ marginTop: 12 }} /><Paragraph style={{ marginTop: 8, color: BRAND.colors.textSecondary, fontSize: 12 }}>正在理解教材内容 → 分析知识点 → 生成题目...</Paragraph>
                        </Card>
                      )}

                      {generatedQuestions.length > 0 && !generating && (
                        <Card className="brand-card"
                          title={<Space><CheckCircleOutlined style={{ color: BRAND.colors.green }} /><Text strong>已生成 {generatedQuestions.length} 道题目</Text>
                            {selectedQuestionIds.length > 0 && <Tag color="blue" style={{ borderRadius: 6 }}>已选 {selectedQuestionIds.length} 道</Tag>}
                          </Space>}
                          bodyStyle={{ padding: '12px 16px' }}
                          extra={
                            <Space>
                              <Button icon={<DownloadOutlined />} size="small" style={{ borderRadius: 6 }}
                                onClick={() => handleExportWord(generatedQuestions, selectedMaterial?.filename + '练习题' || '习题集')}>导出 Word</Button>
                              <Button type="primary" icon={<SendOutlined />} onClick={() => { setPublishTitle(`${selectedMaterial?.filename || ''}练习题`); setPublishDeadline(''); setPublishModalOpen(true); }}
                                style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>发布作业</Button>
                              <Button icon={<ReloadOutlined />} onClick={handleGenerate} loading={generating} style={{ borderRadius: 6 }}>重新生成</Button>
                            </Space>
                          }>
                          <Space style={{ marginBottom: 8 }}><Text style={{ fontSize: 11, color: BRAND.colors.textSecondary }}>难度分布：</Text>
                            {['基础', '中等', '提高', '综合', '前沿'].map(d => { const c = generatedQuestions.filter(q => q.difficulty === d).length; return c > 0 ? <Tag key={d} style={{ borderRadius: 6, fontSize: 10 }}>{d}: {c}题</Tag> : null; })}</Space>
                          {generatedQuestions.map((q, idx) => (
                            <Card key={q.id || idx} size="small" style={{ marginBottom: 6, borderRadius: 8 }}
                              title={<Space>
                                <Checkbox checked={selectedQuestionIds.includes(q.id)} onChange={e => {
                                  if (e.target.checked) setSelectedQuestionIds([...selectedQuestionIds, q.id]);
                                  else setSelectedQuestionIds(selectedQuestionIds.filter(id => id !== q.id));
                                }} />
                                <Text strong style={{ fontSize: 12 }}>#{idx + 1}</Text>
                                <Tag color={q.type === '选择题' ? 'blue' : q.type === '判断题' ? 'cyan' : q.type === '填空题' ? 'green' : q.type === '论述题' ? 'purple' : 'orange'} style={{ borderRadius: 6, fontSize: 10 }}>{q.type}</Tag>
                                <Tag color={q.difficulty === '基础' ? 'green' : q.difficulty === '中等' ? 'blue' : q.difficulty === '提高' ? 'orange' : q.difficulty === '综合' ? 'red' : 'purple'} style={{ borderRadius: 6, fontSize: 10 }}>{q.difficulty}</Tag>
                                {q.knowledge_point && <Tag style={{ borderRadius: 6, fontSize: 10 }}>{q.knowledge_point}</Tag>}
                              </Space>}
                              extra={<Button type="link" size="small" icon={<EditOutlined />} style={{ fontSize: 11 }} onClick={() => handleEditQuestion(q)}>编辑</Button>}
                            >
                              <Paragraph style={{ marginBottom: 4, fontSize: 12 }}>{q.question}</Paragraph>
                              {q.options?.length > 0 && <div style={{ marginLeft: 12, marginBottom: 4 }}>{q.options.map((opt: string, oi: number) => <Paragraph key={oi} style={{ margin: 0, fontSize: 11 }}>{opt}</Paragraph>)}</div>}
                              <Alert type="info" showIcon message={<Space><Text strong style={{ fontSize: 11 }}>答案：</Text><Text style={{ fontSize: 11 }}>{q.answer}</Text>{q.estimated_time && <Text type="secondary" style={{ fontSize: 10 }}>预计 {q.estimated_time} 分钟</Text>}</Space>} style={{ marginBottom: 2, borderRadius: 6 }} />
                              {q.explanation && <Paragraph type="secondary" style={{ fontSize: 11, margin: '2px 0 0' }}>📖 {q.explanation}</Paragraph>}
                              {q.source && <Tag style={{ fontSize: 9, marginTop: 2, borderRadius: 6 }} color="geekblue">来源：{q.source}</Tag>}
                            </Card>
                          ))}
                        </Card>
                      )}
                      {generatedQuestions.length === 0 && !generating && (
                        <Card className="brand-card" bodyStyle={{ padding: 60, textAlign: 'center' }}>
                          <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 48, height: 48, display: 'inline-block', opacity: 0.3 }} />
                          <Paragraph style={{ marginTop: 8, color: BRAND.colors.textTertiary, fontSize: 13 }}>选择资料和参数后开始 AI 出题</Paragraph>
                        </Card>
                      )}
                    </div>
                  ) },

                // ═══ 发布记录 ═══
                { key: 'published', label: <span><SendOutlined style={{ color: BRAND.colors.primary }} />发布记录</span>,
                  children: (
                    <Card extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadPublished} style={{ borderRadius: 6 }}>刷新</Button>}>
                      {pubLoading ? <Spin><div style={{ padding: 24 }} /></Spin> : displayPublished.length === 0 ? <Empty description="暂无发布记录" /> : (
                        <List dataSource={published} renderItem={(item: any) => (
                          <List.Item actions={[
                            <Button key="view" type="link" size="small" style={{ fontSize: 11 }}
                              onClick={() => handleViewPublished(item.id)}>查看题目</Button>,
                            <Button key="export" type="link" size="small" icon={<DownloadOutlined />} style={{ fontSize: 11 }}
                              onClick={async () => {
                                try {
                                  const res = await materialApi.getPublishedQuestions(item.id);
                                  if (res.data.success) handleExportWord(res.data.data.questions || [], item.title);
                                } catch { message.error('加载失败'); }
                              }}>导出 Word</Button>,
                            <Button key="unpub" type="link" size="small" danger style={{ fontSize: 11 }}
                              onClick={() => handleUnpublish(item.id)}>撤销发布</Button>
                          ]}>
                            <List.Item.Meta avatar={<Avatar icon={<SendOutlined />} style={{ backgroundColor: BRAND.colors.primary }} />}
                              title={<Text strong>{item.title}</Text>}
                              description={<Space><Tag color="blue" style={{ borderRadius: 6 }}>{item.course}</Tag><Text type="secondary" style={{ fontSize: 11 }}>{item.question_count} 道题</Text><Text type="secondary" style={{ fontSize: 11 }}>{item.created_at}</Text></Space>} />
                          </List.Item>
                        )} />
                      )}
                    </Card>
                  ) },
              ]} />
          ) : (
            <Card className="brand-card" bodyStyle={{ padding: 80, textAlign: 'center' }}>
              <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 64, height: 64, display: 'inline-block', opacity: 0.2 }} />
              <Paragraph style={{ marginTop: 12, color: BRAND.colors.textTertiary, fontSize: 14 }}>从左侧选择一个教学资料开始操作</Paragraph>
            </Card>
          )}
        </Col>
      </Row>

      {/* 上传进度弹窗 */}
      <Modal title="上传进度" open={uploadModal} onCancel={() => { if (!uploading) setUploadModal(false); }} footer={null} closable={!uploading} width={420}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {uploading && <Progress percent={50} status="active" />}
          <div style={{ maxHeight: 160, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 6 }}>
            {uploadLog.map((log, i) => <Text key={i} style={{ display: 'block', fontSize: 11, fontFamily: 'monospace', color: log.includes('✅') ? BRAND.colors.green : log.includes('❌') ? BRAND.colors.error : '#333' }}>{log}</Text>)}
          </div>
          {!uploading && <Button type="primary" onClick={() => setUploadModal(false)} style={{ borderRadius: 6, background: BRAND.colors.primaryGradient, border: 'none' }}>完成</Button>}
        </Space>
      </Modal>

      {/* 预览弹窗 */}
      <Modal title="完整内容" open={previewModalOpen} onCancel={() => setPreviewModalOpen(false)} footer={null} width={700}>
        <Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 500, overflow: 'auto', fontSize: 13, lineHeight: 1.8 }}>{previewContent}</Paragraph>
      </Modal>

      {/* 发布弹窗 */}
      <Modal title={<Space><SendOutlined />发布作业</Space>} open={publishModalOpen} onCancel={() => setPublishModalOpen(false)} onOk={handlePublish} confirmLoading={publishing} okText="确认发布" cancelText="取消">
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert type="info" showIcon message={`即将发布 ${generatedQuestions.length} 道题目`} description="发布后学生端收到作业通知。" style={{ borderRadius: 8 }} />
          <div><Text style={{ display: 'block', marginBottom: 4 }}>作业标题</Text><Input value={publishTitle} onChange={e => setPublishTitle(e.target.value)} placeholder="第三章 课后练习" style={{ borderRadius: 6 }} /></div>
          <div><Text style={{ display: 'block', marginBottom: 4 }}>截止日期（可选）</Text><Input value={publishDeadline} onChange={e => setPublishDeadline(e.target.value)} placeholder="2026-07-20" style={{ borderRadius: 6 }} /></div>
        </Space>
      </Modal>

      {/* 编辑题目弹窗 */}
      <Modal title="编辑题目" open={editModalOpen} onCancel={() => setEditModalOpen(false)} onOk={handleSaveEdit} okText="保存" width={600} destroyOnClose>
        <Form form={editForm} layout="vertical">
          <Form.Item name="question" label="题目内容" rules={[{ required: true }]}>
            <Input.TextArea rows={3} style={{ borderRadius: 6 }} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="type" label="题型" rules={[{ required: true }]}>
                <Select options={[{ value: '选择题', label: '选择题' }, { value: '填空题', label: '填空题' }, { value: '简答题', label: '简答题' }, { value: '论述题', label: '论述题' }, { value: '计算题', label: '计算题' }, { value: '案例分析', label: '案例分析' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="difficulty" label="难度" rules={[{ required: true }]}>
                <Select options={[{ value: '基础', label: '基础' }, { value: '中等', label: '中等' }, { value: '提高', label: '提高' }, { value: '综合', label: '综合' }, { value: '前沿', label: '前沿' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="knowledge_point" label="知识点">
                <Input placeholder="如：反向传播算法" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="answer" label="答案" rules={[{ required: true }]}>
            <Input.TextArea rows={2} style={{ borderRadius: 6 }} />
          </Form.Item>
          <Form.Item name="options" label="选项（选择题每行一个）">
            <Input.TextArea rows={3} placeholder="A. 选项一&#10;B. 选项二&#10;C. 选项三&#10;D. 选项四" style={{ borderRadius: 6 }} />
          </Form.Item>
          <Form.Item name="explanation" label="解析">
            <Input.TextArea rows={2} style={{ borderRadius: 6 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 查看已发布题目弹窗 */}
      <Modal title={<Space><EyeOutlined />{viewPubTitle || '已发布题目'}</Space>} open={viewPubModalOpen}
        onCancel={() => setViewPubModalOpen(false)} footer={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => handleExportWord(viewPubQuestions, viewPubTitle || '习题集')} style={{ borderRadius: 6 }}>导出 Word</Button>
            <Button onClick={() => setViewPubModalOpen(false)} style={{ borderRadius: 6 }}>关闭</Button>
          </Space>
        } width={700}>
        {viewPubQuestions.length === 0 ? <Empty description="暂无题目" /> : (
          viewPubQuestions.map((q, idx) => (
            <Card key={q.id || idx} size="small" style={{ marginBottom: 6, borderRadius: 8 }}
              title={<Space><Text strong style={{ fontSize: 12 }}>#{idx + 1}</Text>
                <Tag color={q.type === '选择题' ? 'blue' : q.type === '判断题' ? 'cyan' : q.type === '填空题' ? 'green' : 'orange'} style={{ borderRadius: 6, fontSize: 10 }}>{q.type}</Tag>
                <Tag color={q.difficulty === '基础' ? 'green' : q.difficulty === '中等' ? 'blue' : q.difficulty === '提高' ? 'orange' : q.difficulty === '综合' ? 'red' : 'purple'} style={{ borderRadius: 6, fontSize: 10 }}>{q.difficulty}</Tag>
              </Space>}>
              <Paragraph style={{ marginBottom: 4, fontSize: 12 }}>{q.question}</Paragraph>
              {q.options?.length > 0 && <div style={{ marginLeft: 12, marginBottom: 4 }}>{q.options.map((opt: string, oi: number) => <Paragraph key={oi} style={{ margin: 0, fontSize: 11 }}>{opt}</Paragraph>)}</div>}
              <Alert type="info" showIcon message={<Space><Text strong style={{ fontSize: 11 }}>答案：</Text><Text style={{ fontSize: 11 }}>{q.answer}</Text></Space>} style={{ borderRadius: 6 }} />
              {q.explanation && <Paragraph type="secondary" style={{ fontSize: 11, margin: '2px 0 0' }}>📖 {q.explanation}</Paragraph>}
            </Card>
          ))
        )}
      </Modal>

      {/* ── AI 已出题浮窗 ── */}
      <Drawer
        title={
          <Space>
            <RobotOutlined style={{ color: BRAND.colors.purple }} />
            <span>AI 已出题</span>
            <Tag color="purple" style={{ borderRadius: 6 }}>{allQuestions.length} 道</Tag>
          </Space>
        }
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerCourseFilter(''); setDrawerTypeFilter(''); }}
        width={900}
        styles={{ body: { padding: '16px 24px' } }}
        extra={
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={loadAllQuestions} style={{ borderRadius: 6 }}>刷新</Button>
            {allQuestions.length > 0 && (
              <Button size="small" icon={<DownloadOutlined />} style={{ borderRadius: 6 }}
                onClick={() => {
                  const ids = allQuestions.map(q => q.id);
                  handleExportWord(allQuestions, '全部AI出题');
                }}>全部导出</Button>
            )}
          </Space>
        }
      >
        {allQuestions.length === 0 ? (
          <Empty description="暂无AI出题记录，请先在右侧选择资料后点击「开始生成题目」" />
        ) : (
          <>
            {/* 筛选栏 */}
            <Row gutter={8} style={{ marginBottom: 12 }}>
              <Col span={12}>
                <Select
                  placeholder="按课程筛选"
                  allowClear
                  style={{ width: '100%' }}
                  value={drawerCourseFilter || undefined}
                  onChange={v => setDrawerCourseFilter(v || '')}
                  options={(() => {
                    const courses = [...new Set(allQuestions.map(q => q.course || q.material_name || '未知'))].sort();
                    return courses.map(c => ({ value: c, label: `${c} (${allQuestions.filter(q => (q.course || q.material_name || '未知') === c).length})` }));
                  })()}
                />
              </Col>
              <Col span={12}>
                <Select
                  placeholder="按题型筛选"
                  allowClear
                  style={{ width: '100%' }}
                  value={drawerTypeFilter || undefined}
                  onChange={v => setDrawerTypeFilter(v || '')}
                  options={(() => {
                    const types = [...new Set(allQuestions.map(q => q.type || '未知'))].sort();
                    return types.map(t => ({ value: t, label: `${t} (${allQuestions.filter(q => q.type === t).length})` }));
                  })()}
                />
              </Col>
            </Row>

            {/* 题目列表 */}
            {(() => {
              let filtered = allQuestions;
              if (drawerCourseFilter) {
                filtered = filtered.filter(q => (q.course || q.material_name || '未知') === drawerCourseFilter);
              }
              if (drawerTypeFilter) {
                filtered = filtered.filter(q => q.type === drawerTypeFilter);
              }

              // 按课程分组
              const groups: Record<string, any[]> = {};
              filtered.forEach(q => {
                const grp = q.course || q.material_name || '未知';
                if (!groups[grp]) groups[grp] = [];
                groups[grp].push(q);
              });

              return Object.entries(groups).map(([course, questions]) => (
                <div key={course} style={{ marginBottom: 16 }}>
                  <div style={{ marginBottom: 8, padding: '4px 0', borderBottom: `2px solid ${BRAND.colors.primary}20` }}>
                    <Space>
                      <BookOutlined style={{ color: BRAND.colors.primary }} />
                      <Text strong style={{ fontSize: 15 }}>{course}</Text>
                      <Tag style={{ borderRadius: 6, fontSize: 12 }}>{questions.length} 题</Tag>
                    </Space>
                  </div>
                  {questions.map((q, idx) => (
                    <Card
                      key={q.id || idx}
                      size="small"
                      style={{ marginBottom: 6, borderRadius: 8 }}
                      title={
                        <Space size={4}>
                          <Text strong style={{ fontSize: 13 }}>#{idx + 1}</Text>
                          <Tag color={q.type === '选择题' ? 'blue' : q.type === '判断题' ? 'cyan' : q.type === '填空题' ? 'green' : q.type === '论述题' ? 'purple' : q.type === '计算题' ? 'red' : 'orange'} style={{ borderRadius: 6, fontSize: 12 }}>{q.type || '简答题'}</Tag>
                          <Tag color={q.difficulty === '基础' ? 'green' : q.difficulty === '中等' ? 'blue' : q.difficulty === '提高' ? 'orange' : q.difficulty === '综合' ? 'red' : 'purple'} style={{ borderRadius: 6, fontSize: 12 }}>{q.difficulty || '中等'}</Tag>
                          {q.knowledge_point && <Tag style={{ borderRadius: 6, fontSize: 12 }}>{q.knowledge_point}</Tag>}
                        </Space>
                      }
                      extra={
                        <Button type="link" size="small" icon={<EditOutlined />} style={{ fontSize: 13 }}
                          onClick={() => handleEditQuestion(q)}>编辑</Button>
                      }
                    >
                      <Paragraph style={{ marginBottom: 6, fontSize: 14 }}>{q.question}</Paragraph>
                      {q.options?.length > 0 && (
                        <div style={{ marginLeft: 8, marginBottom: 6 }}>
                          {(Array.isArray(q.options) ? q.options : []).map((opt: string, oi: number) => (
                            <Text key={oi} style={{ display: 'block', fontSize: 13, color: '#555', lineHeight: 1.8 }}>{opt}</Text>
                          ))}
                        </div>
                      )}
                      <Alert
                        type="info"
                        showIcon
                        style={{ borderRadius: 6 }}
                        message={
                          <Space size={8}>
                            <Text strong style={{ fontSize: 13 }}>答案：</Text>
                            <Text style={{ fontSize: 13 }}>{q.answer}</Text>
                          </Space>
                        }
                      />
                      {q.explanation && (
                        <Paragraph type="secondary" style={{ fontSize: 13, margin: '4px 0 0' }}>
                          📖 {q.explanation}
                        </Paragraph>
                      )}
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                        来源：{q.material_name || q.course || '未知'} · 状态：{q.status === 'published' ? '已发布' : '草稿'}
                      </Text>
                    </Card>
                  ))}
                </div>
              ));
            })()}
          </>
        )}
      </Drawer>

      <div className="brand-watermark">Edu-TA 教学资料 · 题库可追溯</div>

      <ApiKeyGuardModal visible={guard.modalVisible} onClose={guard.hideGuard} onGoSettings={guard.goToSettings} />
      <SettingsModal open={guard.settingsVisible} onClose={() => guard.setSettingsVisible(false)} />
    </div>
  );
};

export default MaterialCenter;
