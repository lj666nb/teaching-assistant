/**
 * 系统登录页面 —— 高校智能助教教学辅助系统
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
import { Form, Input, Button, Checkbox, Typography, message } from 'antd';
import {
  UserOutlined, LockOutlined, EyeInvisibleOutlined, EyeTwoTone, ReloadOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import {
  RobotIcon, Captcha, generateCaptcha, LeftIllustration, RightIllustration,
} from '../components/AuthIllustrations';

const { Title, Text, Paragraph } = Typography;
const LOCKOUT_SECONDS = 60;

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { isLoggedIn, login } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const [errorCount, setErrorCount] = useState(0);
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  const [captcha, setCaptcha] = useState(generateCaptcha);
  const [captchaInput, setCaptchaInput] = useState('');
  const lockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isLoggedIn) navigate('/', { replace: true });
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    if (lockoutRemaining > 0) {
      lockTimerRef.current = setInterval(() => {
        setLockoutRemaining(prev => {
          if (prev <= 1) { if (lockTimerRef.current) clearInterval(lockTimerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (lockTimerRef.current) clearInterval(lockTimerRef.current); };
  }, [lockoutRemaining]);

  const refreshCaptcha = useCallback(() => {
    setCaptcha(generateCaptcha());
    setCaptchaInput('');
  }, []);

  const recordError = () => {
    const next = errorCount + 1;
    setErrorCount(next);
    if (next >= 3) setShowCaptcha(true);
    if (next >= 5) { setLockoutRemaining(LOCKOUT_SECONDS); message.error(`连续错误次数过多，请 ${LOCKOUT_SECONDS} 秒后再试`); }
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
    if (lockoutRemaining > 0) { message.warning(`账户已锁定，请 ${lockoutRemaining} 秒后再试`); return; }
    if (showCaptcha) {
      if (!captchaInput) { message.warning('请输入验证码'); return; }
      if (captchaInput.toUpperCase() !== captcha) { message.error('验证码错误'); recordError(); return; }
    }
    setLoading(true);
    try {
      const result = await login(values.username, values.password);
      if (result.success) { resetErrors(); message.success('登录成功，欢迎回来'); navigate('/', { replace: true }); }
      else { message.error(result.message); recordError(); }
    } catch { message.error('登录异常，请稍后重试'); recordError(); }
    finally { setLoading(false); }
  };

  const handleSubmit = () => {
    const values = form.getFieldsValue();
    if (!values.username || !values.password) { message.warning('请输入账号和密码'); return; }
    form.submit();
  };

  if (isLoggedIn) return null;

  return (
    <>
      <style>{`
        @keyframes floatBlob1 { 0%,100% { transform:translate(0,0) scale(1); } 25% { transform:translate(30px,-40px) scale(1.08); } 50% { transform:translate(-10px,-20px) scale(0.95); } 75% { transform:translate(-25px,15px) scale(1.05); } }
        @keyframes floatBlob2 { 0%,100% { transform:translate(0,0) scale(1); } 33% { transform:translate(-40px,-25px) scale(1.1); } 66% { transform:translate(20px,30px) scale(0.93); } }
        @keyframes floatBlob3 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(35px,25px) scale(1.06); } }
        @keyframes floatBlob4 { 0%,100% { transform:translate(0,0) scale(1) rotate(0deg); } 33% { transform:translate(-20px,-35px) scale(1.12) rotate(5deg); } 66% { transform:translate(15px,20px) scale(0.9) rotate(-3deg); } }
        @keyframes cardFadeIn { 0% { opacity:0; transform:translateY(30px) scale(0.96); } 100% { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes illFadeIn { 0% { opacity:0; transform:scale(0.9); } 100% { opacity:1; transform:scale(1); } }

        .login-input-wrap .ant-input-affix-wrapper {
          border-radius:12px !important; border:1px solid rgba(0,0,0,0.08) !important;
          transition:all 0.35s cubic-bezier(0.4,0,0.2,1) !important;
          background:rgba(248,250,255,0.6) !important; box-shadow:none !important;
        }
        .login-input-wrap .ant-input-affix-wrapper:hover { border-color:rgba(59,111,245,0.25) !important; background:rgba(248,250,255,0.9) !important; }
        .login-input-wrap .ant-input-affix-wrapper:focus-within,
        .login-input-wrap .ant-input-affix-wrapper.ant-input-affix-wrapper-focused {
          border-color:transparent !important; background:#fff !important;
          box-shadow:0 0 0 2px rgba(59,111,245,0.25),0 0 18px rgba(139,92,246,0.18),0 2px 8px rgba(59,111,245,0.08) !important;
        }
        .login-input-wrap .ant-input { font-size:15px !important; }
        .login-input-wrap .ant-input::placeholder { color:#b8bcc8 !important; font-weight:300 !important; }
        .login-input-wrap .ant-input-prefix { margin-right:10px !important; }

        .login-pwd-wrap .ant-input-affix-wrapper {
          border-radius:12px !important; border:1px solid rgba(0,0,0,0.08) !important;
          transition:all 0.35s cubic-bezier(0.4,0,0.2,1) !important;
          background:rgba(248,250,255,0.6) !important; box-shadow:none !important;
        }
        .login-pwd-wrap .ant-input-affix-wrapper:hover { border-color:rgba(139,92,246,0.25) !important; background:rgba(248,250,255,0.9) !important; }
        .login-pwd-wrap .ant-input-affix-wrapper:focus-within,
        .login-pwd-wrap .ant-input-affix-wrapper.ant-input-affix-wrapper-focused {
          border-color:transparent !important; background:#fff !important;
          box-shadow:0 0 0 2px rgba(139,92,246,0.25),0 0 18px rgba(59,111,245,0.18),0 2px 8px rgba(139,92,246,0.08) !important;
        }
        .login-pwd-wrap .ant-input { font-size:15px !important; }
        .login-pwd-wrap .ant-input::placeholder { color:#b8bcc8 !important; font-weight:300 !important; }
        .login-pwd-wrap .ant-input-prefix { margin-right:10px !important; }

        .login-checkbox .ant-checkbox-inner { border-radius:5px !important; border-color:rgba(0,0,0,0.15) !important; transition:all 0.3s !important; }
        .login-checkbox .ant-checkbox-checked .ant-checkbox-inner { background:linear-gradient(135deg,#3B6FF5,#7C5CFC) !important; border-color:transparent !important; box-shadow:0 2px 6px rgba(59,111,245,0.25) !important; }
        .login-checkbox .ant-checkbox:hover .ant-checkbox-inner { border-color:#3B6FF5 !important; }

        .captcha-input .ant-input-affix-wrapper { border-radius:10px !important; border:1px solid rgba(0,0,0,0.08) !important; }
        .captcha-input .ant-input-affix-wrapper:focus-within { border-color:transparent !important; box-shadow:0 0 0 2px rgba(59,111,245,0.2) !important; }

        .login-form .ant-form-item { margin-bottom:20px !important; }
        .login-form .ant-form-item-explain-error { font-size:12px !important; padding-left:4px !important; }
      `}</style>

      <div style={s.wrapper}>
        {/* 背景光斑 */}
        <div style={s.blob1} /><div style={s.blob2} /><div style={s.blob3} />
        <div style={s.blob4} /><div style={s.blob5} /><div style={s.blob6} />

        {/* ── 三栏主布局 ── */}
        <div style={s.mainLayout}>
          {/* 左侧插画区 */}
          <div style={s.leftPanel}>
            <div style={s.illWrap}>
              <LeftIllustration />
            </div>
          </div>

          {/* 中间登录卡片 */}
          <div style={s.card}>
            <div style={s.cardGlow} />

            {/* 头部 */}
            <div style={s.logoSection}>
              <div style={s.logoWrap}><RobotIcon size={60} /></div>
              <Title level={2} style={s.systemTitle}>智能助教教学辅助系统</Title>
              <Text style={s.subtitle}>智能赋能教学，减负提质增效</Text>
            </div>

            {/* 错误提示 */}
            {errorCount > 0 && errorCount < 5 && (
              <div style={s.errorHint}>
                <Text style={{ fontSize:12, color:'#ff6b6b' }}>
                  账号或密码错误（{errorCount}/5），{!showCaptcha ? `还可尝试 ${5 - errorCount} 次` : '请填写验证码'}
                </Text>
              </div>
            )}

            {/* 锁定提示 */}
            {lockoutRemaining > 0 && (
              <div style={s.lockoutBox}>
                <Text style={{ fontSize:13, color:'#cf1322', fontWeight:600 }}>
                  ⏳ 账户已锁定，请等待 {lockoutRemaining} 秒后重试
                </Text>
              </div>
            )}

            {/* 表单 */}
            <Form form={form} layout="vertical" onFinish={handleLogin}
              className="login-form"
              style={{ marginTop: lockoutRemaining > 0 || errorCount > 0 ? 14 : 28 }}
              requiredMark={false}
            >
              <Form.Item name="username" rules={[{ required:true, message:'请输入助教账号' }]} style={{ marginBottom:20 }}>
                <div className="login-input-wrap">
                  <Input prefix={<UserOutlined style={{ color:'#a0a8c0', fontSize:16 }} />}
                    placeholder="请输入助教账号" size="large"
                    style={{ height:48, fontSize:15 }} autoFocus />
                </div>
              </Form.Item>

              <Form.Item name="password" rules={[{ required:true, message:'请输入登录密码' }]} style={{ marginBottom:20 }}>
                <div className="login-pwd-wrap">
                  <Input.Password
                    prefix={<LockOutlined style={{ color:'#a0a8c0', fontSize:16 }} />}
                    placeholder="请输入登录密码" size="large"
                    style={{ height:48, fontSize:15 }}
                    iconRender={visible => visible
                      ? <EyeTwoTone twoToneColor="#7C5CFC" />
                      : <EyeInvisibleOutlined style={{ color:'#a0a8c0' }} />}
                  />
                </div>
              </Form.Item>

              {/* 验证码 */}
              <div style={{ overflow:'hidden', transition:'all 0.4s cubic-bezier(0.4,0,0.2,1)',
                maxHeight:showCaptcha?90:0, opacity:showCaptcha?1:0, marginBottom:showCaptcha?8:0 }}>
                <Form.Item label={<Text style={{ fontSize:13, color:'#888', fontWeight:400 }}>验证码</Text>}
                  style={{ marginBottom:20 }}>
                  <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                    <div className="captcha-input" style={{ flex:1 }}>
                      <Input value={captchaInput}
                        onChange={e => setCaptchaInput(e.target.value.toUpperCase())}
                        maxLength={4} placeholder="输入验证码"
                        style={{ height:44, borderRadius:10, textTransform:'uppercase' }} />
                    </div>
                    <Captcha value={captcha} onRefresh={refreshCaptcha} />
                    <div onClick={refreshCaptcha} title="刷新验证码"
                      style={{ width:34, height:34, borderRadius:8, background:'rgba(59,111,245,0.06)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        cursor:'pointer', transition:'all 0.3s', flexShrink:0 }}>
                      <ReloadOutlined style={{ fontSize:15, color:'#3B6FF5' }} />
                    </div>
                  </div>
                </Form.Item>
              </div>

              {/* 记住密码 */}
              <div style={s.optionRow}>
                <Checkbox className="login-checkbox" style={{ fontSize:13, color:'#888' }}>记住密码</Checkbox>
                <Text style={s.forgotLink} onClick={() => message.info('请联系管理员重置密码')}>忘记密码？</Text>
              </div>

              {/* 登录按钮 */}
              <Form.Item style={{ marginBottom:0 }}>
                <Button type="primary" size="large" block
                  loading={loading} disabled={lockoutRemaining > 0}
                  onClick={handleSubmit}
                  style={{
                    height:50, borderRadius:14, fontSize:17, fontWeight:600, letterSpacing:4,
                    background:lockoutRemaining>0?'#d9d9d9':'linear-gradient(135deg,#3B6FF5 0%,#7C5CFC 50%,#9B6FF5 100%)',
                    border:'none',
                    boxShadow:lockoutRemaining>0?'none':'0 6px 24px rgba(59,111,245,0.35),0 2px 8px rgba(139,92,246,0.2)',
                    transition:'all 0.35s cubic-bezier(0.4,0,0.2,1)',
                    color:lockoutRemaining>0?'#999':'#fff',
                  }}
                  onMouseEnter={e => {
                    if (lockoutRemaining>0||loading) return;
                    const b = e.currentTarget;
                    b.style.transform='translateY(-2px)';
                    b.style.boxShadow='0 10px 32px rgba(59,111,245,0.45),0 4px 12px rgba(139,92,246,0.3)';
                    b.style.filter='brightness(1.08)';
                  }}
                  onMouseLeave={e => {
                    const b = e.currentTarget;
                    b.style.transform='translateY(0)';
                    b.style.boxShadow='0 6px 24px rgba(59,111,245,0.35),0 2px 8px rgba(139,92,246,0.2)';
                    b.style.filter='brightness(1)';
                  }}
                >
                  {lockoutRemaining>0?`锁定中 ${lockoutRemaining}s`:loading?'登录中...':'登  录'}
                </Button>
              </Form.Item>
            </Form>

            <div style={s.registerRow}>
              <Text style={{ color:'#aaa', fontSize:13, fontWeight:300 }}>还没有账号？</Text>
              <Link to="/register" style={s.registerLink}>立即注册</Link>
            </div>

            <Paragraph style={s.defaultHint}>默认账号：admin / 密码：admin123</Paragraph>
          </div>

          {/* 右侧插画区 */}
          <div style={s.rightPanel}>
            <div style={s.illWrap}>
              <RightIllustration />
            </div>
          </div>
        </div>

        {/* 版权 */}
        <div style={s.footer}>
          <Text style={{ color:'rgba(0,0,0,0.25)', fontSize:12, fontWeight:300, letterSpacing:0.5 }}>
            某某高校智慧教学平台 版权所有 &copy; 2026
          </Text>
        </div>
      </div>
    </>
  );
};

