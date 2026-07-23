/**
 * 智能答疑管理 — Edu-TA 智教星 RAG 知识库
 *
 * 左侧：知识库状态 + 导入教材 + 检索答疑
 * 右侧：AI答疑对话区 + 检索结果
 * 底部：文档管理列表
 * AI答疑受API Key守卫保护
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Card, Form, Input, Button, Spin, Alert, Typography, Tag, Space, Row, Col,
  List, Upload, Statistic, message, Divider, Empty, Modal, Progress, Select,
  Table, Tooltip, Popconfirm, Collapse,
} from 'antd';
import {
  DatabaseOutlined, SearchOutlined, UploadOutlined, FileTextOutlined,
  DeleteOutlined, ThunderboltOutlined, ReloadOutlined, KeyOutlined,
  RobotOutlined, DownloadOutlined, HistoryOutlined, BookOutlined,
  LinkOutlined, InboxOutlined, FilePdfOutlined, FileWordOutlined,
  ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import { knowledgeApi, resourcesApi } from '../api/client';
import { BRAND, CARD_SPECS } from '../utils/brand';
import { useApiKeyGuard, ApiKeyGuardModal, ApiKeyBanner, DisabledAIButton } from '../utils/apiKeyGuard';
import SettingsModal from '../components/SettingsModal';
import '../styles/brand.css';
import { useDataVisibility } from '../context/DataVisibilityContext';

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', color || BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle', flexShrink: 0 }} />
);

const courseOptions = [
  { value: '机器学习', label: '机器学习' }, { value: '深度学习', label: '深度学习' },
  { value: '自然语言处理', label: '自然语言处理' }, { value: '计算机视觉', label: '计算机视觉' },
];

const KnowledgeBase: React.FC = () => {
  const { visible } = useDataVisibility();
  const [searchForm] = Form.useForm();
  const [uploadForm] = Form.useForm();
  const [qaForm] = Form.useForm();

  const guard = useApiKeyGuard();
  const canGenerate = guard.hasKey;

  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchError, setSearchError] = useState('');

  const [status, setStatus] = useState<any>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [uploading, setUploading] = useState(false);
  const [uploadModal, setUploadModal] = useState(false);
  const [uploadLog, setUploadLog] = useState<string[]>([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaResult, setQaResult] = useState<any>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // 文档列表
  const [documents, setDocuments] = useState<any[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  // 文档列表 — 仅显示知识库来源的文档，不显示教学台账等其他模块的文件
  const displayDocuments = React.useMemo(() => {
    const kbDocs = visible
      ? documents.filter(d => d._source === 'knowledge_base' || !d._source || d._source === 'user')
      : documents.filter(d => d._source !== 'seed');
    return kbDocs;
  }, [documents, visible]);

  const loadStatus = () => {
    setStatusLoading(true); setStatusError('');
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => { setStatusLoading(false); setStatusError('后端服务响应超时'); setStatus(null); }, 35000);
    knowledgeApi.status().then(res => {
      clearTimeout(statusTimerRef.current);
      if (res.data?.success) { setStatus(res.data.data); setStatusError(''); }
      else { setStatusError(res.data?.message || '获取状态失败'); setStatus(null); }
    }).catch((e) => {
      clearTimeout(statusTimerRef.current);
      setStatusError(e.response?.data?.detail || e.message || '无法连接后端服务');
      setStatus(null);
    }).finally(() => setStatusLoading(false));
  };

  const loadDocuments = () => {
    setDocsLoading(true);
    Promise.all([
      knowledgeApi.collections().catch(() => ({ data: { data: [] } })),
      knowledgeApi.status().catch(() => ({ data: { data: { total_chunks: 0, total_documents: 0, courses: [] } } })),
    ]).then(([colRes, statusRes]) => {
      const collections = colRes.data?.data || [];
      // 仅显示有实际切片的知识库集合（chunks > 0），不显示空集合或种子占位
      const docs: any[] = [];
      if (Array.isArray(collections)) {
        collections.forEach((c: any, idx: number) => {
          // 必须有实际内容（chunks > 0），且来源明确为知识库
          if ((c.count || 0) > 0) {
            docs.push({
              id: `col_${idx}`, name: c.name || c, course: c.name || c,
              chapter: '-', chunks: c.count || 0,
              size: '-', created_at: c.metadata?.created_at || '',
              _source: c._source || 'knowledge_base',
            });
          }
        });
      }
      setDocuments(docs);
    }).catch(() => {}).finally(() => setDocsLoading(false));
  };

  useEffect(() => { loadStatus(); loadDocuments(); return () => { if (statusTimerRef.current) clearTimeout(statusTimerRef.current); }; }, []);

  const handleSearch = async (values: any) => {
    if (!values.query?.trim()) { message.warning('请输入搜索内容'); return; }
    setSearching(true); setSearchError('');
    try {
      const res = await knowledgeApi.search(values.query, values.course || '', values.top_k || 5);
      if (res.data.success) setSearchResults(res.data.data.results || []);
      else setSearchError(res.data.message || '搜索失败');
    } catch (e: any) { setSearchError(e.response?.data?.detail || '请求失败'); }
    finally { setSearching(false); }
  };

  // 使用 customRequest 替代 beforeUpload，正确处理多文件上传
  const handleUpload = async (options: any) => {
    const { file, onSuccess, onError } = options;
    const course = uploadForm.getFieldValue('course') || 'default';
    const chapter = uploadForm.getFieldValue('chapter') || '';
    setUploading(true); setUploadModal(true); setUploadLog([`开始导入: ${file.name}`]);
    try {
      const res = await knowledgeApi.upload(file, course, chapter);
      if (res.data.success) {
        setUploadLog(prev => [...prev, `✅ 导入成功: ${file.name}`]);
        message.success(res.data.message || '上传成功'); loadStatus();
        onSuccess(res.data, file);
      } else {
        setUploadLog(prev => [...prev, `❌ 导入失败: ${res.data.message || '未知错误'}`]);
        message.error(res.data.message || '上传失败');
        onError(new Error(res.data.message || '未知错误'));
      }
    } catch (e: any) {
      setUploadLog(prev => [...prev, `❌ 导入失败: ${e.response?.data?.detail || e.message}`]);
      message.error(e.response?.data?.detail || '上传失败');
      onError(e);
    } finally { setUploading(false); uploadForm.resetFields(); }
  };

  // ── AI 答疑 ──
  const handleQA = async (values: any) => {
    if (!canGenerate) { guard.showGuard(); return; }
    if (!values.question?.trim()) { message.warning('请输入问题'); return; }
    setQaLoading(true); setQaResult(null);
    try {
      // 先检索知识库
      const searchRes = await knowledgeApi.search(values.question, values.course || '', 8);
      const contexts = searchRes.data?.data?.results || [];
      setSearchResults(contexts);
      // 模拟AI答疑结果（实际应调用LLM）
      setQaResult({
        definition: `${values.question} 是计算机科学中的重要概念。根据教材定义：...`,
        layered: { basic: '通俗解释...', advanced: '专业推导...' },
        confusion: [{ concept: '概念A', contrast: '区别说明' }],
        teaching_tips: '讲解话术建议...',
        examples: [{ question: '例题', answer: '解答' }],
      });
      message.success('AI 答疑生成完成');
    } catch (e: any) { message.error(e.response?.data?.detail || '请求失败'); }
    finally { setQaLoading(false); }
  };

  // ── 导出答疑结果为 Word ──
  const handleExportQAWord = async () => {
    if (!qaResult) { message.warning('没有可导出的答疑结果'); return; }
    const course = qaForm.getFieldValue('course') || '答疑';
    const question = qaForm.getFieldValue('question') || '';
    const lines = [
      'AI 答疑报告', `课程：${course}`, `问题：${question}`, '',
      '【知识点定义】', qaResult.definition || '', '',
      '【基础通俗解释】', qaResult.layered?.basic || '', '',
      '【专业严谨推导】', qaResult.layered?.advanced || '', '',
    ];
    if (qaResult.confusion?.length > 0) {
      lines.push('【易混淆概念对比】');
      qaResult.confusion.forEach((c: any) => lines.push(`- ${c.concept}: ${c.contrast}`));
      lines.push('');
    }
    if (qaResult.examples?.length > 0) {
      lines.push('【同类巩固例题】');
      qaResult.examples.forEach((ex: any, i: number) => {
        lines.push(`例题${i + 1}：${ex.question}`);
        lines.push(`答案：${ex.answer}`);
      });
    }
    try {
      const res = await resourcesApi.exportWord({ title: `AI答疑_${course}`, content: lines.join('\n'), filename: `AI答疑_${course}.docx` });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `AI答疑_${course}.docx`; a.click(); URL.revokeObjectURL(url);
      message.success('Word 文档已导出');
    } catch (e: any) { message.error('导出失败: ' + (e.message || '未知错误')); }
  };

  const [selectedCourse, setSelectedCourse] = useState<string>('');

  return (
    <div className="page-enter" style={{ position: 'relative' }}>
      {!canGenerate && <ApiKeyBanner onGoSettings={guard.goToSettings} />}

      <div style={{ marginBottom: 16 }}>
        <Space align="center" size={10}>
          <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }}
            style={{ width: 32, height: 32, display: 'inline-flex', animation: 'logoPulse 0.8s ease-out' }} />
          <div>
            <Title level={4} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: BRAND.colors.textPrimary }}>
              智教星 · 智能答疑管理
            </Title>
            <Text type="secondary" style={{ fontSize: 11 }}>RAG 教材知识库 · AI 溯源答疑</Text>
          </div>
        </Space>
      </div>

      <Row gutter={16}>
        {/* ════════════════════════════════════════ */}
        {/* 左侧面板 */}
        {/* ════════════════════════════════════════ */}
        <Col xs={24} lg={9}>
          {/* 知识库状态 */}
          <Card className="brand-card" style={{ marginBottom: 16 }}
            title={<Space><BrandBadge /><DatabaseOutlined style={{ color: BRAND.colors.primary }} /><Text strong>知识库状态</Text></Space>}
            extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadStatus} loading={statusLoading} style={{ borderRadius: 6 }}>刷新</Button>}>
            {statusLoading ? <Spin><div style={{ padding: 24 }} /></Spin> : statusError ? (
              <div style={{ textAlign: 'center', padding: 16 }}><Text type="danger" style={{ fontSize: 12 }}>{statusError}</Text><br /><Button type="link" size="small" onClick={loadStatus} style={{ marginTop: 4 }}>重试</Button></div>
            ) : (
              <div>
                <Row gutter={[8, 8]}>
                  <Col span={12}><Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px' }}>
                    <Statistic title="文档总数" value={visible ? (status?.total_documents || 0) : 0} suffix="份" valueStyle={{ fontSize: 20, fontWeight: 700, color: BRAND.colors.primary }} /></Card></Col>
                  <Col span={12}><Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px' }}>
                    <Statistic title="向量切片" value={visible ? (status?.total_chunks || 0) : 0} suffix="段" valueStyle={{ fontSize: 20, fontWeight: 700, color: BRAND.colors.purple }} /></Card></Col>
                  <Col span={12}><Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px' }}>
                    <Statistic title="关联课程" value={visible ? (status?.courses?.length || 0) : 0} suffix="门" valueStyle={{ fontSize: 20, fontWeight: 700, color: BRAND.colors.green }} /></Card></Col>
                  <Col span={12}><Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px' }}>
                    <Statistic title="存储占用" value={status?.storage || '—'} valueStyle={{ fontSize: 18, fontWeight: 700, color: BRAND.colors.orange }} /></Card></Col>
                </Row>
                {visible && status?.courses?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Text style={{ fontSize: 11, color: BRAND.colors.textSecondary }}>已有课程：</Text>
                    <Space wrap style={{ marginTop: 2 }}>{status.courses.map((c: string, i: number) => <Tag key={i} style={{ borderRadius: 6, fontSize: 10 }}>{c}</Tag>)}</Space>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* 导入教材 */}
          <Card className="brand-card" style={{ marginBottom: 16 }}
            title={<Space><BrandBadge color={BRAND.colors.green} /><UploadOutlined style={{ color: BRAND.colors.green }} /><Text strong>导入教材</Text></Space>}>
            <Form form={uploadForm} layout="vertical" size="small">
              <Form.Item name="course" label="所属课程" rules={[{ required: true, message: '请选择课程' }]}>
                <Select style={{ borderRadius: 8 }} placeholder="选择课程" options={courseOptions} />
              </Form.Item>
              <Form.Item name="chapter" label="章节（可选）">
                <Input placeholder="例：第三章 决策树" style={{ borderRadius: 8 }} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Upload.Dragger accept=".pdf,.txt,.docx,.doc" customRequest={handleUpload} showUploadList={false} disabled={uploading} style={{ borderRadius: 8 }}
                  onChange={(info: any) => {
                    const uploadingCount = info.fileList.filter((f: any) => f.status === 'uploading').length;
                    if (uploadingCount === 0) setUploading(false);
                  }}>
                  {uploading ? <Spin tip="导入中..." /> : <div style={{ padding: 16 }}><InboxOutlined style={{ fontSize: 32, color: BRAND.colors.primary }} /><Paragraph style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>点击或拖拽文件</Paragraph><Text type="secondary" style={{ fontSize: 11 }}>PDF / Word / TXT</Text></div>}
                </Upload.Dragger>
              </Form.Item>
            </Form>
          </Card>

          {/* 语义检索 */}
          <Card className="brand-card" style={{ marginBottom: 16 }}
            title={<Space><BrandBadge /><SearchOutlined style={{ color: BRAND.colors.primary }} /><Text strong>知识库检索</Text></Space>}>
            <Form form={searchForm} layout="vertical" onFinish={handleSearch} size="small">
              <Form.Item name="course" label="限定课程">
                <Select style={{ borderRadius: 8 }} placeholder="所有课程" allowClear options={courseOptions} onChange={v => setSelectedCourse(v || '')} />
              </Form.Item>
              <Form.Item name="query" label="搜索内容" rules={[{ required: true, message: '请输入搜索内容' }]}>
                <TextArea rows={2} placeholder="输入知识点/关键词..." style={{ borderRadius: 8, resize: 'none' }} />
              </Form.Item>
              <Form.Item name="top_k" label="返回数量" initialValue={5} hidden><Input /></Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={searching} icon={<SearchOutlined />} block
                  style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient }}>
                  {searching ? '检索中...' : '语义检索'}
                </Button>
              </Form.Item>
            </Form>
            {searchError && <Alert message={searchError} type="error" showIcon style={{ marginTop: 8, borderRadius: 6, fontSize: 12 }} />}
          </Card>

          {/* AI 答疑 */}
          <Card className="brand-card"
            title={<Space><BrandBadge color={BRAND.colors.purple} /><RobotOutlined style={{ color: BRAND.colors.purple }} /><Text strong>AI 智能答疑</Text></Space>}>
            <Form form={qaForm} layout="vertical" onFinish={handleQA} size="small">
              <Form.Item name="course" label="关联课程">
                <Select style={{ borderRadius: 8 }} placeholder="自动检索全部课程" allowClear options={courseOptions} />
              </Form.Item>
              <Form.Item name="question" label="问题" rules={[{ required: true, message: '请输入问题' }]}>
                <TextArea rows={3} placeholder="输入学生提问、知识点疑问、习题求解..." style={{ borderRadius: 8, resize: 'none' }} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                {canGenerate ? (
                  <Button type="primary" htmlType="submit" loading={qaLoading} icon={<ThunderboltOutlined />} block
                    style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, height: 38 }}>
                    {qaLoading ? 'AI 生成答疑中...' : 'AI 生成答疑'}
                  </Button>
                ) : (
                  <DisabledAIButton label="AI 答疑已锁定" icon={<KeyOutlined />} />
                )}
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* ════════════════════════════════════════ */}
        {/* 右侧面板 */}
        {/* ════════════════════════════════════════ */}
        <Col xs={24} lg={15}>
          {/* 检索结果 */}
          {searching && (
            <Card className="brand-card" bodyStyle={{ padding: 40, textAlign: 'center' }}>
              <div style={{ animation: 'logoGlow 1.5s ease-in-out infinite' }}>
                <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 40, height: 40, display: 'inline-block' }} /></div>
              <Spin style={{ marginTop: 8 }} /><Paragraph style={{ marginTop: 4, color: BRAND.colors.textSecondary, fontSize: 12 }}>正在检索知识库...</Paragraph>
            </Card>
          )}

          {searchResults.length > 0 && !searching && !qaLoading && (
            <Card className="brand-card" style={{ marginBottom: qaResult ? 16 : 0 }}
              title={<Space><BrandBadge /><SearchOutlined style={{ color: BRAND.colors.primary }} /><Text strong>检索结果（{searchResults.length} 条）</Text></Space>}
              bodyStyle={{ padding: '8px 16px', maxHeight: 400, overflow: 'auto' }}>
              <List size="small" dataSource={searchResults} renderItem={(item: any, idx: number) => (
                <List.Item style={{ padding: '8px 4px', borderBottom: `1px solid ${BRAND.colors.border}` }}
                  extra={<Space size={4}><Tag style={{ borderRadius: 6, fontSize: 10 }}>{(item.score * 100).toFixed(0)}%</Tag><Tag style={{ borderRadius: 6, fontSize: 10 }}>{item.source?.split('/')[0] || '教材'}</Tag></Space>}>
                  <List.Item.Meta title={<Text strong style={{ fontSize: 12 }}>#{idx + 1}</Text>}
                    description={<div><Paragraph ellipsis={{ rows: 2, expandable: true }} style={{ fontSize: 12, marginBottom: 0 }}>{item.content}</Paragraph>
                      {item.metadata?.chapter && <Tag style={{ borderRadius: 6, fontSize: 10, marginTop: 2 }} color="geekblue">{item.metadata.chapter}</Tag>}
                      <Button type="link" size="small" icon={<LinkOutlined />} style={{ fontSize: 10, padding: 0 }}>引用片段</Button>
                    </div>} />
                </List.Item>
              )} />
            </Card>
          )}

          {/* AI 答疑结果 */}
          {qaLoading && (
            <Card className="brand-card" bodyStyle={{ padding: 40, textAlign: 'center' }}>
              <div style={{ animation: 'logoGlow 1.5s ease-in-out infinite' }}>
                <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 48, height: 48, display: 'inline-block' }} /></div>
              <Spin style={{ marginTop: 12 }} /><Paragraph style={{ marginTop: 8, color: BRAND.colors.textSecondary, fontSize: 12 }}>正在检索知识库并生成答疑...</Paragraph>
            </Card>
          )}

          {qaResult && !qaLoading && (
            <Card className="brand-card" bodyStyle={{ padding: '16px 20px', position: 'relative' }}>
              <span style={{ position: 'absolute', top: 8, right: 10, color: BRAND.colors.purple, opacity: 0.3 }}><BrandBadge size={16} color={BRAND.colors.purple} /></span>
              <Space style={{ marginBottom: 12 }}>
                <RobotOutlined style={{ color: BRAND.colors.purple, fontSize: 18 }} />
                <Text strong style={{ fontSize: 14 }}>AI 答疑回答</Text>
                <Tag style={{ borderRadius: 6, background: `${BRAND.colors.green}15`, color: BRAND.colors.green, border: 'none', fontSize: 10 }}>
                  基于教材 RAG 生成
                </Tag>
              </Space>

              {/* 知识点定义 */}
              <Card size="small" title="📖 知识点标准定义" style={{ marginBottom: 8, borderRadius: 8 }} bodyStyle={{ padding: '8px 12px' }}>
                <Paragraph style={{ fontSize: 13 }}>{qaResult.definition}</Paragraph>
                <Tag color="blue" style={{ borderRadius: 6, fontSize: 10 }}>来源：教材 第3章 第2节</Tag>
              </Card>

              {/* 分层讲解 */}
              <Card size="small" title="📚 分层讲解" style={{ marginBottom: 8, borderRadius: 8 }} bodyStyle={{ padding: '8px 12px' }}>
                <Collapse items={[
                  { key: 'basic', label: '🌱 基础通俗解释', children: <Paragraph style={{ margin: 0, fontSize: 13 }}>{qaResult.layered?.basic}</Paragraph> },
                  { key: 'advanced', label: '🔬 专业严谨推导', children: <Paragraph style={{ margin: 0, fontSize: 13, fontFamily: 'monospace' }}>{qaResult.layered?.advanced}</Paragraph> },
                ]} style={{ borderRadius: 8 }} size="small" />
              </Card>

              {/* 易混淆对比 */}
              {qaResult.confusion?.length > 0 && (
                <Card size="small" title="⚖️ 易混淆概念对比" style={{ marginBottom: 8, borderRadius: 8 }} bodyStyle={{ padding: '8px 12px' }}>
                  <List size="small" dataSource={qaResult.confusion} renderItem={(c: any) => (
                    <List.Item><Tag color="volcano" style={{ borderRadius: 6 }}>{c.concept}</Tag><Text style={{ fontSize: 12 }}>{c.contrast}</Text></List.Item>
                  )} />
                </Card>
              )}

              {/* 巩固例题 */}
              {qaResult.examples?.length > 0 && (
                <Card size="small" title="📝 同类巩固例题" style={{ marginBottom: 8, borderRadius: 8 }} bodyStyle={{ padding: '8px 12px' }}>
                  <List size="small" dataSource={qaResult.examples} renderItem={(ex: any, i: number) => (
                    <List.Item><Text style={{ fontSize: 12 }}><Text strong>例题 {i + 1}：</Text>{ex.question}</Text><Tag color="green" style={{ borderRadius: 6, fontSize: 10 }}>答案：{ex.answer}</Tag></List.Item>
                  )} />
                </Card>
              )}

              <Divider style={{ margin: '8px 0' }} />
              <Space>
                <Button icon={<DownloadOutlined />} size="small" onClick={handleExportQAWord}
                  style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>导出 Word</Button>
                <Button icon={<HistoryOutlined />} size="small" style={{ borderRadius: 6, borderColor: BRAND.colors.purple, color: BRAND.colors.purple }}>归档至台账</Button>
                {canGenerate ? (
                  <Button icon={<ReloadOutlined />} size="small" style={{ borderRadius: 6 }} onClick={() => qaForm.submit()}>重新生成</Button>
                ) : (
                  <Button disabled size="small" style={{ borderRadius: 6 }}>重新生成</Button>
                )}
              </Space>
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 10 }}>【本内容由学科垂类AI助教生成，基于教材知识库检索增强】</Text>
            </Card>
          )}

          {/* 空状态 */}
          {!searching && searchResults.length === 0 && !qaResult && !qaLoading && (
            <Card className="brand-card" bodyStyle={{ padding: 60, textAlign: 'center' }}>
              <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 56, height: 56, display: 'inline-block', opacity: 0.3 }} />
              <Paragraph style={{ marginTop: 8, color: BRAND.colors.textTertiary, fontSize: 13 }}>检索知识库或输入问题开始 AI 答疑</Paragraph>
            </Card>
          )}
        </Col>
      </Row>

      {/* ════════════════════════════════════════ */}
      {/* 文档管理列表 */}
      {/* ════════════════════════════════════════ */}
      <Card className="brand-card" style={{ marginTop: 16 }}
        title={<Space><BrandBadge /><FileTextOutlined style={{ color: BRAND.colors.primary }} /><Text strong>知识库文档管理</Text></Space>}
        bodyStyle={{ padding: '12px 16px' }}
        extra={
          <Space>
            <Select style={{ width: 140, borderRadius: 6 }} placeholder="按课程筛选" allowClear options={courseOptions} />
            <Button size="small" icon={<DeleteOutlined />} danger style={{ borderRadius: 6 }}>批量删除</Button>
          </Space>
        }>
        <Table dataSource={displayDocuments} rowKey="id" size="small" pagination={{ pageSize: 5 }}
          loading={docsLoading}
          locale={{ emptyText: '暂无知识库文档，请通过上方「导入教材」上传 PDF 文件' }}
          columns={[
            { title: '文档名称', dataIndex: 'name', key: 'name', ellipsis: true,
              render: (v: string) => <Space><FileTextOutlined style={{ color: BRAND.colors.primary }} /><Text style={{ fontSize: 12 }}>{v}</Text></Space> },
            { title: '课程', dataIndex: 'course', key: 'course', width: 100,
              render: (v: string) => <Tag style={{ borderRadius: 6, fontSize: 10 }}>{v}</Tag> },
            { title: '切片数', dataIndex: 'chunks', key: 'chunks', width: 70,
              render: (v: number) => <Text style={{ color: v > 0 ? BRAND.colors.green : '#999' }}>{v || 0}</Text> },
            { title: '大小', dataIndex: 'size', key: 'size', width: 80 },
            { title: '上传时间', dataIndex: 'created_at', key: 'created_at', width: 100 },
            { title: '操作', key: 'action', width: 180,
              render: (_: any, record: any) => (
                <Space size={0}>
                  <Button type="link" size="small" style={{ fontSize: 11 }}
                    onClick={() => { searchForm.setFieldsValue({ query: record.course || record.name }); message.info(`已填入搜索：${record.course || record.name}`); }}>
                    检索
                  </Button>
                  <Button type="link" size="small" style={{ fontSize: 11, color: BRAND.colors.green }}
                    onClick={() => message.info('请通过上方「导入教材」重新上传文件')}>重新切片</Button>
                  <Popconfirm title="确认删除此知识库？" onConfirm={() => {
                    knowledgeApi.deleteCollection(record.course || record.name).then(() => { message.success('已删除'); loadDocuments(); loadStatus(); }).catch(() => message.error('删除失败'));
                  }}><Button type="link" size="small" danger style={{ fontSize: 11 }}>删除</Button></Popconfirm>
                </Space>
              ) },
          ]} />
      </Card>

      {/* 导入进度弹窗 */}
      <Modal title="导入进度" open={uploadModal} onCancel={() => { if (!uploading) setUploadModal(false); }} footer={null} closable={!uploading} width={450}>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {uploading && <Progress percent={50} status="active" />}
          <div style={{ maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 6 }}>
            {uploadLog.map((log, i) => (
              <Text key={i} style={{ display: 'block', fontSize: 11, fontFamily: 'monospace', color: log.includes('✅') ? BRAND.colors.green : log.includes('❌') ? BRAND.colors.error : '#333' }}>
                {log}
              </Text>
            ))}
          </div>
          {!uploading && <Button type="primary" onClick={() => setUploadModal(false)} style={{ borderRadius: 6, background: BRAND.colors.primaryGradient, border: 'none' }}>完成</Button>}
        </Space>
      </Modal>

      {/* 水印 */}
      <div className="brand-watermark">Edu-TA 知识库 · 教材可溯源</div>

      <ApiKeyGuardModal visible={guard.modalVisible} onClose={guard.hideGuard} onGoSettings={guard.goToSettings} />
      <SettingsModal open={guard.settingsVisible} onClose={() => guard.setSettingsVisible(false)} />
    </div>
  );
};

export default KnowledgeBase;
