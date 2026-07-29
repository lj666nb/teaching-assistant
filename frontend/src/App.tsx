import React, { useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  Layout,
  Menu,
  Typography,
  theme,
  Tooltip,
  Avatar,
  Dropdown,
  Space,
  Button,
  Spin,
} from 'antd';
import {
  DashboardOutlined,
  FileSearchOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  SettingOutlined,
  RobotOutlined,
  BellOutlined,
  UserOutlined,
  BookOutlined,
  QuestionCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReadOutlined,
  NotificationOutlined,
  FolderOutlined,
  FileTextOutlined,
  LogoutOutlined,
  KeyOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  MessageOutlined,
  FormOutlined,
} from '@ant-design/icons';
import { BRAND } from './utils/brand';
import './styles/brand.css';

import { useAuth } from './context/AuthContext';
import { DataVisibilityProvider, useDataVisibility } from './context/DataVisibilityContext';
import { getLLMStatus } from './utils/providerStorage';
import { GlobalStatusBar, getStatusInfo } from './utils/apiKeyGuard';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import LessonPlanning from './pages/LessonPlanning';
import HomeworkGrading from './pages/HomeworkGrading';
import StudentInsight from './pages/StudentInsight';
import CourseManagement from './pages/CourseManagement';
import NotificationCenter from './pages/NotificationCenter';
import ResourceCenter from './pages/ResourceCenter';
import LlmSetting from './pages/LlmSetting';
import MaterialCenter from './pages/MaterialCenter';
import AgentWorkflow from './pages/AgentWorkflow';
import MessagingCenter from './pages/MessagingCenter';
import AssignmentPublish from './pages/AssignmentPublish';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const SIDEBAR_WIDTH = 200;
const SIDEBAR_COLLAPSED = 64;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '智能工作台' },
  { key: '/assignments', icon: <FormOutlined />, label: '布置作业' },
  { key: '/homework', icon: <FileSearchOutlined />, label: '作业智能辅批' },
  { key: '/materials', icon: <FileTextOutlined />, label: '资料与题库' },
  { key: '/resources', icon: <FolderOutlined />, label: '资源中心' },
  { key: '/insight', icon: <BarChartOutlined />, label: '班级学情分析' },
  { key: '/courses', icon: <ReadOutlined />, label: '课程管理' },
  { key: '/lesson', icon: <DatabaseOutlined />, label: '教学台账中心' },
  { key: '/agent', icon: <RobotOutlined />, label: 'Agent 编排工作台' },
  { key: '/messaging', icon: <MessageOutlined />, label: '师生通信' },
  { key: '/notifications', icon: <NotificationOutlined />, label: '消息通知' },
  { key: '/llm-setting', icon: <KeyOutlined />, label: 'LLM API 配置' },
];

// ── 路由守卫 ───────────────────────────────────────────

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

// ── 主布局（已登录） ────────────────────────────────────