// ── 样式 ──────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight:'100vh', position:'relative', overflow:'hidden',
    background:'linear-gradient(160deg, #e8f0fe 0%, #eef4ff 20%, #f2f0ff 50%, #fdf2f8 80%, #e8f4fd 100%)',
  },

  // 背景光斑（6个）
  blob1:{ position:'absolute', width:520, height:520, borderRadius:'50%',
    background:'radial-gradient(circle at 40% 40%, rgba(59,111,245,0.12), rgba(139,92,246,0.04) 60%, transparent 70%)',
    top:-120, right:-100, filter:'blur(60px)', pointerEvents:'none', animation:'floatBlob1 18s ease-in-out infinite', zIndex:0 },
  blob2:{ position:'absolute', width:380, height:380, borderRadius:'50%',
    background:'radial-gradient(circle at 50% 50%, rgba(139,92,246,0.1), rgba(59,111,245,0.03) 60%, transparent 70%)',
    bottom:-80, left:-60, filter:'blur(50px)', pointerEvents:'none', animation:'floatBlob2 20s ease-in-out infinite', zIndex:0 },
  blob3:{ position:'absolute', width:280, height:280, borderRadius:'50%',
    background:'radial-gradient(circle at 50% 50%, rgba(59,130,246,0.08), rgba(168,85,247,0.04) 60%, transparent 70%)',
    top:'35%', left:'10%', filter:'blur(45px)', pointerEvents:'none', animation:'floatBlob3 15s ease-in-out infinite', zIndex:0 },
  blob4:{ position:'absolute', width:200, height:200, borderRadius:'50%',
    background:'radial-gradient(circle at 50% 50%, rgba(192,132,252,0.1), rgba(59,111,245,0.02) 60%, transparent 70%)',
    top:'20%', right:'15%', filter:'blur(40px)', pointerEvents:'none', animation:'floatBlob4 16s ease-in-out infinite', zIndex:0 },
  blob5:{ position:'absolute', width:160, height:160, borderRadius:'50%',
    background:'radial-gradient(circle at 50% 50%, rgba(59,111,245,0.06), transparent 70%)',
    bottom:'15%', right:'20%', filter:'blur(35px)', pointerEvents:'none', animation:'floatBlob2 14s ease-in-out infinite 2s', zIndex:0 },
  blob6:{ position:'absolute', width:240, height:240, borderRadius:'50%',
    background:'radial-gradient(circle at 50% 50%, rgba(139,92,246,0.07), rgba(168,85,247,0.02) 55%, transparent 70%)',
    top:'55%', left:'50%', filter:'blur(50px)', pointerEvents:'none', animation:'floatBlob3 17s ease-in-out infinite 1s', zIndex:0 },

  // 三栏布局
  mainLayout: {
    display:'flex', alignItems:'center', justifyContent:'center',
    minHeight:'100vh', padding:'40px 20px',
    position:'relative', zIndex:1, gap:0,
  },

  // 左侧插画区
  leftPanel: {
    flex:1, display:'flex', alignItems:'center', justifyContent:'flex-end',
    paddingRight:10, minWidth:0,
  },

  // 右侧插画区
  rightPanel: {
    flex:1, display:'flex', alignItems:'center', justifyContent:'flex-start',
    paddingLeft:10, minWidth:0,
  },

  illWrap: {
    width:'100%', maxWidth:380, maxHeight:560,
    animation:'illFadeIn 1s cubic-bezier(0.23,1,0.32,1)',
  },

  // 毛玻璃卡片
  card: {
    width:440, flexShrink:0,
    background:'rgba(255,255,255,0.72)',
    backdropFilter:'blur(28px) saturate(180%)',
    WebkitBackdropFilter:'blur(28px) saturate(180%)',
    borderRadius:24, padding:'40px 44px 30px',
    boxShadow:'0 8px 48px rgba(59,111,245,0.08),0 2px 12px rgba(0,0,0,0.04),inset 0 1px 0 rgba(255,255,255,0.6)',
    border:'1px solid rgba(255,255,255,0.5)',
    position:'relative', overflow:'hidden',
    animation:'cardFadeIn 0.7s cubic-bezier(0.23,1,0.32,1)',
  },
  cardGlow: {
    position:'absolute', top:0, left:'10%', width:'80%', height:1,
    background:'linear-gradient(90deg,transparent,rgba(139,92,246,0.3),rgba(59,111,245,0.4),rgba(139,92,246,0.3),transparent)',
    pointerEvents:'none', zIndex:2,
  },

  logoSection:{ textAlign:'center', marginBottom:0 },
  logoWrap:{ display:'inline-block', marginBottom:6 },
  systemTitle:{ margin:'0 0 4px', color:'#1a1a2e', fontSize:22, fontWeight:700, letterSpacing:1,
    fontFamily:'"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif' },
  subtitle:{ fontSize:13, color:'#a0a8c0', fontWeight:300, letterSpacing:2, display:'block' },

  errorHint:{ textAlign:'center', marginTop:16, marginBottom:0, padding:'6px 16px',
    background:'rgba(255,77,79,0.04)', borderRadius:8 },
  lockoutBox:{ textAlign:'center', marginTop:16, marginBottom:0, padding:'10px 16px',
    background:'rgba(255,241,240,0.7)', borderRadius:10, border:'1px solid rgba(255,204,199,0.5)' },

  optionRow:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 },
  forgotLink:{ fontSize:13, color:'#3B6FF5', cursor:'pointer', fontWeight:400, userSelect:'none' },

  registerRow:{ textAlign:'center', marginTop:18, display:'flex', alignItems:'center',
    justifyContent:'center', gap:6 },
  registerLink:{ color:'#3B6FF5', fontSize:13, fontWeight:500, textDecoration:'none' },
  defaultHint:{ textAlign:'center', marginTop:12, marginBottom:0, color:'#c0c6d4',
    fontSize:12, fontWeight:300 },

  footer:{ position:'absolute', bottom:24, textAlign:'center', width:'100%', zIndex:1 },
};

export default Login;
