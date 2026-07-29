/**
 * 助教注册页面 —— 高校智能助教教学辅助系统
 *
 * 与登录页视觉完全统一：左右插画 + 中间毛玻璃表单卡片
 * 平台使用协议弹窗组件 + 表单校验
 */

import React, { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Form, Input, Button, Checkbox, Select, Typography, message, Modal,
} from 'antd';
import {
  UserOutlined, LockOutlined, EyeInvisibleOutlined,
  EyeTwoTone, ReloadOutlined, IdcardOutlined, BookOutlined, CloseOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import {
  RobotIcon, Captcha, generateCaptcha, LeftIllustration, RightIllustration,
} from '../components/AuthIllustrations';

const { Title, Text, Paragraph } = Typography;

// ── 课程选项 ───────────────────────────────────────────

const COURSE_OPTIONS = [
  { value:'离散数学', label:'离散数学' }, { value:'数据结构', label:'数据结构' },
  { value:'数据库原理', label:'数据库原理' }, { value:'操作系统', label:'操作系统' },
  { value:'软件工程', label:'软件工程' }, { value:'计算机网络', label:'计算机网络' },
  { value:'计算机组成原理', label:'计算机组成原理' }, { value:'算法设计与分析', label:'算法设计与分析' },
  { value:'人工智能导论', label:'人工智能导论' }, { value:'数据挖掘', label:'数据挖掘' },
  { value:'AI智能体', label:'AI智能体' }, { value:'大学物理', label:'大学物理' },
  { value:'高等数学', label:'高等数学' }, { value:'线性代数', label:'线性代数' },
];

// ── 协议文本 ────────────────────────────────────────────

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

// ── 协议弹窗 ────────────────────────────────────────────

const AgreementModal: React.FC<{ open:boolean; onClose:()=>void; onAgree:()=>void }> = ({ open,onClose,onAgree }) => (
  <Modal open={open} onCancel={onClose} footer={null} width={680}
    closable closeIcon={<CloseOutlined style={{ color:'#999', fontSize:16 }} />}
    maskClosable destroyOnClose centered styles={{ body:{ padding:0 } }}>
    <div style={{ maxHeight:750, overflow:'hidden', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'32px 36px 20px', overflowY:'auto', maxHeight:600, lineHeight:1.8, fontSize:14, color:'#333' }}>
        <Title level={4} style={{ textAlign:'center', marginBottom:20, color:'#1A1A2E', fontWeight:700 }}>
          Edu-TA智教星平台用户使用协议
        </Title>
        {AGREEMENT_TEXT.split('\n').map((line,i) => {
          if (line.startsWith('## ')) return <Title key={i} level={5} style={{ marginTop:20, marginBottom:8, color:'#0F52BA', fontWeight:600 }}>{line.replace('## ','')}</Title>;
          if (/^\d+\.\s/.test(line)) return <Paragraph key={i} style={{ marginBottom:6, paddingLeft:12, color:'#444', fontSize:13 }}>{line}</Paragraph>;
          if (!line.trim()) return <div key={i} style={{ height:4 }} />;
          return <Paragraph key={i} style={{ marginBottom:4, color:'#666', fontSize:13 }}>{line}</Paragraph>;
        })}
      </div>
      <div style={{ padding:'16px 36px', borderTop:'1px solid #f0f0f0', textAlign:'center', flexShrink:0, background:'#fff' }}>
        <Button type="primary" size="large" onClick={onAgree}
          style={{ height:44, borderRadius:10, fontSize:15, fontWeight:600, padding:'0 40px',
            background:'linear-gradient(135deg,#3B6FF5,#7C5CFC)', border:'none',
            boxShadow:'0 4px 14px rgba(59,111,245,0.3)' }}>
          ✓ 我已阅读并同意
        </Button>
      </div>
    </div>
  </Modal>
);

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

  React.useEffect(() => { if (isLoggedIn) navigate('/', { replace:true }); }, [isLoggedIn, navigate]);
  if (isLoggedIn) return null;

  const refreshCaptcha = useCallback(() => { setCaptcha(generateCaptcha()); setCaptchaInput(''); }, []);

  const handleRegister = async (values: {
    username:string; name:string; course:string; password:string; confirmPassword:string;
  }) => {
    if (captchaInput.toUpperCase() !== captcha) { message.warning('验证码错误'); refreshCaptcha(); return; }
    if (values.password !== values.confirmPassword) { message.warning('两次密码输入不一致'); return; }
    if (!agreed) { message.warning('请阅读并同意平台使用协议'); return; }
    setLoading(true);
    try {
      const result = await register({
        username:values.username, password:values.password, name:values.name, course:values.course,
      });
      if (result.success) { message.success(result.message); setTimeout(() => navigate('/login',{ replace:true }),500); }
      else { message.error(result.message); }
    } catch { message.error('注册异常，请稍后重试'); }
    finally { setLoading(false); }
  };

  const handleSubmit = async () => {
    try {
      await form.validateFields();
      form.submit();
    } catch {
      // validateFields 会自动在各字段下方显示错误提示，无需额外处理
    }
  };

  return (
    <>
      <style>{`
        @keyframes floatBlob1 { 0%,100% { transform:translate(0,0) scale(1); } 25% { transform:translate(30px,-40px) scale(1.08); } 50% { transform:translate(-10px,-20px) scale(0.95); } 75% { transform:translate(-25px,15px) scale(1.05); } }
        @keyframes floatBlob2 { 0%,100% { transform:translate(0,0) scale(1); } 33% { transform:translate(-40px,-25px) scale(1.1); } 66% { transform:translate(20px,30px) scale(0.93); } }
        @keyframes floatBlob3 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(35px,25px) scale(1.06); } }
        @keyframes floatBlob4 { 0%,100% { transform:translate(0,0) scale(1) rotate(0deg); } 33% { transform:translate(-20px,-35px) scale(1.12) rotate(5deg); } 66% { transform:translate(15px,20px) scale(0.9) rotate(-3deg); } }
        @keyframes cardFadeIn { 0% { opacity:0; transform:translateY(30px) scale(0.96); } 100% { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes illFadeIn { 0% { opacity:0; transform:scale(0.9); } 100% { opacity:1; transform:scale(1); } }

        .reg-input-wrap .ant-input-affix-wrapper, .reg-select-wrap .ant-select-selector {
          border-radius:12px !important; border:1px solid rgba(0,0,0,0.08) !important;
          transition:all 0.35s cubic-bezier(0.4,0,0.2,1) !important;
          background:rgba(248,250,255,0.6) !important; box-shadow:none !important;
        }
        .reg-input-wrap .ant-input-affix-wrapper:hover, .reg-select-wrap .ant-select-selector:hover {
          border-color:rgba(59,111,245,0.25) !important; background:rgba(248,250,255,0.9) !important;
        }
        .reg-input-wrap .ant-input-affix-wrapper:focus-within,
        .reg-input-wrap .ant-input-affix-wrapper.ant-input-affix-wrapper-focused {
          border-color:transparent !important; background:#fff !important;
          box-shadow:0 0 0 2px rgba(59,111,245,0.25),0 0 18px rgba(139,92,246,0.18),0 2px 8px rgba(59,111,245,0.08) !important;
        }
        .reg-select-wrap .ant-select-selector { height:48px !important; display:flex; align-items:center; }
        .reg-select-wrap .ant-select-focused .ant-select-selector {
          border-color:transparent !important; background:#fff !important;
          box-shadow:0 0 0 2px rgba(59,111,245,0.25),0 0 18px rgba(139,92,246,0.18),0 2px 8px rgba(59,111,245,0.08) !important;
        }
        .reg-input-wrap .ant-input { font-size:14px !important; }
        .reg-input-wrap .ant-input::placeholder { color:#b8bcc8 !important; font-weight:300 !important; }
        .reg-input-wrap .ant-input-prefix { margin-right:10px !important; }

        .register-checkbox .ant-checkbox-inner { border-radius:5px !important; border-color:rgba(0,0,0,0.15) !important; transition:all 0.3s !important; }
        .register-checkbox .ant-checkbox-checked .ant-checkbox-inner { background:linear-gradient(135deg,#3B6FF5,#7C5CFC) !important; border-color:transparent !important; box-shadow:0 2px 6px rgba(59,111,245,0.25) !important; }
        .register-checkbox .ant-checkbox:hover .ant-checkbox-inner { border-color:#3B6FF5 !important; }

        .captcha-input .ant-input-affix-wrapper { border-radius:10px !important; border:1px solid rgba(0,0,0,0.08) !important; }
        .captcha-input .ant-input-affix-wrapper:focus-within { border-color:transparent !important; box-shadow:0 0 0 2px rgba(59,111,245,0.2) !important; }

        .register-form .ant-form-item { margin-bottom:16px !important; }
        .register-form .ant-form-item-explain-error { font-size:12px !important; padding-left:4px !important; }
      `}</style>

      <div style={s.wrapper}>
        {/* 背景光斑 */}
        <div style={s.blob1} /><div style={s.blob2} /><div style={s.blob3} />
        <div style={s.blob4} /><div style={s.blob5} /><div style={s.blob6} />

        {/* ── 三栏主布局 ── */}
        <div style={s.mainLayout}>
          {/* 左侧插画 */}
          <div style={s.leftPanel}>
            <div style={s.illWrap}><LeftIllustration /></div>
          </div>

          {/* 中间注册卡片 */}
          <div style={s.card}>
            <div style={s.cardGlow} />

            <div style={s.logoSection}>
              <div style={s.logoWrap}><RobotIcon size={56} /></div>
              <Title level={2} style={s.systemTitle}>智能助教教学辅助系统</Title>
              <Text style={s.subtitle}>助教账号注册</Text>
            </div>

            <Form form={form} layout="vertical" onFinish={handleRegister}
              className="register-form" style={{ marginTop:24 }} requiredMark={false}>
              {/* 登录账号 */}
              <Form.Item name="username" rules={[{ required:true, message:'请设置登录账号' }]}>
                <div className="reg-input-wrap">
                  <Input prefix={<UserOutlined style={{ color:'#a0a8c0', fontSize:15 }} />}
                    placeholder="请设置登录账号" size="large"
                    style={{ height:48 }} autoFocus />
                </div>
              </Form.Item>

              {/* 真实姓名 */}
              <Form.Item name="name" rules={[{ required:true, message:'请填写真实姓名' }]}>
                <div className="reg-input-wrap">
                  <Input prefix={<IdcardOutlined style={{ color:'#a0a8c0', fontSize:15 }} />}
                    placeholder="请填写真实姓名" size="large" style={{ height:48 }} />
                </div>
              </Form.Item>

              {/* 负责课程 */}
              <Form.Item name="course" rules={[{ required:true, message:'请选择负责课程' }]}>
                <Select className="reg-select-wrap" placeholder="请选择负责课程" size="large"
                  options={COURSE_OPTIONS} popupMatchSelectWidth={false} />
              </Form.Item>

              {/* 登录密码 */}
              <Form.Item name="password" rules={[{ required:true, message:'请设置登录密码' }]}>
                <div className="reg-input-wrap">
                  <Input.Password prefix={<LockOutlined style={{ color:'#a0a8c0', fontSize:15 }} />}
                    placeholder="请设置登录密码" size="large" style={{ height:48 }}
                    iconRender={v => v ? <EyeTwoTone twoToneColor="#7C5CFC" /> : <EyeInvisibleOutlined style={{ color:'#a0a8c0' }} />} />
                </div>
              </Form.Item>

              {/* 确认密码 */}
              <Form.Item name="confirmPassword" rules={[{ required:true, message:'请再次输入密码' }]}>
                <div className="reg-input-wrap">
                  <Input.Password prefix={<LockOutlined style={{ color:'#a0a8c0', fontSize:15 }} />}
                    placeholder="请再次输入密码" size="large" style={{ height:48 }}
                    iconRender={v => v ? <EyeTwoTone twoToneColor="#7C5CFC" /> : <EyeInvisibleOutlined style={{ color:'#a0a8c0' }} />} />
                </div>
              </Form.Item>

              {/* 验证码 */}
              <Form.Item label={<Text style={{ fontSize:13, color:'#888', fontWeight:400 }}>验证码</Text>}>
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

              {/* 协议勾选 */}
              <div style={{ marginBottom:20 }}>
                <Checkbox checked={agreed} onChange={e => setAgreed(e.target.checked)}
                  className="register-checkbox" style={{ fontSize:13, color:'#888' }}>
                  已阅读并同意
                  <Text style={{ color:'#3B6FF5', cursor:'pointer', marginLeft:2 }}
                    onClick={e => { e.stopPropagation(); setAgreementOpen(true); }}>
                    平台使用协议
                  </Text>
                </Checkbox>
              </div>

              {/* 注册按钮 */}
              <Form.Item style={{ marginBottom:0 }}>
                <Button type="primary" size="large" block
                  loading={loading} disabled={!agreed}
                  onClick={handleSubmit}
                  style={{
                    height:50, borderRadius:14, fontSize:17, fontWeight:600, letterSpacing:4,
                    background:agreed?'linear-gradient(135deg,#3B6FF5 0%,#7C5CFC 50%,#9B6FF5 100%)':'#e0e0e0',
                    border:'none', color:agreed?'#fff':'#aaa',
                    boxShadow:agreed?'0 6px 24px rgba(59,111,245,0.35),0 2px 8px rgba(139,92,246,0.2)':'none',
                    transition:'all 0.35s cubic-bezier(0.4,0,0.2,1)',
                  }}
                  onMouseEnter={e => {
                    if (!agreed||loading) return;
                    const b=e.currentTarget;
                    b.style.transform='translateY(-2px)';
                    b.style.boxShadow='0 10px 32px rgba(59,111,245,0.45),0 4px 12px rgba(139,92,246,0.3)';
                    b.style.filter='brightness(1.08)';
                  }}
                  onMouseLeave={e => {
                    const b=e.currentTarget;
                    b.style.transform='translateY(0)';
                    b.style.boxShadow='0 6px 24px rgba(59,111,245,0.35),0 2px 8px rgba(139,92,246,0.2)';
                    b.style.filter='brightness(1)';
                  }}
                >
                  {loading?'注册中...':'立  即  注  册'}
                </Button>
              </Form.Item>
            </Form>

            <div style={s.loginRow}>
              <Text style={{ color:'#aaa', fontSize:13, fontWeight:300 }}>已有账号？</Text>
              <Link to="/login" style={s.loginLink}>去登录</Link>
            </div>
          </div>

          {/* 右侧插画 */}
          <div style={s.rightPanel}>
            <div style={s.illWrap}><RightIllustration /></div>
          </div>
        </div>

        {/* 版权 */}
        <div style={s.footer}>
          <Text style={{ color:'rgba(0,0,0,0.25)', fontSize:12, fontWeight:300, letterSpacing:0.5 }}>
            某某高校智慧教学平台 版权所有 &copy; 2026
          </Text>
        </div>
      </div>

      {/* 协议弹窗 */}
      <AgreementModal open={agreementOpen}
        onClose={() => setAgreementOpen(false)}
        onAgree={() => { setAgreed(true); setAgreementOpen(false); }} />
    </>
  );
};

