/**
 * 系统登录页面
 *
 * 验证码限流规则：
 * - 初始隐藏验证码
 * - 错误 1-2 次：仅提示，无验证码
 * - 错误 ≥3 次：显示验证码输入框
 * - 错误 5 次：锁定 60 秒
 * - 登录成功 / 刷新页面：计数器清零
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Form, Input, Button, Checkbox, Typography, message, Space,
} from 'antd';
import {
  UserOutlined, LockOutlined, RobotOutlined,
  EyeInvisibleOutlined, EyeTwoTone, ReloadOutlined,
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
      ctx.strokeStyle = `rgba(15, 82, 186, ${0.1 + Math.random() * 0.2})`;
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
      style={{
        borderRadius: 6, cursor: 'pointer', border: '1px solid #d9d9d9', display: 'block',
      }}
      onClick={onRefresh} title="点击刷新验证码"
    />
  );
};

// ── 验证码生成 ─────────────────────────────────────────

const generateCaptcha = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

// ── 锁定倒计时组件 ──────────────────────────────────────

const LOCKOUT_SECONDS = 60;

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { isLoggedIn, login } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // 限流状态（页面刷新即清零）
  const [errorCount, setErrorCount] = useState(0);
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  // 验证码
  const [captcha, setCaptcha] = useState(generateCaptcha);
  const [captchaInput, setCaptchaInput] = useState('');
  const lockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 已登录则跳首页
  useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  // 锁定倒计时
  useEffect(() => {
    if (lockoutRemaining > 0) {
      lockTimerRef.current = setInterval(() => {
        setLockoutRemaining(prev => {
          if (prev <= 1) {
            if (lockTimerRef.current) clearInterval(lockTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (lockTimerRef.current) clearInterval(lockTimerRef.current);
    };
  }, [lockoutRemaining]);

  const refreshCaptcha = useCallback(() => {
    setCaptcha(generateCaptcha());
    setCaptchaInput('');
  }, []);

  const recordError = () => {
    const next = errorCount + 1;
    setErrorCount(next);
    // 错误 ≥3 次展示验证码
    if (next >= 3) setShowCaptcha(true);
    // 错误 ≥5 次锁定
    if (next >= 5) {
      setLockoutRemaining(LOCKOUT_SECONDS);
      message.error(`连续错误次数过多，请 ${LOCKOUT_SECONDS} 秒后再试`);
    }
    refreshCaptcha();
  };

  const resetErrors = () => {
    setErrorCount(0);
    setShowCaptcha(false);
    setCaptchaInput('');
    if (lockTimerRef.current) clearInterval(lockTimerRef.current);
    setLockoutRemaining(0);
  };

  const handleLogin = async (values: { username: string; password: string }) => {
    // 锁定中，阻止提交
    if (lockoutRemaining > 0) {
      message.warning(`账户已锁定，请 ${lockoutRemaining} 秒后再试`);
      return;
    }

    // 需要验证码时校验
    if (showCaptcha) {
      if (!captchaInput) {
        message.warning('请输入验证码');
        return;
      }
      if (captchaInput.toUpperCase() !== captcha) {
        message.error('验证码错误');
        recordError();
        return;
      }
    }

    setLoading(true);
    try {
      const result = await login(values.username, values.password);
      if (result.success) {
        resetErrors();
        message.success('登录成功，欢迎回来');
        navigate('/', { replace: true });
      } else {
        message.error(result.message);
        recordError();
      }
    } catch {
      message.error('登录异常，请稍后重试');
      recordError();
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    const values = form.getFieldsValue();
    if (!values.username || !values.password) {
      message.warning('请输入账号和密码');
      return;
    }
    form.submit();
  };

  // 已登录则跳过渲染（所有 hooks 必须在此之前调用）
  if (isLoggedIn) return null;

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
            智能赋能教学，减负提质增效
          </Text>
        </div>

        {/* 错误次数提示 */}
        {errorCount > 0 && errorCount < 5 && (
          <div style={{ textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
            <Text style={{ fontSize: 12, color: '#ff4d4f' }}>
              账号或密码错误（{errorCount}/5），
              {!showCaptcha ? '还可尝试' + (5 - errorCount) + '次' : '请填写验证码'}
            </Text>
          </div>
        )}

        {/* 锁定提示 */}
        {lockoutRemaining > 0 && (
          <div style={{
            textAlign: 'center', marginTop: 16, marginBottom: 0,
            padding: '8px 12px', background: '#FFF1F0', borderRadius: 8,
            border: '1px solid #FFCCC7',
          }}>
            <Text style={{ fontSize: 13, color: '#cf1322', fontWeight: 600 }}>
              账户已锁定，请等待 {lockoutRemaining} 秒后重试
            </Text>
          </div>
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleLogin}
          style={{ marginTop: lockoutRemaining > 0 || errorCount > 0 ? 12 : 28 }}
          requiredMark={false}
        >
          <Form.Item name="username" rules={[{ required: true, message: '请输入助教账号' }]}>
            <Input
              prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="请输入助教账号" size="large"
              style={{ height: 44, borderRadius: 8 }} autoFocus
            />
          </Form.Item>

          <Form.Item name="password" rules={[{ required: true, message: '请输入登录密码' }]}>
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="请输入登录密码" size="large"
              style={{ height: 44, borderRadius: 8 }}
              iconRender={visible => visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />}
            />
          </Form.Item>

          {/* 验证码区域：错误≥3次才显示，平滑淡入 */}
          <div style={{
            overflow: 'hidden',
            transition: 'all 0.35s ease',
            maxHeight: showCaptcha ? 80 : 0,
            opacity: showCaptcha ? 1 : 0,
            marginBottom: showCaptcha ? 0 : 0,
          }}>
            <Form.Item label={<Text style={{ fontSize: 13, color: '#666' }}>验证码</Text>}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Input
                  value={captchaInput}
                  onChange={e => setCaptchaInput(e.target.value.toUpperCase())}
                  maxLength={4}
                  placeholder="输入验证码"
                  style={{ width: 130, height: 42, borderRadius: 8, textTransform: 'uppercase' }}
                />
                <Captcha value={captcha} onRefresh={refreshCaptcha} />
                <ReloadOutlined
                  onClick={refreshCaptcha}
                  style={{ fontSize: 16, color: '#0F52BA', cursor: 'pointer' }}
                  title="刷新验证码"
                />
              </div>
            </Form.Item>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Checkbox style={{ fontSize: 13, color: '#666' }}>记住密码</Checkbox>
            <Text style={{ fontSize: 13, color: '#0F52BA', cursor: 'pointer' }}
              onClick={() => message.info('请联系管理员重置密码')}>
              忘记密码？
            </Text>
          </div>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary" size="large" block
              loading={loading}
              disabled={lockoutRemaining > 0}
              onClick={handleSubmit}
              style={{
                height: 46, borderRadius: 8, fontSize: 16, fontWeight: 500,
                background: lockoutRemaining > 0
                  ? '#d9d9d9'
                  : 'linear-gradient(135deg, #0F52BA 0%, #7B61FF 100%)',
                border: 'none',
                boxShadow: lockoutRemaining > 0
                  ? 'none'
                  : '0 4px 12px rgba(15, 82, 186, 0.35)',
              }}
            >
              {lockoutRemaining > 0 ? `锁定中 ${lockoutRemaining}s` : loading ? '登录中...' : '登  录'}
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Text style={{ color: '#999', fontSize: 13 }}>
            还没有账号？
            <Link to="/register" style={{ color: '#0F52BA', marginLeft: 4 }}>立即注册</Link>
          </Text>
        </div>

        <Paragraph style={{ textAlign: 'center', marginTop: 12, color: '#bbb', fontSize: 12 }}>
          默认账号：admin / 密码：admin123
        </Paragraph>
      </div>

      <div style={styles.footer}>
        <Text style={{ color: 'rgba(0,0,0,0.3)', fontSize: 12 }}>
          某某高校 智慧教学平台 版权所有 &copy; 2026
        </Text>
      </div>
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
    width: 420, background: '#fff', borderRadius: 16,
    padding: '48px 40px 36px',
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

export default Login;
