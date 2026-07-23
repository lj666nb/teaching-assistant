/**
 * API Key 守卫 — 全局拦截 AI 生成功能。
 *
 * 三层状态区分：
 * 状态1：空配置（供应商总数=0）→ 全部锁定，提示去新建
 * 状态2：有供应商但无全局激活 → 全部锁定，提示去设置全局激活
 * 状态3：有全局激活且模型连通 → 全部可用
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Typography, Space, Tag, message } from 'antd';
import { WarningOutlined, KeyOutlined, RobotOutlined, SettingOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { getActiveModel, getLLMStatus, LLMStatus } from './providerStorage';

const { Text, Paragraph } = Typography;

// ═══════════════════════════════════════════════════════
// 状态信息
// ═══════════════════════════════════════════════════════

export interface StatusInfo {
  /** 顶部状态栏标签文字 */
  tagText: string;
  /** 顶部状态栏标签颜色 */
  tagColor: string;
  /** 顶部状态栏卡片颜色（浅色） */
  cardBg: string;
  /** 顶部状态栏卡片边框色 */
  cardBorder: string;
  /** 顶部状态栏文字颜色 */
  textColor: string;
  /** 横幅提示文案（空=不显示横幅） */
  bannerMessage: string;
  /** 业务页面警告横幅文案（根据状态不同） */
  pageWarning: string;
  /** 按钮 hover 提示 */
  buttonTitle: string;
}

/** 根据三层状态获取对应文案和样式 */
export function getStatusInfo(status: LLMStatus): StatusInfo {
  if (status.state === 1) {
    return {
      tagText: '未配置，全页面AI功能锁定',
      tagColor: 'orange',
      cardBg: '#FFFBE6',
      cardBorder: '#FFE58F',
      textColor: '#AD8B00',
      bannerMessage: '您尚未添加任何大模型供应商，请前往左侧【LLM API配置】完成服务商与模型添加',
      pageWarning: '您尚未添加任何大模型供应商，请前往左侧【LLM API配置】完成服务商与模型添加',
      buttonTitle: '请先添加大模型供应商以解锁AI功能',
    };
  }
  if (status.state === 2) {
    // 区分：有激活但测试失败 vs 未激活
    const isTestFail = status.hasActive && status.activeModel && status.activeModel.model.test_status === 'fail';
    if (isTestFail) {
      return {
        tagText: `激活模型连接失败，AI功能可能不可用 — 请检查 API Key`,
        tagColor: 'red',
        cardBg: '#FFF2F0',
        cardBorder: '#FFCCC7',
        textColor: '#CF1322',
        bannerMessage: '当前激活的模型连接测试失败，请进入 LLM API 配置页重新测试或更换 API Key',
        pageWarning: '当前激活的模型连接测试失败，请进入 LLM API 配置页重新测试或更换 API Key',
        buttonTitle: '模型连接失败，请检查 API Key 配置',
      };
    }
    return {
      tagText: '已有服务商，未设置全局激活模型，AI功能锁定',
      tagColor: 'orange',
      cardBg: '#FFFBE6',
      cardBorder: '#FFE58F',
      textColor: '#AD8B00',
      bannerMessage: '已检测到本地服务商配置，请进入LLM API配置页，将目标厂商设为全局激活即可解锁AI功能',
      pageWarning: '已检测到本地服务商配置，请进入LLM API配置页，将目标厂商设为全局激活即可解锁AI功能',
      buttonTitle: '请先将目标厂商设为全局激活以解锁AI功能',
    };
  }
  // state === 3 - 已激活
  // 区分是否经过测试验证
  if (status.state === 3 && !status.activeTestOk && !status.activeTested) {
    const activeModel = status.activeModel;
    const providerName = activeModel?.provider?.name || '未知厂商';
    const modelName = activeModel?.model?.model_name || '未知模型';
    return {
      tagText: `当前激活：${providerName} - ${modelName}（未验证连通性）`,
      tagColor: 'blue',
      cardBg: '#F6FFED',
      cardBorder: '#B7EB8F',
      textColor: '#389E0D',
      bannerMessage: '',
      pageWarning: '',
      buttonTitle: '',
    };
  }
  // state === 3
  const activeModel = status.activeModel;
  const providerName = activeModel?.provider?.name || '未知厂商';
  const modelName = activeModel?.model?.model_name || '未知模型';
  return {
    tagText: `当前激活：${providerName} - ${modelName}，全部AI功能正常可用`,
    tagColor: 'blue',
    cardBg: '#F6FFED',
    cardBorder: '#B7EB8F',
    textColor: '#389E0D',
    bannerMessage: '',
    pageWarning: '',
    buttonTitle: '',
  };
}

