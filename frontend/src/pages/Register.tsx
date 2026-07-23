/**
 * 助教注册页面
 *
 * 居中卡片布局 · 与登录页视觉完全统一
 * 平台使用协议弹窗组件 + 表单校验
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Form, Input, Button, Checkbox, Select, Typography, message, Space, Modal,
} from 'antd';
import {
  UserOutlined, LockOutlined, RobotOutlined, EyeInvisibleOutlined,
  EyeTwoTone, ReloadOutlined, IdcardOutlined, BookOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';

const { Title, Text, Paragraph } = Typography;

// ── 验证码组件 ─────────────────────────────────────────

const Captcha: React.FC<{ value: string; onRefresh: () => void }> = ({ value, onRefresh }) => {
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
      ctx.strokeStyle = `rgba(24, 144, 255, ${0.1 + Math.random() * 0.2})`;
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
      style={{ borderRadius: 6, cursor: 'pointer', border: '1px solid #d9d9d9', display: 'block' }}
      onClick={onRefresh} title="点击刷新验证码"
    />
  );
};

const generateCaptcha = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 4; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
};

// ── 课程选项 ───────────────────────────────────────────

const COURSE_OPTIONS = [
  { value: '离散数学', label: '离散数学' }, { value: '数据结构', label: '数据结构' },
  { value: '数据库原理', label: '数据库原理' }, { value: '操作系统', label: '操作系统' },
  { value: '软件工程', label: '软件工程' }, { value: '计算机网络', label: '计算机网络' },
  { value: '计算机组成原理', label: '计算机组成原理' }, { value: '算法设计与分析', label: '算法设计与分析' },
  { value: '人工智能导论', label: '人工智能导论' }, { value: '大学物理', label: '大学物理' },
  { value: '高等数学', label: '高等数学' }, { value: '线性代数', label: '线性代数' },
];

// ── 平台使用协议全文 ─────────────────────────────────────

const AGREEMENT_TEXT = `
# Edu-TA智教星平台用户使用协议

## 一、服务说明
1. 本平台为面向高校计算机专业授课教师、助教的AI智能教学辅助系统，提供作业AI批改、学情分析、智能答疑、题库生成、教学台账管理等教学工具服务。
2. 用户仅可用于校内正常教学工作，禁止商用、批量爬虫、恶意调用大模型接口、违规数据导出等行为。

## 二、用户账号规范
1. 用户注册需填写真实姓名、授课对应课程，账号仅限本人教学使用，禁止转借、共享账号给第三方。
2. 用户妥善保管登录密码，因密码泄露产生的数据泄露、违规操作责任由账号持有人自行承担。
3. 同一用户仅允许注册单个助教账号，重复注册平台有权限制登录权限。

## 三、数据隐私说明
1. 平台仅存储教学相关数据：学生作业、成绩、课程资料、教师配置的LLM API密钥；API密钥仅本地浏览器缓存，平台后端不收集、不存储用户大模型密钥。
2. 学生作业、成绩等教学数据仅用于当前教师教学分析，不会对外泄露、售卖学生个人信息，符合校园数据隐私管理规范。
3. 用户可随时在【教学台账中心】导出、删除本人全部教学数据。

## 四、AI接口使用规范
1. 用户自行配置第三方大模型API（DeepSeek、GLM、通义千问等），平台仅做转发调用，第三方模型服务稳定性、计费由对应厂商负责，本平台不承担API费用与接口故障责任。
2. 禁止通过本平台上传涉政、暴力、色情、侵权类作业/文本素材，违规内容系统可自动拦截并限制账号使用。

## 五、版权与责任
1. 平台自动生成的习题、学情分析报告版权归授课教师所有，仅供校内教学使用。
2. 因用户违规使用、上传侵权内容、恶意调用接口造成的法律责任，由用户独立承担，平台有权封禁违规账号。

## 六、协议更新
平台会不定期更新本使用协议，更新后首次登录会弹窗提示重新阅读，持续使用代表同意最新协议条款。
`;

// ── 协议弹窗组件 ───────────────────────────────────────

interface AgreementModalProps {
  open: boolean;
  onClose: () => void;
  onAgree: () => void;
}

const AgreementModal: React.FC<AgreementModalProps> = ({ open, onClose, onAgree }) => {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      closable
      closeIcon={<CloseOutlined style={{ color: '#999', fontSize: 16 }} />}
      maskClosable
      destroyOnClose
      centered
      bodyStyle={{ padding: 0 }}
    >
      <div style={{ maxHeight: 750, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* 滚动内容区 */}
        <div style={{
          padding: '32px 36px 20px',
          overflowY: 'auto',
          maxHeight: 600,
          lineHeight: 1.8,
          fontSize: 14,
          color: '#333',
        }}>
          <Title level={4} style={{ textAlign: 'center', marginBottom: 20, color: '#1A1A2E', fontWeight: 700 }}>
            Edu-TA智教星平台用户使用协议
          </Title>

          {AGREEMENT_TEXT.split('\n').map((line, i) => {
            // 标题行：## 开头
            if (line.startsWith('## ')) {
              return (
                <Title key={i} level={5} style={{ marginTop: 20, marginBottom: 8, color: '#0F52BA', fontWeight: 600 }}>
                  {line.replace('## ', '')}
                </Title>
              );
            }
            // 数字编号行：1. 2. 开头
            if (/^\d+\.\s/.test(line)) {
              return (
                <Paragraph key={i} style={{ marginBottom: 6, paddingLeft: 12, color: '#444', fontSize: 13 }}>
                  {line}
                </Paragraph>
              );
            }
            // 空行
            if (!line.trim()) return <div key={i} style={{ height: 4 }} />;
            // 其他
            return (
              <Paragraph key={i} style={{ marginBottom: 4, color: '#666', fontSize: 13 }}>
                {line}
              </Paragraph>
            );
          })}
        </div>

        {/* 底部固定按钮 */}
        <div style={{
          padding: '16px 36px',
          borderTop: '1px solid #f0f0f0',
          textAlign: 'center',
          flexShrink: 0,
          background: '#fff',
        }}>
          <Button
            type="primary"
            size="large"
            onClick={onAgree}
            style={{
              height: 44,
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              padding: '0 40px',
              background: 'linear-gradient(135deg, #0F52BA, #7B61FF)',
              border: 'none',
              boxShadow: '0 4px 14px rgba(15, 82, 186, 0.3)',
            }}
          >
            ✓ 我已阅读并同意
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ── 注册页面 ───────────────────────────────────────────