// ── 样式 ──────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight:'100vh', position:'relative', overflow:'hidden',
    background:'linear-gradient(160deg, #e8f0fe 0%, #eef4ff 20%, #f2f0ff 50%, #fdf2f8 80%, #e8f4fd 100%)',
  },

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

  mainLayout: {
    display:'flex', alignItems:'center', justifyContent:'center',
    minHeight:'100vh', padding:'40px 20px', position:'relative', zIndex:1, gap:0,
  },

  leftPanel: { flex:1, display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:10, minWidth:0 },
  rightPanel: { flex:1, display:'flex', alignItems:'center', justifyContent:'flex-start', paddingLeft:10, minWidth:0 },

  illWrap: { width:'100%', maxWidth:380, maxHeight:560, animation:'illFadeIn 1s cubic-bezier(0.23,1,0.32,1)' },

  card: {
    width:460, flexShrink:0,
    background:'rgba(255,255,255,0.72)',
    backdropFilter:'blur(28px) saturate(180%)',
    WebkitBackdropFilter:'blur(28px) saturate(180%)',
    borderRadius:24, padding:'32px 44px 26px',
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
  logoWrap:{ display:'inline-block', marginBottom:4 },
  systemTitle:{ margin:'0 0 4px', color:'#1a1a2e', fontSize:21, fontWeight:700, letterSpacing:1,
    fontFamily:'"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif' },
  subtitle:{ fontSize:14, color:'#a0a8c0', fontWeight:300, letterSpacing:2, display:'block' },

  loginRow:{ textAlign:'center', marginTop:18, display:'flex', alignItems:'center',
    justifyContent:'center', gap:6 },
  loginLink:{ color:'#3B6FF5', fontSize:13, fontWeight:500, textDecoration:'none' },

  footer:{ position:'absolute', bottom:24, textAlign:'center', width:'100%', zIndex:1 },
};

export default Register;