/** 是否有可用AI（状态3） */
export function isAIAvailable(): boolean {
  return getLLMStatus().state === 3;
}

/** 检查是否已配置有效的 API Key（旧版兼容） */
export function hasApiKey(): boolean {
  return isAIAvailable();
}

/** 获取当前 API Key 的简略描述（旧版兼容） */
export function getApiKeyHint(): string {
  const status = getLLMStatus();
  if (status.state === 1) return '未配置';
  if (status.state === 2) return '已配置但未激活';
  const active = status.activeModel;
  if (!active) return '未知';
  return `${active.model.model_name} (${active.model.api_key.slice(0, 8)}...)`;
}

// ── 被拦截标志位（确保只弹一次） ──
let _interceptShown = false;

/**
 * 触发 AI 生成前调用此函数。
 * 返回 true 表示可以继续，false 表示被拦截。
 */
export function interceptAIAction(
  showModal: () => void,
): boolean {
  if (isAIAvailable()) return true;
  showModal();
  return false;
}

// ═══════════════════════════════════════════════════════
// 全局 API Key 拦截弹窗
// ═══════════════════════════════════════════════════════

interface ApiKeyGuardProps {
  /** 是否显示弹窗 */
  visible: boolean;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 跳转配置页回调 */
  onGoSettings: () => void;
}

export const ApiKeyGuardModal: React.FC<ApiKeyGuardProps> = ({
  visible,
  onClose,
  onGoSettings,
}) => {
  const status = getLLMStatus();
  const isState1 = status.state === 1;

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width={520}
      closable={false}
      destroyOnClose
      maskClosable={false}
      centered
    >
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        {/* 警告图标 */}
        <div
          style={{
            width: 64, height: 64, borderRadius: '50%',
            background: isState1
              ? 'linear-gradient(135deg, #FF6B6B, #FF9F43)'
              : 'linear-gradient(135deg, #FF9F43, #FFD666)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: isState1
              ? '0 4px 20px rgba(255, 107, 107, 0.3)'
              : '0 4px 20px rgba(255, 159, 67, 0.3)',
          }}
        >
          <WarningOutlined style={{ fontSize: 32, color: '#fff' }} />
        </div>

        <Typography.Title level={4} style={{ marginBottom: 8, color: '#1A1A2E' }}>
          {isState1
            ? '⚠️ 使用 AI 功能必须先配置大模型 API 密钥'
            : '⚙️ 已检测到服务商配置，需设为全局激活'}
        </Typography.Title>

        <Paragraph style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>
          {isState1
            ? '当前未检测到有效的模型 API Key，无法使用 AI 智能功能。'
            : '您已添加供应商但未设置全局激活模型，AI 功能暂时锁定。'}
        </Paragraph>

        <div
          style={{
            background: '#FFF7F0',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
            textAlign: 'left',
            border: '1px solid #FFE4D6',
          }}
        >
          <Text style={{ fontSize: 12, color: '#666' }}>
            {isState1
              ? '系统依托大模型实现精细化教案、分层习题、学情分析等全部 AI 功能，请前往系统设置页配置您的模型密钥，支持 DeepSeek、OpenAI、讯飞星火、通义千问、智谱 AI 等主流厂商。'
              : '请前往 LLM API 配置页的「已配置供应商」Tab，找到目标厂商并点击「设为全局激活」按钮完成操作。'}
          </Text>
        </div>

        <Space size={12}>
          <Button
            type="primary"
            icon={<KeyOutlined />}
            size="large"
            onClick={onGoSettings}
            style={{
              height: 44, borderRadius: 10,
              background: 'linear-gradient(135deg, #0F52BA, #7B61FF)',
              border: 'none',
              boxShadow: '0 4px 14px rgba(15, 82, 186, 0.3)',
              padding: '0 24px',
            }}
          >
            {isState1 ? '立即前往配置 API' : '前往设置全局激活'}
          </Button>
          <Button
            size="large"
            onClick={onClose}
            style={{ height: 44, borderRadius: 10, color: '#999' }}
          >
            稍后再说
          </Button>
        </Space>
      </div>
    </Modal>
  );
};