const Register: React.FC = () => {
  const navigate = useNavigate();
  const { isLoggedIn, register } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [captcha, setCaptcha] = useState(generateCaptcha);
  const [captchaInput, setCaptchaInput] = useState('');

  React.useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, navigate]);
  if (isLoggedIn) return null;

  const refreshCaptcha = useCallback(() => {
    setCaptcha(generateCaptcha());
    setCaptchaInput('');
  }, []);

  const handleRegister = async (values: {
    username: string; name: string; course: string;
    password: string; confirmPassword: string;
  }) => {
    if (captchaInput.toUpperCase() !== captcha) {
      message.warning('验证码错误，请重新输入');
      refreshCaptcha();
      return;
    }
    if (values.password !== values.confirmPassword) {
      message.warning('两次密码输入不一致，请重新填写');
      return;
    }
    if (!agreed) {
      message.warning('请阅读并同意平台使用协议');
      return;
    }

    setLoading(true);
    try {
      const result = await register({
        username: values.username, password: values.password,
        name: values.name, course: values.course,
      });
      if (result.success) {
        message.success(result.message);
        setTimeout(() => navigate('/login', { replace: true }), 500);
      } else {
        message.error(result.message);
      }
    } catch {
      message.error('注册异常，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    const values = form.getFieldsValue();
    if (!values.username || !values.name || !values.course || !values.password || !values.confirmPassword) {
      message.warning('请完善所有必填项');
      return;
    }
    form.submit();
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.bgDecor1} />
      <div style={styles.bgDecor2} />

      <div style={styles.card}>
        <div style={styles.logoSection}>
          <div style={styles.logoIcon}>
            <RobotOutlined style={{ fontSize: 36, color: '#fff' }} />
          </div>
          <Title level={3} style={{ margin: '16px 0 4px', color: '#1a1a1a', fontSize: 22 }}>
            智能助教教学辅助系统
          </Title>
          <Text type="secondary" style={{ fontSize: 14, letterSpacing: 1 }}>
            助教账号注册
          </Text>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleRegister}
          style={{ marginTop: 20 }}
          requiredMark={false}
        >
          <Form.Item name="username" rules={[{ required: true, message: '请设置登录账号' }]}>
            <Input prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="请设置登录账号" size="large"
              style={{ height: 42, borderRadius: 8 }} autoFocus />
          </Form.Item>

          <Form.Item name="name" rules={[{ required: true, message: '请填写真实姓名' }]}>
            <Input prefix={<IdcardOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="请填写真实姓名" size="large"
              style={{ height: 42, borderRadius: 8 }} />
          </Form.Item>

          <Form.Item name="course" rules={[{ required: true, message: '请选择负责课程' }]}>
            <Select placeholder="选择负责课程" size="large"
              style={{ borderRadius: 8, height: 42 }}
              options={COURSE_OPTIONS} />
          </Form.Item>

          <Form.Item name="password" rules={[{ required: true, message: '请设置登录密码' }]}>
            <Input.Password prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="请设置登录密码" size="large"
              style={{ height: 42, borderRadius: 8 }}
              iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)} />
          </Form.Item>

          <Form.Item name="confirmPassword" rules={[{ required: true, message: '请再次输入密码' }]}>
            <Input.Password prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="请再次输入密码" size="large"
              style={{ height: 42, borderRadius: 8 }}
              iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)} />
          </Form.Item>

          {/* 验证码 */}
          <Form.Item label={<Text style={{ fontSize: 13, color: '#666' }}>验证码</Text>}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Input value={captchaInput}
                onChange={e => setCaptchaInput(e.target.value.toUpperCase())}
                maxLength={4} placeholder="输入验证码"
                style={{ width: 130, height: 42, borderRadius: 8, textTransform: 'uppercase' }} />
              <Captcha value={captcha} onRefresh={refreshCaptcha} />
              <ReloadOutlined onClick={refreshCaptcha}
                style={{ fontSize: 16, color: '#1890ff', cursor: 'pointer' }} title="刷新验证码" />
            </div>
          </Form.Item>

          {/* 协议勾选 */}
          <div style={{ marginBottom: 16 }}>
            <Checkbox
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              style={{ fontSize: 13, color: '#666' }}
            >
              已阅读并同意
              <Text
                style={{ color: '#0F52BA', cursor: 'pointer', marginLeft: 2 }}
                onClick={e => { e.stopPropagation(); setAgreementOpen(true); }}
              >
                平台使用协议
              </Text>
            </Checkbox>
          </div>

          {/* 注册按钮 */}
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary" size="large" block
              loading={loading}
              disabled={!agreed}
              onClick={handleSubmit}
              style={{
                height: 46, borderRadius: 8, fontSize: 16, fontWeight: 500,
                background: 'linear-gradient(135deg, #0F52BA 0%, #7B61FF 100%)',
                border: 'none',
                boxShadow: '0 4px 12px rgba(15, 82, 186, 0.35)',
                opacity: agreed ? 1 : 0.5,
              }}
            >
              {loading ? '注册中...' : '立  即  注  册'}
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Text style={{ color: '#999', fontSize: 13 }}>
            已有账号？
            <Link to="/login" style={{ color: '#0F52BA', marginLeft: 4 }}>去登录</Link>
          </Text>
        </div>
      </div>

      <div style={styles.footer}>
        <Text style={{ color: 'rgba(0,0,0,0.3)', fontSize: 12 }}>
          某某高校 智慧教学平台 &copy; 2026 版权所有
        </Text>
      </div>

      {/* 协议弹窗 */}
      <AgreementModal
        open={agreementOpen}
        onClose={() => setAgreementOpen(false)}
        onAgree={() => { setAgreed(true); setAgreementOpen(false); }}
      />
    </div>
  );
};

// ── 样式 ────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 50%, #f5f0ff 100%)',
    position: 'relative', overflow: 'hidden',
  },
  bgDecor1: {
    position: 'absolute', width: 400, height: 400, borderRadius: '50%',
    background: 'rgba(15,82,186,0.06)', top: -100, right: -80, pointerEvents: 'none',
  },
  bgDecor2: {
    position: 'absolute', width: 300, height: 300, borderRadius: '50%',
    background: 'rgba(123,97,255,0.05)', bottom: -60, left: -60, pointerEvents: 'none',
  },
  card: {
    width: 440, background: '#fff', borderRadius: 16,
    padding: '40px 40px 32px',
    boxShadow: '0 8px 40px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
    position: 'relative', zIndex: 1,
  },
  logoSection: { textAlign: 'center' },
  logoIcon: {
    width: 64, height: 64, borderRadius: 16,
    background: 'linear-gradient(135deg, #0F52BA 0%, #7B61FF 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    margin: '0 auto', boxShadow: '0 4px 14px rgba(15,82,186,0.3)',
  },
  footer: { position: 'absolute', bottom: 24, textAlign: 'center', width: '100%' },
};

export default Register;
