/**
 * 资源中心 — Edu-TA 智教星 统一本地文件存储总入口
 *
 * 功能：上传/下载/删除/预览/同步知识库/跨模块文件复用
 * 联动：课程、知识库、备课、台账全模块文件通道
 * 无AI操作，永久开放
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Card, Typography, Space, Row, Col, Tag, Avatar, Button, Progress, List,
  Tooltip, Checkbox, Divider, message, Upload, Popconfirm, Modal, Spin,
  Empty, Statistic, Select, Input, AutoComplete,
} from 'antd';
import {
  FolderOutlined, FileTextOutlined, CloudUploadOutlined, FileOutlined,
  DeleteOutlined, DownloadOutlined, EyeOutlined, InboxOutlined,
  SearchOutlined, ReloadOutlined, BookOutlined, LinkOutlined,
  CodeOutlined, FilePdfOutlined, FileWordOutlined, FileUnknownOutlined,
  ClearOutlined, SafetyOutlined,
} from '@ant-design/icons';
import { materialApi, knowledgeApi } from '../api/client';
import { BRAND, CARD_SPECS } from '../utils/brand';
import '../styles/brand.css';
import { useDataVisibility } from '../context/DataVisibilityContext';

const { Text } = Typography;
const { Dragger } = Upload;

const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', color || BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle' }} />
);

interface ResourceItem {
  id: string; filename: string; course: string; chapter: string;
  size_display: string; size: number; pages: number; created_at: string; text_preview?: string;
  _source?: string;
}

const TOTAL_SPACE_BYTES = 500 * 1024 * 1024; // 500 MB 教学资源存储上限

const typeColor: Record<string, string> = {
  '教材': '#0F52BA', '课件': '#36D399', '笔记': '#13C2C2',
  '报告': '#7B61FF', '素材': '#FF9F43', '压缩包': '#EB2F96',
  '其他': '#9CA3AF',
};

function guessTag(filename: string): string {
  const f = filename.toLowerCase();
  if (f.includes('课件') || f.endsWith('.pptx') || f.endsWith('.ppt')) return '课件';
  if (f.includes('教材') || f.includes('讲义') || f.includes('指导书') || f.endsWith('.pdf')) return '教材';
  if (f.includes('笔记') || f.includes('课堂')) return '笔记';
  if (f.includes('报告') || f.includes('总结') || f.endsWith('.docx') || f.endsWith('.doc')) return '报告';
  if (f.includes('素材') || f.includes('图片') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')) return '素材';
  if (f.endsWith('.zip') || f.endsWith('.rar') || f.endsWith('.7z')) return '压缩包';
  return '其他';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const typeIcon = (tag: string) => {
  const map: Record<string, React.ReactNode> = {
    '教材': <FilePdfOutlined />, '课件': <FileTextOutlined />, '笔记': <BookOutlined />,
    '报告': <FileWordOutlined />, '压缩包': <FolderOutlined />, '其他': <FileUnknownOutlined />,
  };
  return map[tag] || <FileUnknownOutlined />;
};

const ResourceCenter: React.FC = () => {
  const { visible } = useDataVisibility();
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [previewFile, setPreviewFile] = useState<ResourceItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploadCourse, setUploadCourse] = useState('');
  const [uploadModal, setUploadModal] = useState(false);
  const [customTypes, setCustomTypes] = useState<Record<string, string>>({}); // resource id → type
  const [allTypeOptions, setAllTypeOptions] = useState<string[]>(['教材', '课件', '笔记', '报告', '素材', '压缩包', '其他']);

  // ── 清理重复文件 ──
  const [dupModalOpen, setDupModalOpen] = useState(false);
  const [dupDeleting, setDupDeleting] = useState(false);

  const handleCleanDuplicates = async () => {
    if (duplicates.length === 0) { message.success('未发现重复文件'); return; }
    setDupModalOpen(true);
  };

  const handleDeleteDuplicates = async (keepId: string, group: ResourceItem[]) => {
    const toDelete = group.filter(r => r.id !== keepId && !r.id.startsWith('demo-'));
    if (toDelete.length === 0) { message.info('没有可删除的重复文件'); return; }
    setDupDeleting(true);
    let ok = 0;
    for (const r of toDelete) {
      try { await materialApi.delete(r.id); ok++; } catch {}
    }
    setDupDeleting(false);
    message.success(`已清理 ${ok} 个重复文件`);
    loadResources();
  };

  // 获取资源的实际类型
  const getResourceType = (item: ResourceItem) => customTypes[item.id] || guessTag(item.filename);

  // 添加/删除自定义类型
  const handleAddType = (newType: string) => {
    if (newType && !allTypeOptions.includes(newType)) {
      setAllTypeOptions(prev => [...prev, newType]);
      message.success(`已添加类型「${newType}」`);
    }
  };

  const handleDeleteType = (type: string) => {
    // 检查是否有资源在使用此类型
    const inUse = resources.some(r => getResourceType(r) === type);
    if (inUse) { message.warning(`类型「${type}」仍有资源在使用，无法删除`); return; }
    if (['教材', '课件', '笔记', '报告', '素材', '压缩包', '其他'].includes(type)) {
      message.warning('默认类型不可删除');
      return;
    }
    setAllTypeOptions(prev => prev.filter(t => t !== type));
    message.success(`已删除类型「${type}」`);
  };

  const loadResources = async () => {
    setLoading(true);
    try {
      // 并行加载教学资料和知识库文档
      const [matRes, kbRes] = await Promise.all([
        materialApi.list().catch(() => ({ data: { data: { items: [] } } })),
        knowledgeApi.collections().catch(() => ({ data: { data: [] } })),
      ]);
      const materials: ResourceItem[] = (matRes.data?.data?.items || []).map((m: any) => ({
        ...m, _type: 'material',
      }));
      const kbDocs: ResourceItem[] = (kbRes.data?.data || []).map((col: any) => ({
        id: `kb_${col.collection_name || col.name}`,
        filename: col.name || col.collection_name || '未知文档',
        course: col.name || '未知课程',
        chapter: '-',
        size_display: formatBytes(col.metadata?.total_size || 0),
        size: col.metadata?.total_size || 0,
        pages: col.count || 0,
        created_at: col.metadata?.uploaded_at || '',
        text_preview: `知识库集合 · ${col.count || 0} 个切片`,
        _source: col._source || 'knowledge_base',
        _type: 'knowledge_base',
      }));
      setResources([...materials, ...kbDocs]);
    }
    catch { setResources([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadResources(); }, []);

  // 可显示的资源：隐藏模式下排除种子数据，仅保留用户上传的
  const displayResources = useMemo(() => visible ? resources : resources.filter(r => r._source !== 'seed'), [resources, visible]);
  const displayCourses = useMemo(() => [...new Set(displayResources.map(r => r.course).filter(Boolean))].sort(), [displayResources]);

  const courses = useMemo(() => [...new Set(resources.map(r => r.course).filter(Boolean))].sort(), [resources]);
  const typeOptions = useMemo(() => [...new Set([...resources.map(r => getResourceType(r)), ...allTypeOptions])].sort(), [resources, customTypes, allTypeOptions]);

  const filtered = useMemo(() => {
    let r = displayResources;
    if (selectedCourse) r = r.filter(x => x.course === selectedCourse);
    if (selectedType) r = r.filter(x => getResourceType(x) === selectedType);
    if (searchText) r = r.filter(x => x.filename.includes(searchText) || x.course.includes(searchText));
    return r;
  }, [displayResources, selectedCourse, selectedType, searchText, customTypes]);

  // 存储统计应基于全部资源（物理存储不受可见性影响）
  const usedBytes = useMemo(() => resources.reduce((s, r) => s + (r.size || 0), 0), [resources]);
  const usedPercent = Math.min(parseFloat(((usedBytes / TOTAL_SPACE_BYTES) * 100).toFixed(2)), 100);
  const isOver = usedPercent >= 80;

  // 找出重复文件（同名视为重复，基于可显示资源）
  const duplicates = useMemo(() => {
    const map = new Map<string, ResourceItem[]>();
    displayResources.forEach(r => {
      const key = r.filename.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries())
      .filter(([_, items]) => items.length > 1)
      .map(([name, items]) => ({ name: items[0].filename, items }));
  }, [displayResources]);

  // 各类型资源计数
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    displayResources.forEach(r => { const t = getResourceType(r); counts[t] = (counts[t] || 0) + 1; });
    return counts;
  }, [displayResources, customTypes]);

  const pendingCountRef = useRef(0);

  const handleUploadRequest = async (options: any) => {
    const { file, onSuccess, onError } = options;
    pendingCountRef.current++;
    setUploading(true);
    try {
      const res = await materialApi.upload(file, uploadCourse || '', '');
      if (res.data.success) { message.success(`「${file.name}」上传成功`); onSuccess(res.data, file); }
      else { message.error(res.data.detail || res.data.message || `「${file.name}」上传失败`); onError(new Error(res.data.detail || '上传失败')); }
    } catch (e: any) { message.error(`「${file.name}」上传失败：` + (e.response?.data?.detail || e.message)); onError(e); }
    finally {
      pendingCountRef.current--;
      if (pendingCountRef.current <= 0) {
        pendingCountRef.current = 0;
        setUploading(false);
        loadResources(); // 全部上传完成后统一刷新
      }
    }
  };

  const handleDelete = async (item: ResourceItem) => {
    if (item.id.startsWith('demo-')) { message.info('示例资源不可删除'); return; }
    Modal.confirm({
      title: '确认删除',
      content: '删除后无法恢复，若被教案/作业引用可能影响正常使用。',
      onOk: async () => {
        try { await materialApi.delete(item.id); message.success(`已删除「${item.filename}」`); loadResources(); }
        catch { message.error('删除失败'); }
      },
    });
  };

  const batchDelete = () => {
    const real = selectedIds.filter(id => !id.startsWith('demo-'));
    if (real.length === 0) { message.info('示例资源不可删除'); return; }
    Modal.confirm({ title: `确认删除 ${real.length} 个文件？`, content: '删除后无法恢复。', onOk: async () => {
      for (const id of real) { try { await materialApi.delete(id); } catch {} }
      message.success(`已删除 ${real.length} 个文件`); setSelectedIds([]); loadResources();
    }});
  };

  return (
    <div className="page-enter">
      {/* 头部 */}
      <div style={{ marginBottom: 16 }}>
        <Space align="center" size={10}>
          <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 32, height: 32, display: 'inline-flex', animation: 'logoPulse 0.8s ease-out' }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: BRAND.colors.textPrimary }}>智教星 · 资源中心</div>
            <Text type="secondary" style={{ fontSize: 11 }}>统一文件存储 · 跨模块素材复用</Text>
          </div>
        </Space>
      </div>

      {/* 统计卡 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { value: displayResources.length, label: '资源总数', icon: <FolderOutlined />, color: BRAND.colors.primary, suffix: '个', tip: visible ? (
              <div style={{ lineHeight: 1.8, fontSize: 12, minWidth: 120, color: '#fff' }}>
                {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <div key={type}>{type}：{count} 个</div>
                ))}
              </div>
            ) : ''},
          { value: formatBytes(usedBytes), label: '已用空间', icon: <FileOutlined />, color: isOver ? BRAND.colors.orange : BRAND.colors.green, suffix: '', tip: visible ? `${formatBytes(usedBytes)} / ${formatBytes(TOTAL_SPACE_BYTES)}` : '' },
          { value: displayCourses.length, label: '覆盖课程', icon: <BookOutlined />, color: BRAND.colors.purple, suffix: '门', tip: visible ? displayCourses.join('、') : '' },
          { value: formatBytes(TOTAL_SPACE_BYTES), label: '总容量', icon: <SafetyOutlined />, color: isOver ? BRAND.colors.error : BRAND.colors.primary, suffix: '', tip: usedPercent >= 80 ? '存储空间不足，建议清理冗余文件' : '' },
        ].map((item, i) => (
          <Col span={6} key={i}>
            <Tooltip title={item.tip}>
              <Card className="brand-card" bodyStyle={{ padding: '14px 18px', position: 'relative', border: isOver && i === 1 ? `1px solid ${BRAND.colors.orange}` : undefined }}>
                <span style={{ position: 'absolute', top: 6, right: 8, color: item.color, opacity: 0.3 }}><BrandBadge /></span>
                <Statistic title={<Text style={{ fontSize: 12, color: BRAND.colors.textSecondary }}>{item.label}</Text>}
                  value={item.value} prefix={<span style={{ color: item.color, fontSize: 18, marginRight: 4 }}>{item.icon}</span>}
                  valueStyle={{ fontSize: 22, fontWeight: 700, color: isOver && i === 1 ? BRAND.colors.orange : BRAND.colors.textPrimary }} />
                {isOver && i === 1 && <Tag color="warning" style={{ borderRadius: 6, fontSize: 10, marginTop: 2 }}>存储预警</Tag>}
              </Card>
            </Tooltip>
          </Col>
        ))}
      </Row>

      {/* 筛选 + 工具栏 */}
      <Card size="small" className="brand-card" style={{ marginBottom: 16 }} bodyStyle={{ padding: '10px 16px' }}>
        <Row gutter={12} align="middle">
          <Col flex="auto">
            <Space wrap size={8}>
              <Tag color={!selectedCourse ? 'blue' : 'default'} style={{ cursor: 'pointer', borderRadius: 6 }} onClick={() => setSelectedCourse(null)}>全部</Tag>
              {courses.map(c => (
                <Tag key={c} color={selectedCourse === c ? 'blue' : 'default'} style={{ cursor: 'pointer', borderRadius: 6 }} onClick={() => setSelectedCourse(c)}>{c}</Tag>
              ))}
            </Space>
          </Col>
          <Col>
            <Space size={8}>
              <Select style={{ width: 110, borderRadius: 6 }} placeholder="类型筛选" allowClear value={selectedType || undefined} onChange={v => setSelectedType(v || '')}
                options={typeOptions.map(t => ({ value: t, label: `${t} (${typeCounts[t] || 0})` }))}
                dropdownRender={menu => (
                  <>
                    {menu}
                    <Divider style={{ margin: '4px 0' }} />
                    <div style={{ padding: '4px 8px' }}>
                      <Input size="small" placeholder="输入新类型名称 → 回车添加"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim();
                            if (val) handleAddType(val);
                            (e.target as HTMLInputElement).value = '';
                          }
                        }} />
                    </div>
                  </>
                )} />
              <Input placeholder="搜索文件..." prefix={<SearchOutlined />} style={{ width: 160, borderRadius: 6 }} value={searchText} onChange={e => setSearchText(e.target.value)} allowClear />
              <Button size="small" icon={<ReloadOutlined />} onClick={loadResources} style={{ borderRadius: 6 }}>刷新</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={16}>
        {/* 左侧：文件列表 */}
        <Col span={16}>
          <Card className="brand-card" bodyStyle={{ padding: '8px 16px' }}
            title={<Space><BrandBadge /><FolderOutlined style={{ color: BRAND.colors.primary }} /><Text strong>{selectedCourse || '所有资源'}</Text><Tag style={{ borderRadius: 6, fontSize: 10 }}>{filtered.length} 个</Tag></Space>}
            extra={
              <Space>
                {selectedIds.length > 0 && (
                  <>
                    <Tag style={{ borderRadius: 6 }}>已选 {selectedIds.length}</Tag>
                    <Button size="small" icon={<DownloadOutlined />} style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>批量下载</Button>
                    <Popconfirm title={`删除 ${selectedIds.length} 个文件？`} onConfirm={batchDelete}>
                      <Button size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }}>批量删除</Button>
                    </Popconfirm>
                    <Button size="small" icon={<LinkOutlined />} style={{ borderRadius: 6, borderColor: BRAND.colors.purple, color: BRAND.colors.purple }}
                      onClick={async () => {
                        const toSync = resources.filter(r => selectedIds.includes(r.id) && !r.id.startsWith('demo-'));
                        if (toSync.length === 0) { message.warning('没有可同步的资源'); return; }
                        let ok = 0;
                        for (const item of toSync) {
                          try {
                            const response = await fetch(materialApi.download(item.id));
                            const blob = await response.blob();
                            const file = new File([blob], item.filename);
                            const { knowledgeApi } = await import('../api/client');
                            await knowledgeApi.upload(file, item.course, item.chapter || '');
                            ok++;
                          } catch {}
                        }
                        message.success(`已同步 ${ok}/${toSync.length} 个文件至知识库`);
                        setSelectedIds([]);
                      }}>同步知识库</Button>
                  </>
                )}
                <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setUploadModal(true)}
                  style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>上传资源</Button>
              </Space>
            }>
            {loading ? <Spin><div style={{ padding: 40 }} /></Spin> : filtered.length === 0 ? (
              <Empty description={visible ? <span>暂无资源，点击右上角「上传资源」添加</span> : <span>用例数据已隐藏</span>} />
            ) : (
              <List dataSource={filtered} renderItem={item => {
                const isKb = (item as any)._type === 'knowledge_base';
                const tag = isKb ? '知识库' : getResourceType(item);
                const kbActions = isKb ? [
                  <Tooltip title="查看切片" key="view"><Button type="link" size="small" icon={<EyeOutlined />} style={{ color: BRAND.colors.primary }} onClick={e => { e.stopPropagation(); setPreviewFile(item); }} /></Tooltip>,
                ] : [
                  <Tooltip title="预览" key="view"><Button type="link" size="small" icon={<EyeOutlined />} style={{ color: BRAND.colors.primary }} onClick={e => { e.stopPropagation(); setPreviewFile(item); }} /></Tooltip>,
                  <Tooltip title="下载" key="dl"><Button type="link" size="small" icon={<DownloadOutlined />} style={{ color: BRAND.colors.primary }} onClick={e => { e.stopPropagation(); if (!item.id.startsWith('demo-')) { const a = document.createElement('a'); a.href = materialApi.download(item.id); a.click(); } else message.info('示例不可下载'); }} /></Tooltip>,
                  <Tooltip title="同步至知识库" key="sync"><Button type="link" size="small" icon={<LinkOutlined />} style={{ color: BRAND.colors.purple }}
                    onClick={async e => {
                      e.stopPropagation();
                      if (item.id.startsWith('demo-')) { message.info('示例资源不支持同步'); return; }
                      try {
                        const response = await fetch(materialApi.download(item.id));
                        const blob = await response.blob();
                        const file = new File([blob], item.filename);
                        await knowledgeApi.upload(file, item.course, item.chapter || '');
                        message.success(`「${item.filename}」已同步至知识库`);
                      } catch (err: any) { message.error('同步失败: ' + (err.message || '未知错误')); }
                    }} /></Tooltip>,
                  <Popconfirm title="确认删除？" onConfirm={() => handleDelete(item)} key="del">
                    <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
                  </Popconfirm>,
                ];
                return (
                  <List.Item style={{ padding: '8px 4px', borderRadius: 6 }}
                    actions={kbActions}
                  >
                    <Checkbox style={{ marginRight: 8 }} checked={selectedIds.includes(item.id)} onChange={e => {
                      e.stopPropagation();
                      if (e.target.checked) setSelectedIds([...selectedIds, item.id]);
                      else setSelectedIds(selectedIds.filter(id => id !== item.id));
                    }} />
                    <Avatar icon={isKb ? <BookOutlined /> : typeIcon(tag)} style={{ backgroundColor: isKb ? BRAND.colors.purple : (typeColor[tag] || '#1890ff'), flexShrink: 0 }} />
                    <div style={{ flex: 1, marginLeft: 8 }}>
                      <Text strong style={{ fontSize: 12 }}>{item.filename}</Text>
                      <div>
                        <Tag style={{ borderRadius: 6, fontSize: 10 }}>{item.course}</Tag>
                        {isKb ? (
                          <Tag color="purple" style={{ borderRadius: 6, fontSize: 10 }}>知识库文档</Tag>
                        ) : (
                          <Select size="small" value={tag} style={{ width: 80, fontSize: 10 }}
                          dropdownStyle={{ fontSize: 11 }}
                          onClick={e => e.stopPropagation()}
                          onChange={v => { setCustomTypes(prev => ({ ...prev, [item.id]: v })); }}
                          dropdownRender={menu => (
                            <>
                              {menu}
                              <Divider style={{ margin: '4px 0' }} />
                              <Input size="small" placeholder="+ 添加新类型" style={{ borderRadius: 4 }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    const val = (e.target as HTMLInputElement).value.trim();
                                    if (val) { handleAddType(val); setCustomTypes(prev => ({ ...prev, [item.id]: val })); }
                                  }
                                }}
                                onBlur={e => {
                                  const val = (e.target as HTMLInputElement).value.trim();
                                  if (val) { handleAddType(val); setCustomTypes(prev => ({ ...prev, [item.id]: val })); }
                                }} />
                            </>
                          )}>
                          {allTypeOptions.map(t => <Select.Option key={t} value={t}>{t}</Select.Option>)}
                        </Select>
                        )}
                        <Text type="secondary" style={{ fontSize: 11 }}>{item.size_display}</Text>
                        {item.pages > 0 && <Text type="secondary" style={{ fontSize: 11 }}> · {item.pages} 页</Text>}
                        <Text type="secondary" style={{ fontSize: 11 }}> · {item.created_at?.slice(0, 10)}</Text>
                        {item.id.startsWith('demo-') && <Tag color="orange" style={{ borderRadius: 6, fontSize: 9, marginLeft: 4 }}>示例</Tag>}
                      </div>
                    </div>
                  </List.Item>
                );
              }} />
            )}
          </Card>
        </Col>

        {/* 右侧面板 */}
        <Col span={8}>
          {/* 存储概况 */}
          <Card className="brand-card" style={{ marginBottom: 16 }}
            title={<Space><BrandBadge color={BRAND.colors.primary} /><FileOutlined style={{ color: BRAND.colors.primary }} /><Text strong>存储概况</Text></Space>}>
            <div style={{ textAlign: 'center' }}>
              <Progress type="dashboard" percent={usedPercent > 0 ? Math.max(usedPercent, 2) : 0} size={130}
                strokeColor={isOver ? BRAND.colors.orange : BRAND.colors.primary}
                strokeWidth={10}
                format={() => <div><div style={{ fontSize: 20, fontWeight: 700, color: isOver ? BRAND.colors.orange : BRAND.colors.textPrimary }}>{formatBytes(usedBytes)}</div><div style={{ fontSize: 11, color: '#999' }}>已用</div></div>} />
              <div style={{ marginTop: 4 }}><Text strong style={{ fontSize: 13 }}>{formatBytes(usedBytes)}</Text><Text type="secondary" style={{ fontSize: 12 }}> / {formatBytes(TOTAL_SPACE_BYTES)}</Text></div>
              <div style={{ marginTop: 2 }}><Text type="secondary" style={{ fontSize: 11 }}>占比 {usedPercent.toFixed(2)}%</Text></div>
              {isOver && <Tag color="warning" style={{ marginTop: 4, borderRadius: 6 }}>⚠️ 存储空间不足，建议清理</Tag>}
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <Button icon={<ClearOutlined />} size="small" block style={{ borderRadius: 6, borderColor: BRAND.colors.orange, color: BRAND.colors.orange }}
              onClick={handleCleanDuplicates}>{duplicates.length > 0 ? `清理重复文件 (${duplicates.length}组)` : '清理重复文件'}</Button>
          </Card>

          {/* 上传面板 */}
          <Card className="brand-card" title={<Space><BrandBadge color={BRAND.colors.green} /><CloudUploadOutlined style={{ color: BRAND.colors.green }} /><Text strong>快速上传</Text></Space>}>
            <AutoComplete style={{ width: '100%', marginBottom: 8 }} placeholder="课程名称（可选，留空自动识别）" value={uploadCourse} onChange={v => setUploadCourse(v)}
              options={[...new Set(resources.map(r => r.course).filter(Boolean))].map(c => ({ value: c, label: c }))} />
            <Dragger accept=".pdf,.docx,.doc,.pptx,.ppt,.zip,.png,.jpg,.jpeg" customRequest={handleUploadRequest} showUploadList={false} disabled={uploading} multiple style={{ borderRadius: 8, padding: '4px 0' }}
              onChange={(info: any) => {
                const { file } = info;
                if (file.status === 'done' || file.status === 'error') {
                  const uploadingCount = info.fileList.filter((f: any) => f.status === 'uploading').length;
                  if (uploadingCount === 0) setUploading(false);
                }
              }}>
              {uploading ? <Spin tip="上传中..." /> : <div><InboxOutlined style={{ fontSize: 28, color: BRAND.colors.primary }} /><div style={{ marginBottom: 0, fontSize: 12 }}>点击或拖拽上传（支持多文件）</div><Text type="secondary" style={{ fontSize: 10 }}>PDF / Word / PPT / 图片 / ZIP</Text></div>}
            </Dragger>
          </Card>
        </Col>
      </Row>

      {/* 上传弹窗 */}
      <Modal title={<Space><BrandBadge color={BRAND.colors.green} /><CloudUploadOutlined />上传资源</Space>} open={uploadModal} onCancel={() => setUploadModal(false)} footer={null} width={500}>
        <AutoComplete style={{ width: '100%', marginBottom: 12 }} placeholder="课程名称（可选，留空自动识别）" value={uploadCourse} onChange={v => setUploadCourse(v)}
          options={[...new Set(resources.map(r => r.course).filter(Boolean))].map(c => ({ value: c, label: c }))} />
        <Dragger accept=".pdf,.docx,.doc,.pptx,.ppt,.zip,.png,.jpg,.jpeg" customRequest={handleUploadRequest} showUploadList={false} disabled={uploading} multiple style={{ borderRadius: 8 }}
          onChange={(info: any) => {
            const { file } = info;
            if (file.status === 'done' || file.status === 'error') {
              const uploadingCount = info.fileList.filter((f: any) => f.status === 'uploading').length;
              if (uploadingCount === 0) setUploading(false);
            }
          }}>
          {uploading ? <Spin tip="上传中..." /> : <div style={{ padding: 16 }}><InboxOutlined style={{ fontSize: 36, color: BRAND.colors.primary }} /><div style={{ marginBottom: 4 }}>点击或拖拽文件（支持批量上传）</div><Text type="secondary">PDF / Word / PPT / 图片 / ZIP · 可同时选择多个文件</Text></div>}
        </Dragger>
        {uploading && <Progress percent={60} status="active" style={{ marginTop: 8 }} />}
      </Modal>

      {/* 清理重复文件弹窗 */}
      <Modal
        title={<Space><ClearOutlined style={{ color: BRAND.colors.orange }} />清理重复文件</Space>}
        open={dupModalOpen}
        onCancel={() => setDupModalOpen(false)}
        width={720}
        footer={[<Button key="close" onClick={() => setDupModalOpen(false)} style={{ borderRadius: 6 }}>关闭</Button>]}
      >
        {duplicates.length === 0 ? (
          <Empty description="未发现重复文件" />
        ) : (
          <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
            {duplicates.map((group, gi) => (
              <Card key={gi} size="small" style={{ marginBottom: 10, borderRadius: 8 }}
                title={<Text strong style={{ fontSize: 13 }}>📄 {group.name} <Tag style={{ borderRadius: 6, fontSize: 10 }}>{group.items.length} 个副本</Tag></Text>}
              >
                {group.items.map((item, ii) => (
                  <Row key={item.id} style={{ padding: '6px 0', borderBottom: ii < group.items.length - 1 ? '1px solid #f0f0f0' : 'none' }}
                    justify="space-between" align="middle">
                    <Col flex="auto">
                      <Space size={4}>
                        <Avatar icon={typeIcon(getResourceType(item))} size={24} style={{ backgroundColor: typeColor[getResourceType(item)] || '#1890ff' }} />
                        <div>
                          <Text style={{ fontSize: 12 }}>{item.course} / {item.chapter || '通用'}</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 11 }}>{item.size_display} · {item.created_at?.slice(0, 10)}</Text>
                        </div>
                        {ii === 0 && <Tag color="blue" style={{ borderRadius: 6, fontSize: 10, marginLeft: 4 }}>保留</Tag>}
                        {item.id.startsWith('demo-') && <Tag color="orange" style={{ borderRadius: 6, fontSize: 10 }}>示例</Tag>}
                      </Space>
                    </Col>
                    <Col>
                      {ii !== 0 && !item.id.startsWith('demo-') && (
                        <Popconfirm title="确认删除此重复文件？" onConfirm={() => handleDeleteDuplicates(group.items[0].id, group.items)}>
                          <Button size="small" danger icon={<DeleteOutlined />} loading={dupDeleting} style={{ borderRadius: 6, fontSize: 11 }}>删除</Button>
                        </Popconfirm>
                      )}
                    </Col>
                  </Row>
                ))}
              </Card>
            ))}
          </div>
        )}
      </Modal>

      {/* 预览弹窗 */}
      <Modal title={<Space><EyeOutlined />{previewFile?.filename}</Space>} open={!!previewFile} onCancel={() => setPreviewFile(null)} footer={null} width={700}>
        {previewFile && (
          <div>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="blue" style={{ borderRadius: 6 }}>{previewFile.course}</Tag>
              <Tag color={typeColor[getResourceType(previewFile)] || '#1890ff'} style={{ borderRadius: 6 }}>{getResourceType(previewFile)}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{previewFile.size_display} · {previewFile.pages} 页 · {previewFile.created_at?.slice(0, 10)}</Text>
            </Space>
            <div style={{ background: '#fafafa', padding: 16, borderRadius: 8, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.8 }}>
              {previewFile.id.startsWith('demo-') ? `╔══════════════════════════════════════╗\n║  ${previewFile.filename}\n╠══════════════════════════════════════╣\n║  课程：${previewFile.course}  章节：${previewFile.chapter || '通用'}\n║  大小：${previewFile.size_display}（${previewFile.size} 字节）\n║  页数：${previewFile.pages} 页\n╚══════════════════════════════════════╝` : (previewFile.text_preview || '暂无预览')}
            </div>
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Space>
                <Button type="primary" icon={<DownloadOutlined />} disabled={previewFile.id.startsWith('demo-')}
                  onClick={() => {
                    if (!previewFile.id.startsWith('demo-')) {
                      const a = document.createElement('a');
                      a.href = materialApi.download(previewFile.id);
                      a.download = previewFile.filename;
                      a.click();
                      message.success(`开始下载「${previewFile.filename}」`);
                    }
                  }}
                  style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>下载文件</Button>
                <Button icon={<LinkOutlined />} style={{ borderRadius: 6, borderColor: BRAND.colors.purple, color: BRAND.colors.purple }}
                  onClick={async () => {
                    if (!previewFile || previewFile.id.startsWith('demo-')) { message.info('示例资源不支持同步'); return; }
                    try {
                      // 通过 fetch 获取文件内容再上传到知识库
                      const response = await fetch(materialApi.download(previewFile.id));
                      const blob = await response.blob();
                      const file = new File([blob], previewFile.filename);
                      const { knowledgeApi } = await import('../api/client');
                      await knowledgeApi.upload(file, previewFile.course, previewFile.chapter || '');
                      message.success(`「${previewFile.filename}」已同步至知识库`);
                    } catch (e: any) {
                      message.error('同步失败: ' + (e.message || '未知错误'));
                    }
                  }}>同步知识库</Button>
                <Button icon={<BookOutlined />} style={{ borderRadius: 6, borderColor: BRAND.colors.green, color: BRAND.colors.green }}
                  onClick={async () => {
                    if (!previewFile || previewFile.id.startsWith('demo-')) { message.info('示例资源不支持此操作'); return; }
                    try {
                      const res = await materialApi.toLesson(previewFile.id);
                      if (res.data.success) {
                        message.success(res.data.message || '已插入备课，可前往教学台账中心查看');
                        setPreviewFile(null);
                      }
                    } catch (e: any) {
                      message.error('插入备课失败: ' + (e.response?.data?.detail || e.message || '未知错误'));
                    }
                  }}>插入备课</Button>
              </Space>
            </div>
          </div>
        )}
      </Modal>

      <div className="brand-watermark">Edu-TA 资源中心 · 文件可追溯</div>
    </div>
  );
};

export default ResourceCenter;