// ═══════════════════════════════════════════════════════
// 顶部橙色警告横幅（根据状态显示不同文案）
// ═══════════════════════════════════════════════════════

export const ApiKeyBanner: React.FC<{ onGoSettings: () => void }> = ({ onGoSettings }) => {
  const [show, setShow] = useState(true);
  const status = getLLMStatus();
  const info = getStatusInfo(status);

  if (!show || !info.bannerMessage) return null;

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #FFF3E0, #FFE0B2)',
        border: '1px solid #FFB74D',
        borderRadius: 10,
        padding: '12px 18px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      <Space>
        <WarningOutlined style={{ color: '#E65100', fontSize: 18 }} />
        <Text strong style={{ color: '#E65100', fontSize: 13 }}>
          {info.bannerMessage}
        </Text>
        <Tag color="warning" style={{ borderRadius: 8, fontSize: 11 }}>
          {status.state === 1 ? '需配置后解锁' : '需激活后解锁'}
        </Tag>
      </Space>
      <Button
        type="primary"
        size="small"
        icon={<KeyOutlined />}
        onClick={onGoSettings}
        style={{
          borderRadius: 8,
          background: '#E65100',
          border: 'none',
        }}
      >
        {status.state === 1 ? '前往配置 API' : '前往设置激活'}
      </Button>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// 全局顶部状态栏（展示三层状态）
// ═══════════════════════════════════════════════════════

export const GlobalStatusBar: React.FC<{
  style?: React.CSSProperties;
  showRefresh?: boolean;
  onRefresh?: () => void;
}> = ({ style, showRefresh = true, onRefresh }) => {
  const status = getLLMStatus();
  const info = getStatusInfo(status);

  return (
    <div
      style={{
        background: info.cardBg,
        border: `1px solid ${info.cardBorder}`,
        borderRadius: 10,
        padding: '10px 18px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        ...style,
      }}
    >
      <Space>
        {status.state === 3 ? (
          <CheckCircleOutlined style={{ color: info.textColor, fontSize: 18 }} />
        ) : (
          <WarningOutlined style={{ color: info.textColor, fontSize: 18 }} />
        )}
        <Tag color={info.tagColor} style={{ borderRadius: 6, fontSize: 12, height: 28, lineHeight: '26px', padding: '0 12px', fontWeight: 600 }}>
          {info.tagText}
        </Tag>
        <Text style={{ color: info.textColor, fontSize: 12 }}>
          {status.providerCount > 0
            ? `${status.providerCount} 个供应商 · ${status.activeModel ? `激活: ${status.activeModel.provider.name}` : '未激活'}`
            : '暂未配置'}
        </Text>
      </Space>
      <Space size={8}>
        <Button size="small" icon={<SettingOutlined />} onClick={onRefresh}
          style={{ borderRadius: 6, fontSize: 12 }}>
          刷新
        </Button>
      </Space>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// 置灰按钮（带 hover 提示，根据状态分层提示）
// ═══════════════════════════════════════════════════════

interface DisabledAIButtonProps {
  label: string;
  icon?: React.ReactNode;
}

export const DisabledAIButton: React.FC<DisabledAIButtonProps> = ({ label, icon }) => {
  const status = getLLMStatus();
  const info = getStatusInfo(status);

  return (
    <Button
      disabled
      icon={icon}
      style={{
        minWidth: 160, height: 40, borderRadius: 8,
        background: '#f0f0f0', color: '#bbb', border: 'none', cursor: 'not-allowed',
      }}
      title={info.buttonTitle}
    >
      {label}
    </Button>
  );
};

// ═══════════════════════════════════════════════════════
// Hook：统一管理 API Key 守卫状态
// ═══════════════════════════════════════════════════════

export function useApiKeyGuard() {
  const [modalVisible, setModalVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);

  const showGuard = useCallback(() => {
    setModalVisible(true);
  }, []);

  const hideGuard = useCallback(() => {
    setModalVisible(false);
  }, []);

  const goToSettings = useCallback(() => {
    setModalVisible(false);
    setSettingsVisible(true);
  }, []);

  return {
    /** 是否有可用 Key（状态3） */
    hasKey: isAIAvailable(),
    /** 显示拦截弹窗 */
    showGuard,
    /** 拦截弹窗 visible */
    modalVisible,
    /** 关闭弹窗 */
    hideGuard,
    /** 跳转配置 */
    goToSettings,
    /** 是否显示设置弹窗（外部控制） */
    settingsVisible,
    setSettingsVisible,
  };
}