const MainLayoutInner: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { username, logout } = useAuth();
  const { visible, toggleVisibility } = useDataVisibility();
  const [collapsed, setCollapsed] = useState(false);
  const [routeKey, setRouteKey] = useState(0);
  const { token } = theme.useToken();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 深色侧栏导航 */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        style={{
          background: '#0A1428',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          boxShadow: '2px 0 16px rgba(15,82,186,0.15)',
        }}
        width={SIDEBAR_WIDTH}
        collapsedWidth={SIDEBAR_COLLAPSED}
      >
        {/* ── 品牌 Logo 区域 ── */}
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: 'linear-gradient(135deg, #0A1E4A 0%, #0F52BA 100%)',
            padding: collapsed ? 0 : '0 14px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* 品牌 Logo SVG */}
          <span
            dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }}
            style={{
              width: 34, height: 34, display: 'inline-flex', flexShrink: 0,
              animation: 'logoPulse 0.8s ease-out, logoGlow 3s ease-in-out infinite',
            }}
          />
          {!collapsed && (
            <div style={{ marginLeft: 10, lineHeight: 1.3, overflow: 'hidden' }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: 700, display: 'block', whiteSpace: 'nowrap', letterSpacing: 0.5 }}>
                Edu-TA 智教星
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 9, display: 'block', whiteSpace: 'nowrap' }}>
                {BRAND.tagline}
              </Text>
            </div>
          )}
        </div>

        {/* ── 导航菜单（带品牌交互动效） ── */}
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultSelectedKeys={['/']}
          items={menuItems}
          onClick={({ key }) => {
            if (key === location.pathname) {
              // 点击当前页面 → 刷新内容区（Routes 组件重建）
              setRouteKey(prev => prev + 1);
            } else {
              navigate(key);
            }
          }}
          style={{
            background: '#0A1428',
            borderRight: 0,
            marginTop: 0,
          }}
          className="menu-code-flow"
        />

        {/* 底部信息 */}
        {!collapsed && (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: 0,
              right: 0,
              textAlign: 'center',
              color: 'rgba(255,255,255,0.3)',
              fontSize: 10,
            }}
          >
            挑战杯 · 学科大模型赛道
          </div>
        )}
      </Sider>

      <Layout style={{ marginLeft: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH, height: '100vh' }}>
        {/* 顶部导航栏 */}
        <Header
          style={{
            padding: '0 20px',
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 60,
            lineHeight: '60px',
            zIndex: 99,
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
            flexShrink: 0,
          }}
        >
          <Space>
            {collapsed ? (
              <MenuUnfoldOutlined style={{ fontSize: 18, cursor: 'pointer', color: '#666' }} onClick={() => setCollapsed(false)} />
            ) : (
              <MenuFoldOutlined style={{ fontSize: 18, cursor: 'pointer', color: '#666' }} onClick={() => setCollapsed(true)} />
            )}
            <Text style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a', marginLeft: 6 }}>
              {menuItems.find(m => m.key === location.pathname)?.label || '智能助教系统'}
            </Text>
          </Space>

          <Space size={18}>
            <Tooltip title={visible ? '隐藏所有用例数据' : '显示所有用例数据'}>
              <Button
                type="text"
                size="small"
                icon={visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                onClick={toggleVisibility}
                style={{
                  color: visible ? BRAND.colors.primary : '#ff4d4f',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {visible ? '数据可见' : '数据已隐藏'}
              </Button>
            </Tooltip>
            <Tooltip title="帮助文档">
              <QuestionCircleOutlined style={{ fontSize: 17, color: '#666', cursor: 'pointer' }} />
            </Tooltip>
            <Tooltip title="消息通知">
              <BellOutlined style={{ fontSize: 17, color: '#666', cursor: 'pointer' }} />
            </Tooltip>
            <Tooltip title="LLM 服务配置">
              <SettingOutlined style={{ fontSize: 17, color: '#666', cursor: 'pointer' }} onClick={() => navigate('/llm-setting')} />
            </Tooltip>
            <Dropdown
              menu={{
                items: [
                  { key: 'profile', icon: <UserOutlined />, label: `当前用户：${username}` },
                  { type: 'divider' },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
                ],
                onClick: ({ key }) => { if (key === 'logout') handleLogout(); },
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size={30} icon={<UserOutlined />} style={{ backgroundColor: '#1890ff' }} />
                <Text style={{ color: '#666', fontSize: 13 }}>{username || '助教'}</Text>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        {/* 内容区域 */}
        <Content
          style={{
            padding: 20,
            background: '#f5f7fa',
            overflow: 'auto',
            height: 'calc(100vh - 60px)',
          }}
        >
          {/* 全局 LLM 状态栏（除 LLM 配置页外显示） */}
          {location.pathname !== '/llm-setting' && (
            <GlobalStatusBar onRefresh={() => navigate('/llm-setting')} />
          )}

          <Routes key={routeKey}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/assignments" element={<AssignmentPublish />} />
            <Route path="/homework" element={<HomeworkGrading />} />
            <Route path="/insight" element={<StudentInsight />} />
            <Route path="/materials" element={<MaterialCenter />} />
            <Route path="/lesson" element={<LessonPlanning />} />
            <Route path="/courses" element={<CourseManagement />} />
            <Route path="/notifications" element={<NotificationCenter />} />
            <Route path="/resources" element={<ResourceCenter />} />
            <Route path="/llm-setting" element={<LlmSetting />} />
            <Route path="/agent" element={<AgentWorkflow />} />
            <Route path="/messaging" element={<MessagingCenter />} />
          </Routes>
        </Content>
      </Layout>

    </Layout>
  );
};

// 包裹 DataVisibilityProvider
const MainLayout: React.FC = () => (
  <DataVisibilityProvider>
    <MainLayoutInner />
  </DataVisibilityProvider>
);

// ── 根组件 ──────────────────────────────────────────────

const App: React.FC = () => {
  return (
    <Routes>
      {/* 登录/注册（无保护） */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* 所有其他路由需登录 */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

export default App;
