/**
 * 系统设置弹窗（精简版 — LLM 配置已移至独立页面 /llm-setting）
 *
 * 仅保留基础系统设置，LLM API 配置请前往左侧「LLM API 配置」栏目
 */

import React from 'react';
import { Modal, Typography, Space, Tag, Button, Divider } from 'antd';
import { SettingOutlined, KeyOutlined, LinkOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getActiveModel } from '../utils/providerStorage';
import { BRAND } from '../utils/brand';

const { Text, Paragraph } = Typography;

interface Props { open: boolean; onClose: () => void; }

const SettingsModal: React.FC<Props> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const active = getActiveModel();

  return (
    <Modal title={<Space><SettingOutlined />系统设置</Space>}
      open={open} onCancel={onClose} footer={null} width={460} destroyOnClose>
      <Paragraph type="secondary" style={{ marginBottom: 16, fontSize: 12 }}>
        系统基础设置 · LLM 模型配置请前往左侧菜单独立页面
      </Paragraph>

      {/* LLM 状态 */}
      <div style={{ background: '#f0f5ff', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Space>
            <KeyOutlined style={{ color: BRAND.colors.primary }} />
            <Text strong style={{ fontSize: 13 }}>LLM API 服务状态</Text>
          </Space>
          {active ? (
            <div>
              <Tag color="success" style={{ borderRadius: 6, fontSize: 11 }}>已配置</Tag>
              <Text style={{ fontSize: 12, marginLeft: 8 }}>
                {active.provider.name} · {active.model.model_name}
              </Text>
            </div>
          ) : (
            <div>
              <Tag color="warning" style={{ borderRadius: 6, fontSize: 11 }}>未配置</Tag>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>AI 功能已锁定</Text>
            </div>
          )}
          <Button type="primary" size="small" icon={<LinkOutlined />} onClick={() => { onClose(); navigate('/llm-setting'); }}
            style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>
            前往 LLM API 配置
          </Button>
        </Space>
      </div>

      <Divider style={{ margin: '8px 0' }} />
      <Text type="secondary" style={{ fontSize: 10, display: 'block', textAlign: 'center' }}>
        Edu-TA 智教星 v2.0 · 密钥仅存储本地浏览器
      </Text>
    </Modal>
  );
};

export default SettingsModal;
