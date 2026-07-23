/**
 * LLM API 配置 — 多供应商管理版
 *
 * 页面直接展示所有支持厂商，一键填入配置。
 * 已配置的供应商以卡片列表展示，可编辑/测试/激活/删除。
 * 每个供应商独立配置 API Key + 模型，可随时切换全局激活。
 */

import React, { useState, useEffect } from 'react';
import {
  Card, Typography, Space, Tag, Button, Input, message, Divider,
  Modal, Popconfirm, Empty, Tooltip,
} from 'antd';
import {
  CheckCircleOutlined, WarningOutlined, CloseCircleOutlined,
  KeyOutlined, LinkOutlined, CloudServerOutlined, DeleteOutlined,
  GlobalOutlined, PlusOutlined, EditOutlined, ApiOutlined, StarFilled,
  StarOutlined, ReloadOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import { BRAND, CARD_SPECS } from '../utils/brand';
import {
  getLLMStatus, getProviders, saveProvider, setActiveProviderId,
  genId, deleteProvider, ProviderWithModels, getActiveProviderId,
} from '../utils/providerStorage';
import { getStatusInfo } from '../utils/apiKeyGuard';
import { apiUrl } from '../api/base';
import '../styles/brand.css';
import '../styles/llm-setting.css';

const { Title, Text } = Typography;

// ── 厂商预设 ──────────────────────────────────────────

interface VendorPreset {
  label: string; color: string; icon: string; base_url: string;
  models: { label: string; value: string }[];
}

const VENDORS: VendorPreset[] = [
  { label: 'DeepSeek', color: '#4D6BFE', icon: '🆂', base_url: 'https://api.deepseek.com', models: [
    { label: 'V4 Flash (推荐)', value: 'deepseek-v4-flash' }, { label: 'V4 Pro', value: 'deepseek-v4-pro' }] },
  { label: '智谱 GLM', color: '#EB2F96', icon: '🅖', base_url: 'https://open.bigmodel.cn/api/paas/v4/', models: [
    { label: 'GLM4 Flash', value: 'glm-4-flash' }, { label: 'GLM4 Pro', value: 'glm-4-pro' }] },
  { label: '通义千问', color: '#722ED1', icon: '🆀', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [
    { label: 'Qwen3 Turbo (推荐)', value: 'qwen3-turbo' }, { label: 'Qwen3 Plus', value: 'qwen3-plus' }] },
  { label: '讯飞星火', color: '#FA8C16', icon: '🆇', base_url: 'https://spark-api-open.xf-yun.com/v1', models: [
    { label: 'Spark Pro (推荐)', value: 'spark-pro' }, { label: 'Spark Max', value: 'spark-max' }] },
  { label: 'SiliconFlow', color: '#13C2C2', icon: '🆂', base_url: 'https://api.siliconflow.cn/v1', models: [
    { label: 'DeepSeek V4 (推荐)', value: 'deepseek-ai/DeepSeek-V4-Flash' }] },
  { label: 'OpenAI', color: '#52C41A', icon: '🅾', base_url: 'https://api.openai.com/v1', models: [
    { label: 'GPT-4o Mini', value: 'gpt-4o-mini' }, { label: 'GPT-4o', value: 'gpt-4o' }] },
];

// ── 表单数据 ──────────────────────────────────────────

interface FormData {
  name: string; baseUrl: string; apiKey: string; modelName: string;
}

const emptyForm = (): FormData => ({ name: '', baseUrl: '', apiKey: '', modelName: '' });

// ═══════════════════════════════════════════════════════

const LlmSetting: React.FC = () => {
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderWithModels | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm());
  const [selectedVendor, setSelectedVendor] = useState<VendorPreset | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── 加载数据（含旧版迁移） ──
  const loadData = () => {
    // 迁移旧版单配置
    try {
      const oldRaw = localStorage.getItem('edu_ta_llm_config');
      if (oldRaw) {
        const old: any = JSON.parse(oldRaw);
        const existing = getProviders();
        const dup = existing.some(p => p.base_url === old.baseUrl && p.name === old.vendor);
        if (!dup && old.apiKey && old.baseUrl) {
          const m: ProviderWithModels = {
            id: genId(), name: old.vendor || '迁移配置', base_url: old.baseUrl,
            models: [{ id: genId(), name: old.modelName || 'default', api_key: old.apiKey,
              model_name: old.modelName || '', is_default: true,
              test_status: (old.tested ? 'success' : 'untested') as 'success' | 'untested' }],
          };
          saveProvider(m);
          if (!getActiveProviderId()) setActiveProviderId(m.id);
        }
        localStorage.removeItem('edu_ta_llm_config');
      }
    } catch { /* ignore */ }

    setProviders(getProviders());
    setActiveId(getActiveProviderId());
  };

  useEffect(() => { loadData(); }, []);

  // ── 点击厂商预设卡片 → 直接弹出添加弹窗 ──
  const handleVendorClick = (vendor: VendorPreset) => {
    setEditingProvider(null);
    setSelectedVendor(vendor);
    setForm({ name: vendor.label, baseUrl: vendor.base_url, apiKey: '', modelName: vendor.models[0].value });
    setModalOpen(true);
  };

  // ── 自定义按钮 ──
  const handleCustomClick = () => {
    setEditingProvider(null);
    setSelectedVendor(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  // ── 编辑 ──
  const openEdit = (p: ProviderWithModels) => {
    setEditingProvider(p);
    setSelectedVendor(VENDORS.find(v => v.base_url === p.base_url) || null);
    const dm = p.models.find(m => m.is_default) || p.models[0];
    setForm({
      name: p.name, baseUrl: p.base_url,
      apiKey: dm?.api_key || '', modelName: dm?.model_name || '',
    });
    setModalOpen(true);
  };

  // ── 测试连通 ──
  const handleTest = async (pid: string, apiKey: string, baseUrl: string, modelName: string) => {
    if (!apiKey) { message.warning('请先填写 API Key'); return; }
    setTestingId(pid);
    try {
      const res = await fetch(apiUrl('settings/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-LLM-Api-Key': apiKey, 'X-LLM-Base-Url': baseUrl, 'X-LLM-Model-Name': modelName },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      const ok = data.success;
      const all = getProviders();
      const t = all.find(p => p.id === pid);
      if (t) {
        const mdl = t.models.find(m => m.is_default) || t.models[0];
        if (mdl) { mdl.test_status = ok ? 'success' : 'fail'; mdl.test_message = data.message || ''; }
        saveProvider(t);
      }
      message[ok ? 'success' : 'error'](ok ? '连接成功！' : (data.message || '连接失败'));
    } catch (e: any) {
      message.error('网络错误：' + (e.message || ''));
    } finally { setTestingId(null); loadData(); }
  };

  // ── 激活 ──
  const handleActivate = (pid: string) => {
    setActiveProviderId(pid); setActiveId(pid);
    message.success('已切换全局激活供应商'); loadData();
  };

  // ── 删除 ──
  const handleDelete = (pid: string, name: string) => {
    deleteProvider(pid); if (activeId === pid) setActiveId(null);
    message.info(`已删除「${name}」`); loadData();
  };

  // ── 保存（新增或编辑） ──
  const handleSave = async () => {
    if (!form.name.trim()) { message.warning('请填写供应商名称'); return; }
    if (!form.apiKey.trim()) { message.warning('请填写 API Key'); return; }
    if (!form.baseUrl.trim()) { message.warning('请填写接口地址'); return; }
    if (!form.modelName.trim()) { message.warning('请填写模型名称'); return; }
    setSaving(true);

    // 测试连通性
    let testOk = false;
    try {
      const res = await fetch(apiUrl('settings/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-LLM-Api-Key': form.apiKey, 'X-LLM-Base-Url': form.baseUrl, 'X-LLM-Model-Name': form.modelName },
        body: JSON.stringify({}),
      });
      testOk = (await res.json()).success;
    } catch { /* 测试失败也保存 */ }

    const provider: ProviderWithModels = editingProvider
      ? { ...editingProvider, name: form.name.trim(), base_url: form.baseUrl.trim(),
          models: [{ id: editingProvider.models[0]?.id || genId(), name: form.modelName.trim(),
            api_key: form.apiKey.trim(), model_name: form.modelName.trim(), is_default: true,
            test_status: (testOk ? 'success' : 'fail') as 'success' | 'fail' }] }
      : { id: genId(), name: form.name.trim(), base_url: form.baseUrl.trim(),
          models: [{ id: genId(), name: form.modelName.trim(), api_key: form.apiKey.trim(),
            model_name: form.modelName.trim(), is_default: true,
            test_status: (testOk ? 'success' : 'fail') as 'success' | 'fail' }] };

    saveProvider(provider);
    if (!editingProvider && !activeId) { setActiveProviderId(provider.id); setActiveId(provider.id); }

    message.success(editingProvider ? `「${form.name}」已更新` : `「${form.name}」已添加${!activeId ? '并自动激活' : ''}`);
    setModalOpen(false); setSaving(false); loadData();
  };

  // ── 状态 ──
  const llmStatus = getLLMStatus();
  const statusInfo = getStatusInfo(llmStatus);

  const maskKey = (key: string) => key && key.length > 8 ? key.slice(0, 6) + '••••' + key.slice(-4) : '••••••••';

  const getVendorColor = (baseUrl: string) => VENDORS.find(v => v.base_url === baseUrl)?.color || BRAND.colors.primary;

  return (
    <div className="page-enter llm-page" style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 0' }}>
      {/* ── 全局状态卡片 ── */}
      <Card className="brand-card" style={{ marginBottom: 20, borderRadius: 12, background: statusInfo.cardBg, borderColor: statusInfo.cardBorder }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {llmStatus.state === 3
            ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 28 }} />
            : <WarningOutlined style={{ color: '#faad14', fontSize: 28 }} />}
          <div style={{ flex: 1 }}>
            <Tag color={statusInfo.tagColor} style={{ borderRadius: 6, fontSize: 15, fontWeight: 600, padding: '4px 16px', marginBottom: 6 }}>{statusInfo.tagText}</Tag>
            <Text style={{ display: 'block', color: statusInfo.textColor, fontSize: 14 }}>
              {llmStatus.state === 3 && llmStatus.activeModel
                ? `${llmStatus.activeModel.provider.name} · ${llmStatus.activeModel.model.model_name}`
                : llmStatus.providerCount > 0 ? `已配置 ${llmStatus.providerCount} 个供应商，选一个设为激活即可` : '点击下方厂商卡片快速配置'}
            </Text>
          </div>
          <Button icon={<ReloadOutlined />} size="small" onClick={loadData} style={{ borderRadius: 6 }}>刷新</Button>
        </div>
      </Card>

      {/* ── 厂商快捷配置区（始终显示） ── */}
      <Title level={4} style={{ marginBottom: 10 }}>
        <ApiOutlined style={{ color: BRAND.colors.primary, marginRight: 8 }} />
        选择 AI 服务商
      </Title>
      <Text type="secondary" style={{ fontSize: 14, display: 'block', marginBottom: 14 }}>
        点击厂商卡片即可快速配置，支持同时配置多个供应商，随时切换激活
      </Text>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        {VENDORS.map(v => {
          const configured = providers.some(p => p.base_url === v.base_url);
          return (
            <Card
              key={v.label}
              hoverable
              size="small"
              onClick={() => handleVendorClick(v)}
              style={{
                cursor: 'pointer', borderRadius: 12, textAlign: 'center',
                border: configured ? `2px solid ${v.color}` : '1px solid #f0f0f0',
                background: configured ? `${v.color}08` : '#fff',
                transition: 'all 0.2s',
              }}
              bodyStyle={{ padding: '18px 12px' }}
            >
              <div style={{ fontSize: 32, marginBottom: 6 }}>{v.icon}</div>
              <Text strong style={{ fontSize: 15, color: configured ? v.color : '#333', display: 'block' }}>{v.label}</Text>
              <Text style={{ fontSize: 12, color: '#999', display: 'block' }}>{new URL(v.base_url).hostname}</Text>
              {configured ? (
                <Tag color="blue" style={{ borderRadius: 4, fontSize: 12, marginTop: 6 }}>已配置</Tag>
              ) : (
                <Tag style={{ borderRadius: 4, fontSize: 12, marginTop: 6, color: '#999', border: '1px dashed #d9d9d9', background: '#fff' }}>
                  <PlusOutlined style={{ marginRight: 2 }} />点击配置
                </Tag>
              )}
            </Card>
          );
        })}
        {/* 自定义 */}
        <Card
          hoverable size="small" onClick={handleCustomClick}
          style={{
            cursor: 'pointer', borderRadius: 12, textAlign: 'center',
            border: '1px dashed #1890ff', background: '#fafafa',
          }}
          bodyStyle={{ padding: '18px 12px' }}
        >
          <div style={{ fontSize: 32, marginBottom: 6 }}>⚙️</div>
          <Text strong style={{ fontSize: 15, color: '#1890ff', display: 'block' }}>自定义</Text>
          <Text style={{ fontSize: 12, color: '#999', display: 'block' }}>手动输入地址</Text>
          <Tag style={{ borderRadius: 4, fontSize: 12, marginTop: 6, color: '#1890ff', border: '1px dashed #1890ff', background: '#e6f7ff' }}>
            其他兼容 API
          </Tag>
        </Card>
      </div>

      {/* ── 已配置供应商列表 ── */}
      {providers.length > 0 && (
        <>
          <Title level={4} style={{ marginBottom: 10 }}>
            <StarFilled style={{ color: BRAND.colors.primary, marginRight: 8 }} />
            已配置供应商
            <Tag style={{ marginLeft: 8, borderRadius: 6, fontSize: 13 }}>{providers.length}</Tag>
          </Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {providers.map(p => {
              const isActive = p.id === activeId;
              const dm = p.models.find(m => m.is_default) || p.models[0];
              const ts = dm?.test_status;
              const vc = getVendorColor(p.base_url);

              return (
                <Card key={p.id} className="brand-card" style={{
                  borderRadius: 12,
                  border: isActive ? `2px solid ${BRAND.colors.primary}` : '1px solid #f0f0f0',
                  background: isActive ? 'linear-gradient(135deg, #f0f5ff 0%, #e6f0ff 100%)' : '#fff',
                  boxShadow: isActive ? `0 2px 12px ${BRAND.colors.primary}20` : CARD_SPECS.shadow,
                }} bodyStyle={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <Space size={8}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, ${vc}20, ${vc}40)`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                        {VENDORS.find(v => v.base_url === p.base_url)?.icon || '🔧'}
                      </span>
                      <div>
                        <Text strong style={{ fontSize: 16 }}>{p.name}</Text>
                        <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                          {isActive && <Tag color="blue" style={{ borderRadius: 4, fontSize: 12, margin: 0 }}><StarFilled style={{ marginRight: 2 }} />全局激活</Tag>}
                          {ts === 'success' && <Tag color="success" style={{ borderRadius: 4, fontSize: 12, margin: 0 }}><CheckCircleOutlined />已连通</Tag>}
                          {ts === 'fail' && <Tag color="error" style={{ borderRadius: 4, fontSize: 12, margin: 0 }}><CloseCircleOutlined />连接失败</Tag>}
                          {ts === 'untested' && <Tag style={{ borderRadius: 4, fontSize: 12, margin: 0, color: '#999' }}>未测试</Tag>}
                        </div>
                      </div>
                    </Space>
                    <Space size={6}>
                      <Tooltip title="测试连通"><Button size="small" icon={<ExperimentOutlined />} loading={testingId === p.id}
                        onClick={() => handleTest(p.id, dm?.api_key || '', p.base_url, dm?.model_name || '')}
                        style={{ borderRadius: 6, borderColor: '#52c41a', color: '#52c41a' }}>测试</Button></Tooltip>
                      {!isActive ? (
                        <Button size="small" type="primary" icon={<StarOutlined />} onClick={() => handleActivate(p.id)} style={{ borderRadius: 6 }}>激活</Button>
                      ) : (
                        <Button size="small" disabled icon={<StarFilled />} style={{ borderRadius: 6 }}>已激活</Button>
                      )}
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} style={{ borderRadius: 6 }}>编辑</Button>
                      <Popconfirm title={`删除「${p.name}」？`} onConfirm={() => handleDelete(p.id, p.name)} okText="删除" okType="danger">
                        <Button size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} />
                      </Popconfirm>
                    </Space>
                  </div>
                  <div style={{ background: isActive ? 'rgba(255,255,255,0.7)' : '#fafafa', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                      <div><Text type="secondary" style={{ fontSize: 12, display: 'block' }}>接口地址</Text><Text code style={{ fontSize: 12 }}>{p.base_url}</Text></div>
                      <div><Text type="secondary" style={{ fontSize: 12, display: 'block' }}>模型</Text><Text strong style={{ fontSize: 14 }}><CloudServerOutlined style={{ marginRight: 4, color: vc }} />{dm?.model_name || '—'}</Text></div>
                      <div><Text type="secondary" style={{ fontSize: 12, display: 'block' }}>Key</Text><Text code style={{ fontSize: 12 }}><KeyOutlined />{maskKey(dm?.api_key || '')}</Text></div>
                      {dm?.test_message && ts === 'fail' && <div><Text type="secondary" style={{ fontSize: 12, display: 'block' }}>失败原因</Text><Text type="danger" style={{ fontSize: 12 }}>{dm.test_message}</Text></div>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* ── 新增/编辑弹窗 ── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: BRAND.colors.primary }} />{editingProvider ? `编辑「${editingProvider.name}」` : '配置供应商'}</Space>}
        open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave}
        okText={editingProvider ? '保存修改' : '添加并测试'} confirmLoading={saving} width={520} destroyOnClose
      >
        {/* 配置表单 */}
        <div style={{ background: '#fafafa', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <Input style={{ flex: '0 0 140px', borderRadius: 8 }} placeholder="供应商名称"
              prefix={<GlobalOutlined />} value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} />
            <Input style={{ flex: 1, borderRadius: 8, fontFamily: 'monospace', fontSize: 11 }} placeholder="接口地址"
              prefix={<LinkOutlined />} value={form.baseUrl}
              onChange={e => setForm({ ...form, baseUrl: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Input.Password style={{ flex: 1, borderRadius: 8 }} placeholder="API Key（sk-...）"
              prefix={<KeyOutlined />} value={form.apiKey}
              onChange={e => setForm({ ...form, apiKey: e.target.value })} />
            <div style={{ flex: '0 0 210px' }}>
              {selectedVendor && !editingProvider ? (
                <select value={form.modelName} onChange={e => setForm({ ...form, modelName: e.target.value })}
                  style={{ width: '100%', height: 32, borderRadius: 8, border: '1px solid #d9d9d9', padding: '0 8px', fontSize: 11, fontFamily: 'monospace', background: '#fff', cursor: 'pointer' }}>
                  {selectedVendor.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              ) : (
                <Input style={{ borderRadius: 8, fontFamily: 'monospace', fontSize: 11 }} placeholder="模型名称"
                  prefix={<CloudServerOutlined />} value={form.modelName}
                  onChange={e => setForm({ ...form, modelName: e.target.value })} />
              )}
            </div>
          </div>
        </div>
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          保存时自动测试连通性，Key 仅存储在浏览器本地
        </Text>
      </Modal>

      {/* ── 安全提示 ── */}
      <div style={{ marginTop: 24, padding: '14px 20px', borderRadius: 8, background: '#FFFBE6', border: '1px solid #FFE58F', display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: '#AD8B00' }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>🔒</span>
        <span><b>密钥安全说明：</b>所有 API Key 仅存储在浏览器本地（localStorage），不会上传至服务器。每台电脑、每个浏览器需各自独立配置。支持同时配置多个供应商，随时切换全局激活。</span>
      </div>
    </div>
  );
};

export default LlmSetting;
