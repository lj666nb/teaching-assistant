/**
 * 课程管理 — Edu-TA 智教星 全动态后端驱动
 *
 * 所有下拉枚举/教师/学期/状态→后端API动态获取，无前端硬编码
 * 进度/状态由后端计算，前端仅展示
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Typography, Space, Table, Tag, Progress, Row, Col, Statistic, Avatar,
  Modal, Descriptions, Divider, Select, Input, Button, Tabs, List, Tooltip,
  Drawer, Form, Popconfirm, message, Empty, Spin, Alert, Checkbox, InputNumber,
  Skeleton,
  DatePicker, Popover, AutoComplete,
} from 'antd';
import {
  ReadOutlined, TeamOutlined, ClockCircleOutlined, BookOutlined, EyeOutlined,
  PlusOutlined, DeleteOutlined, SearchOutlined, DownloadOutlined, EditOutlined,
  CheckCircleOutlined, ReloadOutlined, UserOutlined, HistoryOutlined,
  DashboardOutlined, LinkOutlined, FileTextOutlined, BarChartOutlined, FormOutlined,
  CopyOutlined, MessageOutlined,
} from '@ant-design/icons';
import { courseMgmtApi } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BRAND } from '../utils/brand';
import dayjs from 'dayjs';
import axios from 'axios';
import { API_BASE_URL } from '../api/base';
import './../styles/brand.css';
import { useDataVisibility } from '../context/DataVisibilityContext';

const { Title, Text, Paragraph } = Typography;

const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', color || BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle' }} />
);

// 状态颜色映射（从后端枚举读取 type → 本地色值映射）
const statusColorMap: Record<string, string> = {
  'processing': '#1677ff', 'warning': '#fa8c16', 'success': '#52c41a', 'default': '#999',
};

const CourseManagement: React.FC = () => {
  const { visible } = useDataVisibility();
  const { username } = useAuth();
  const navigate = useNavigate();
  // ── 动态数据 ──
  const [enums, setEnums] = useState<any>({});
  const [teachers, setTeachers] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('basic');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<any>(null);
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [sessionForm] = Form.useForm();
  const [batchCount, setBatchCount] = useState(3);

  // 课时管理
  const [sessionItems, setSessionItems] = useState<any[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<any>(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [selectedSessionRows, setSelectedSessionRows] = useState<any[]>([]);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  // 学生管理
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [studentForm] = Form.useForm();
  const [addingStudent, setAddingStudent] = useState(false);

  // 手动已授课时（编辑时使用）
  const [manualSessions, setManualSessions] = useState(0);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [sessionsError, setSessionsError] = useState('');

  // 布置作业弹窗
  const [hwModalOpen, setHwModalOpen] = useState(false);
  const [hwCourse, setHwCourse] = useState<any>(null);
  const [hwForm] = Form.useForm();

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteStep, setDeleteStep] = useState(0); // 0=无, 1=第一层, 2=第二层
  const [deleteNameInput, setDeleteNameInput] = useState('');

  // 筛选
  const [semester, setSemester] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedRows, setSelectedRows] = useState<any[]>([]);

  // ── 加载枚举 ──
  const loadEnums = useCallback(async () => {
    try {
      const [eRes, tRes, cRes] = await Promise.all([
        courseMgmtApi.getEnums(),
        courseMgmtApi.listTeachers(),
        courseMgmtApi.listCourses(semester || undefined),
      ]);
      if (eRes.data.success) setEnums(eRes.data.data);
      if (tRes.data.success) setTeachers(tRes.data.data?.teachers || []);
      if (cRes.data.success) setCourses(cRes.data.data?.items || []);
    } catch {
      message.error('加载配置失败，请检查后端服务');
    }
  }, [semester]);

  useEffect(() => { loadEnums(); }, [loadEnums]);

  // 下拉选项
  const semesterOpts = (enums.semesters || []).map((s: any) => ({ value: s.value, label: s.label }));
  const statusOpts = (enums.statuses || []).map((s: any) => ({ value: s.value, label: s.label }));
  const categoryOpts = (enums.course_categories || []).map((c: any) => ({ value: c.value, label: c.label }));
  const teacherOpts = teachers.map((t: any) => ({ value: t.name, label: `${t.name}（${t.title || '讲师'}）` }));
  const thresholds = enums.progress_thresholds || { half: 50, complete: 100, max_hours: 64 };

  // 筛选
  const filtered = courses.filter(c => {
    if (semester && c.semester !== semester) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (searchText && !c.name.includes(searchText) && !c.code.includes(searchText)) return false;
    return true;
  });

  // 可显示的课程：隐藏模式下排除种子数据，保留用户添加的
  const displayCourses = visible ? filtered : filtered.filter(c => c._source !== 'seed');

  // 统计（基于可显示课程）
  const totalStudents = (() => {
    const ids = new Set<string>();
    displayCourses.forEach(c => (c.student_list || []).forEach((s: any) => s.id && ids.add(s.id)));
    return ids.size || displayCourses.reduce((s: number, c: any) => s + (c.students || 0), 0);
  })();
  const totalSessions = displayCourses.reduce((s: number, c: any) => s + (c.sessions || 0), 0);
  const totalMaxHours = displayCourses.reduce((s: number, c: any) => s + (c.max_hours || 0), 0);
  const avgProgress = displayCourses.length > 0 ? Math.round(displayCourses.reduce((s: number, c: any) => s + (c.progress || 0), 0) / displayCourses.length) : 0;

  // ── 状态标签（动态渲染，无硬编码 if/else） ──
  const statusTag = (status: string) => {
    const cfg = (enums.statuses || []).find((s: any) => s.value === status);
    const st = cfg?.type || 'default';
    return <Tag color={st} style={{ borderRadius: 6 }}>{cfg?.label || status}</Tag>;
  };

  // ── 导出课程 ──
  const handleExport = async () => {
    if (selectedRows.length === 0) return;
    try {
      const res = await courseMgmtApi.exportCourses(selectedRows.map(r => r.id));
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `课程列表_${dayjs().format('YYYYMMDD_HHmmss')}.docx`;
      a.click();
      window.URL.revokeObjectURL(url);
      message.success(`已导出 ${selectedRows.length} 门课程`);
    } catch {
      message.error('导出失败，请检查后端服务');
    }
  };
  const handleAdd = () => {
    addForm.validateFields().then(async values => {
      try {
        const res = await courseMgmtApi.createCourse(values);
        if (res.data.success) {
          message.success(`「${values.name}」创建成功`);
          setAddModalOpen(false); addForm.resetFields(); loadEnums();
        }
      } catch (e: any) {
        const detail = e.response?.data?.detail || '创建失败';
        if (e.response?.status === 409) message.error(`编号重复：${detail}`);
        else message.error(detail);
      }
    }).catch(() => {}); // 表单校验失败，不做额外处理
  };

  const handleEdit = (course: any) => {
    setEditingCourse(course);
    editForm.setFieldsValue({
      name: course.name, code: course.code, teacher: course.teacher,
      semester: course.semester, category: course.category || '专业核心',
      status: course.status || '进行中',
      description: course.description, max_hours: course.max_hours || thresholds.max_hours,
    });
    setEditModalOpen(true);
    loadSessions(course.id, course.max_hours || thresholds.max_hours || 48);
  };

  const handleEditSave = () => {
    if (!editingCourse) return;
    editForm.validateFields().then(async values => {
      try {
        const payload = { ...values, sessions: manualSessions, updated_by: username || '当前用户' };
        const res = await courseMgmtApi.updateCourse(editingCourse.id, payload);
        if (res.data.success) { message.success('已更新'); setEditModalOpen(false); loadEnums(); }
      } catch (e: any) {
        const status = e.response?.status;
        const detail = e.response?.data?.detail || '更新失败';
        if (status === 409) {
          message.error(`编号重复：${detail}`);
        } else {
          message.error(detail);
        }
      }
    });
  };

  const handleDelete = (course: any) => {
    setDeleteTarget(course);
    setDeleteStep(1);
    setDeleteNameInput('');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await courseMgmtApi.deleteCourse(deleteTarget.id);
      message.success(`「${deleteTarget.name}」已永久删除`);
      setDeleteTarget(null); setDeleteStep(0);
      loadEnums();
    } catch { message.error('删除失败'); }
  };

  const handleAddSession = async (course: any) => {
    try {
      const res = await courseMgmtApi.addSession(course.id);
      if (res.data.success) { message.success('已增加一节课时'); loadEnums(); }
    } catch { message.error('操作失败'); }
  };

  // ── 课时明细管理 ──
  const loadSessions = async (courseId: string, maxHours?: number) => {
    setSessionLoading(true);
    try {
      const res = await courseMgmtApi.listSessions(courseId);
      const items = res.data.data?.items || [];
      setSessionItems(items);
      const total = items.reduce((s: number, i: any) => s + (i.hours || 0), 0);
      setManualSessions(total);
      recalcPreview(total, maxHours || editingCourse?.max_hours || 48);
    } catch { setSessionItems([]); }
    finally { setSessionLoading(false); }
  };

  const recalcPreview = (sess: number, maxH: number) => {
    if (sess < 0 || sess > maxH) {
      setSessionsError(`已授课时需在 0~${maxH} 之间`);
      setPreviewProgress(0);
    } else {
      setSessionsError('');
      setPreviewProgress(Math.min(Math.round(sess / Math.max(maxH, 1) * 100), 100));
    }
  };

  const handleManualSessionsChange = (val: number | null) => {
    const v = val || 0;
    setManualSessions(v);
    recalcPreview(v, editingCourse?.max_hours || 48);
  };

  const openAddSession = () => { sessionForm.resetFields(); setEditingSession(null); setSessionModalOpen(true); };
  const openEditSession = (s: any) => {
    setEditingSession(s);
    sessionForm.setFieldsValue({ ...s, date: s.date ? dayjs(s.date) : undefined });
    setSessionModalOpen(true);
  };

  const handleSessionSave = async () => {
    if (!editingCourse) return;
    const vals = await sessionForm.validateFields();
    // dayjs → 字符串
    const payload = { ...vals, date: vals.date ? dayjs(vals.date).format('YYYY-MM-DD') : '' };
    try {
      if (editingSession) {
        await courseMgmtApi.updateSession(editingCourse.id, editingSession.id, payload);
      } else {
        await courseMgmtApi.createSession(editingCourse.id, payload);
      }
      message.success(editingSession ? '已更新' : '已添加');
      setSessionModalOpen(false);
      loadSessions(editingCourse.id);
      loadEnums();
    } catch (e: any) { message.error(e.response?.data?.detail || '保存失败'); }
  };

  const handleSessionDelete = async (sid: string) => {
    if (!editingCourse) return;
    try {
      await courseMgmtApi.deleteSession(editingCourse.id, sid);
      message.success('已删除');
      loadSessions(editingCourse.id);
      loadEnums();
    } catch { message.error('删除失败'); }
  };

  const handleBatchAdd = async () => {
    if (!editingCourse) return;
    const items = Array.from({ length: batchCount }, () => ({ date: '', hours: 1, topic: '', attendance: 0 }));
    try {
      await courseMgmtApi.batchSessions(editingCourse.id, items);
      message.success(`已批量添加 ${batchCount} 节空课时，请编辑详情`);
      setBatchModalOpen(false);
      loadSessions(editingCourse.id);
      loadEnums();
    } catch (e: any) { message.error(e.response?.data?.detail || '批量添加失败'); }
  };

  // 批量删除课时
  const handleBatchDeleteSessions = () => {
    Modal.confirm({
      title: `确认删除 ${selectedSessionRows.length} 条课时？`,
      content: `合计 ${selectedSessionRows.reduce((s, r) => s + (r.hours || 0), 0)} 节，删除后总已授课时减少`,
      okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        if (!editingCourse) return;
        for (const row of selectedSessionRows) {
          await courseMgmtApi.deleteSession(editingCourse.id, row.id);
        }
        message.success(`已删除 ${selectedSessionRows.length} 条课时`);
        setSelectedSessionRows([]);
        loadSessions(editingCourse.id);
        loadEnums();
      },
    });
  };

  // 复制课时
  const handleDuplicateSession = (s: any) => {
    sessionForm.setFieldsValue({ ...s, date: undefined, id: undefined });
    setEditingSession(null);
    setSessionModalOpen(true);
  };

  // 冲突解决
  const detailSum = sessionItems.reduce((s, i) => s + (i.hours || 0), 0);
  const hasConflict = detailSum !== manualSessions && !sessionsError && sessionItems.length > 0;

  const resolveConflict = (mode: 'overwrite' | 'sync') => {
    if (mode === 'sync') {
      setManualSessions(detailSum);
      recalcPreview(detailSum, editingCourse?.max_hours || 48);
    } else if (mode === 'overwrite' && sessionItems.length > 0) {
      const diff = manualSessions - detailSum;
      const last = { ...sessionItems[sessionItems.length - 1], hours: Math.max(1, (sessionItems[sessionItems.length - 1].hours || 0) + diff) };
      const updated = [...sessionItems.slice(0, -1), last];
      setSessionItems(updated);
      // Persist the change
      if (editingCourse) {
        courseMgmtApi.updateSession(editingCourse.id, last.id, last).then(() => loadSessions(editingCourse!.id));
      }
    }
    setConflictModalOpen(false);
  };

  // 布置作业
  const handleAssignHomework = (course: any) => {
    setHwCourse(course);
    hwForm.setFieldsValue({
      course_name: course.name || '',
      title: '',
      content: '',
      deadline: undefined,
      selected_students: course.student_list || [],
    });
    setHwModalOpen(true);
  };
  const handleHwSubmit = async () => {
    const vals = await hwForm.validateFields();
    await axios.post(`${API_BASE_URL}/assignments`, {
      ...vals,
      teacher_name: username,
      course_id: hwCourse?.id || '',
      deadline: vals.deadline ? dayjs(vals.deadline).toISOString() : '',
      selected_students: vals.selected_students || [],
    });
    message.success('作业已发布！');
    setHwModalOpen(false);
    hwForm.resetFields();
  };

  const generateCode = async (courseId: string) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/course-mgmt/courses/${courseId}/generate-code`);
      message.success(`班级编号: ${res.data.data.class_code}`);
      loadEnums(); // refresh list
    } catch { message.error('生成失败'); }
  };

  const startPrivateChat = async (studentName: string) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/messaging/conversations`, {
        title: `与 ${studentName} 的私聊`,
        student_name: studentName,
        teacher_name: username,
      });
      const conv = res.data?.data;
      if (conv?.id) {
        navigate(`/messaging?conv=${conv.id}`);
      } else {
        navigate('/messaging');
      }
    } catch {
      navigate('/messaging');
    }
  };

  return (
    <div className="page-enter">
      {loading && <Spin style={{ position: 'fixed', top: '50%', left: '50%', zIndex: 9999 }} />}

      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Space align="center" size={10}>
            <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 32, height: 32, display: 'inline-flex', animation: 'logoPulse 0.8s ease-out' }} />
            <div>
              <Title level={4} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: BRAND.colors.textPrimary }}>智教星 · 课程管理</Title>
              <Text type="secondary" style={{ fontSize: 11 }}>全动态后端驱动 · 所有配置可后台管理</Text>
            </div>
          </Space>
        </Col>
        <Col>
          <Space>
            <Select value={semester || undefined} onChange={v => setSemester(v || '')} style={{ width: 140, borderRadius: 8 }}
              placeholder="全部学期" allowClear options={semesterOpts} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}
              style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient }}>新增课程</Button>
          </Space>
        </Col>
      </Row>

      {/* 指标卡 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { value: displayCourses.length, label: `课程数`, icon: <BookOutlined />, color: BRAND.colors.primary, suffix: '门', tip: visible ? `共 ${courses.length} 门课程` : '' },
          { value: totalStudents, label: '覆盖学生', icon: <TeamOutlined />, color: BRAND.colors.green, suffix: '人', tip: '' },
          { value: totalMaxHours, label: '总课时', icon: <ClockCircleOutlined />, color: BRAND.colors.orange, suffix: '节', tip: '所有课程课时上限之和' },
          { value: avgProgress, label: '平均进度', icon: <ReadOutlined />, color: BRAND.colors.purple, suffix: '%', tip: `过半阈值 ${thresholds.half}%` },
        ].map((item, i) => (
          <Col span={6} key={i}>
            <Tooltip title={item.tip}>
              <Card className="brand-card" bodyStyle={{ padding: '14px 18px', position: 'relative' }}>
                <span style={{ position: 'absolute', top: 6, right: 8, color: item.color, opacity: 0.3 }}><BrandBadge /></span>
                <Statistic title={<Text style={{ fontSize: 12, color: BRAND.colors.textSecondary }}>{item.label}</Text>}
                  value={item.value} suffix={<Text style={{ fontSize: 12, color: BRAND.colors.textTertiary }}>{item.suffix}</Text>}
                  prefix={<span style={{ color: item.color, fontSize: 18 }}>{item.icon}</span>}
                  valueStyle={{ fontSize: 24, fontWeight: 700, color: BRAND.colors.textPrimary }} />
              </Card>
            </Tooltip>
          </Col>
        ))}
      </Row>

      {/* 列表 */}
      <Card className="brand-card" bodyStyle={{ padding: '12px 16px' }}
        title={<Space><BrandBadge /><ReadOutlined style={{ color: BRAND.colors.primary }} /><Text strong>课程列表</Text><Tag style={{ borderRadius: 6, fontSize: 10 }}>{filtered.length} 门</Tag></Space>}
        extra={
          <Space>
            <Input placeholder="搜索课程/编号" prefix={<SearchOutlined />} style={{ width: 180, borderRadius: 8 }} value={searchText} onChange={e => setSearchText(e.target.value)} allowClear />
            <Select style={{ width: 110, borderRadius: 8 }} placeholder="状态" allowClear value={statusFilter || undefined} onChange={v => setStatusFilter(v || '')} options={statusOpts} />
            {selectedRows.length > 0 && (
              <>
                <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}
                  style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>导出({selectedRows.length})</Button>
                <Popconfirm title="确认批量归档？"><Button size="small" icon={<CheckCircleOutlined />} style={{ borderRadius: 6, borderColor: BRAND.colors.green, color: BRAND.colors.green }}>归档</Button></Popconfirm>
              </>
            )}
            <Button size="small" icon={<ReloadOutlined />} onClick={loadEnums} style={{ borderRadius: 6 }}>刷新</Button>
          </Space>
        }>
        <Table dataSource={displayCourses} pagination={{ pageSize: 8 }} rowKey="id" className="table-header-brand"
          locale={{ emptyText: visible ? <Empty description="暂无课程数据" image={Empty.PRESENTED_IMAGE_SIMPLE}><Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>新增课程</Button></Empty> : <Empty description="暂无数据" /> }}
          rowSelection={{ onChange: (_, rows) => setSelectedRows(rows) }}
          onRow={(r) => ({
            style: { cursor: 'pointer' },
            onClick: (e) => {
              const target = e.target as HTMLElement;
              if (target.closest('button') || target.closest('a') || target.closest('.ant-checkbox-wrapper')) return;
              setSelectedCourse(r); setDrawerTab('basic'); setDrawerOpen(true); setStudentSearch('');
            },
          })}
          columns={[
            { title: '课程名称', dataIndex: 'name', render: (v: string, r: any) => (<Space><Avatar size="small" style={{ backgroundColor: r.color || BRAND.colors.primary }}><BookOutlined /></Avatar><Text strong style={{ color: BRAND.colors.textPrimary }}>{v}</Text></Space>) },
            { title: '编号', dataIndex: 'code', width: 90 },
            { title: '班级编号', dataIndex: 'class_code', width: 100, render: (v: string, r: any) => v ? (
              <Space size={2}><Tag color="purple" style={{ borderRadius: 4, fontFamily: 'monospace' }}>{v}</Tag>
              <Tooltip title="复制编号"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(v); message.success('已复制'); }} /></Tooltip></Space>) : (
              <Button type="link" size="small" onClick={() => generateCode(r.id)} style={{ fontSize: 11 }}>生成编号</Button>) },
            { title: '教师', dataIndex: 'teacher', width: 90 },
            { title: '学生', dataIndex: 'students', width: 80, render: (_v: number, r: any) => <Tag style={{ borderRadius: 6 }}>{r.student_list?.length || r.students || 0} 人</Tag> },
            { title: '已授课时', dataIndex: 'sessions', width: 90, render: (v: number, r: any) => <Tag style={{ borderRadius: 6 }}>{v || 0}/{r.max_hours || thresholds.max_hours} 节</Tag> },
            { title: '进度', dataIndex: 'progress', width: 150, render: (v: number) => {
              const p = v || 0;
              const c = p >= 80 ? BRAND.colors.green : p >= thresholds.half ? BRAND.colors.primary : BRAND.colors.orange;
              return <Progress percent={p} size="small" strokeColor={c} trailColor={BRAND.colors.border} style={{ width: 120 }} format={() => `${p}%`} />;
            }},
            { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => statusTag(v) },
            { title: '操作', width: 300, render: (_: any, r: any) => (
              <Space size={0}>
                <Button type="link" size="small" icon={<FormOutlined />}
                  style={{ color: BRAND.colors.primary, fontSize: 11 }} onClick={() => handleAssignHomework(r)}>布置作业</Button>
                <Button type="link" size="small" icon={<EyeOutlined />} style={{ color: BRAND.colors.primary, fontSize: 11 }} onClick={() => { setSelectedCourse(r); setDrawerTab('basic'); setDrawerOpen(true); setStudentSearch(''); }}>详情</Button>
                <Button type="link" size="small" icon={<EditOutlined />} style={{ fontSize: 11 }} onClick={() => handleEdit(r)}>编辑</Button>
                <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ fontSize: 11 }}
                  onClick={() => handleDelete(r)}>删除</Button>
              </Space>
            )},
          ]} />
      </Card>

      {/* ── 新增弹窗（全字段 + 完整校验） ── */}
      <Modal title={<Space><BrandBadge /><PlusOutlined />新增课程</Space>} open={addModalOpen}
        onCancel={() => { setAddModalOpen(false); addForm.resetFields(); }}
        onOk={handleAdd} okText="确认创建" width={560} destroyOnClose>
        <Form form={addForm} layout="vertical" validateTrigger="onBlur">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="课程名称" rules={[
                { required: true, message: '请填写课程名称' },
                { max: 50, message: '不超过50字符' },
                { whitespace: true, message: '不能全空格' },
              ]}><Input placeholder="机器学习" maxLength={50} style={{ borderRadius: 8 }} /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="code" label="课程编号" help="留空自动生成"
                rules={[{ pattern: /^[A-Za-z0-9-]*$/, message: '仅允许字母、数字、短横线' }]}>
                <Input placeholder="AI301" maxLength={20} style={{ borderRadius: 8 }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="teacher" label="授课教师" rules={[{ required: true, message: '请填写授课教师' }, { max: 30, message: '不超过30字符' }]}>
                <AutoComplete style={{ borderRadius: 8, width: '100%' }} placeholder="输入教师姓名" allowClear
                  options={teacherOpts}
                  filterOption={(input, option) => (option?.label as string || '').includes(input)}
                  notFoundContent={
                    teacherOpts.length === 0 ? (
                      <div style={{ padding: 8 }}>
                        <Text type="secondary">暂无教师记录，直接输入姓名即可</Text>
                      </div>
                    ) : null
                  }
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="semester" label="所属学期" initialValue="2026春季" rules={[{ required: true, message: '请输入或选择学期' }]}>
                <AutoComplete style={{ borderRadius: 8, width: '100%' }} options={semesterOpts} placeholder="输入或选择学期，如 2026秋季" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="category" label="课程分类" initialValue="专业核心" rules={[{ required: true, message: '请选择分类' }]}>
                <Select style={{ borderRadius: 8 }} options={categoryOpts} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="课程状态" initialValue="进行中" rules={[{ required: true, message: '请选择状态' }]}>
                <Select style={{ borderRadius: 8 }} options={statusOpts} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="max_hours" label="总课时" initialValue={48} rules={[
                { required: true, message: '总课时必填' },
                { type: 'number', min: 1, message: '必须大于0' },
              ]}>
                <InputNumber min={1} max={64} style={{ width: '100%', borderRadius: 8 }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="课程简介" rules={[{ max: 200, message: '不超过200字' }]}>
            <Input.TextArea rows={2} showCount maxLength={200} placeholder="选填" style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── 编辑抽屉（双Tab：基础信息 + 课时进度） ── */}
      <Drawer title={editingCourse ? <Space><BrandBadge /><EditOutlined />编辑：{editingCourse.name}</Space> : ''}
        open={editModalOpen} onClose={() => setEditModalOpen(false)} width={720} destroyOnClose
        extra={<Button type="primary" onClick={handleEditSave} icon={<CheckCircleOutlined />}>保存课程</Button>}
      >
        {editingCourse && (
          <Tabs defaultActiveKey="basic" items={[
            // ═══ Tab 1: 基础信息 ═══
            { key: 'basic', label: <span><EditOutlined />基础信息</span>, children: (
              <Form form={editForm} layout="vertical" validateTrigger="onBlur">
                <Row gutter={12}>
                  <Col span={12}><Form.Item name="name" label="课程名称" rules={[{ required: true, message: '请填写课程名称' }, { max: 50, message: '不超过50字符' }]}><Input style={{ borderRadius: 8 }} maxLength={50} /></Form.Item></Col>
                  <Col span={12}><Form.Item name="code" label="课程编号" rules={[{ pattern: /^[A-Za-z0-9-]*$/, message: '仅允许字母、数字、短横线' }]}><Input style={{ borderRadius: 8 }} maxLength={20} /></Form.Item></Col>
                </Row>
                <Row gutter={12}>
                  <Col span={12}><Form.Item name="teacher" label="授课教师" rules={[{ required: true, message: '请填写授课教师' }, { max: 30, message: '不超过30字符' }]}><AutoComplete style={{ borderRadius: 8, width: '100%' }} placeholder="输入教师姓名" allowClear options={teacherOpts} filterOption={(input, option) => (option?.label as string || '').includes(input)} /></Form.Item></Col>
                  <Col span={12}><Form.Item name="semester" label="学期" rules={[{ required: true, message: '请输入或选择学期' }]}><AutoComplete style={{ borderRadius: 8, width: '100%' }} options={semesterOpts} placeholder="输入或选择学期" /></Form.Item></Col>
                </Row>
                <Row gutter={12}>
                  <Col span={8}><Form.Item name="category" label="课程分类" rules={[{ required: true, message: '请选择分类' }]}><Select style={{ borderRadius: 8 }} options={categoryOpts} /></Form.Item></Col>
                  <Col span={8}><Form.Item name="status" label="课程状态" rules={[{ required: true, message: '请选择状态' }]}><Select style={{ borderRadius: 8 }} options={statusOpts} /></Form.Item></Col>
                  <Col span={8}><Form.Item name="max_hours" label="总课时" rules={[{ required: true, message: '必填' }, { type: 'number', min: 1, message: '至少1课时' }]}><InputNumber min={1} max={64} style={{ width: '100%', borderRadius: 8 }} /></Form.Item></Col>
                </Row>
                <Form.Item name="description" label="简介" rules={[{ max: 200, message: '不超过200字' }]}><Input.TextArea rows={2} maxLength={200} style={{ borderRadius: 8 }} /></Form.Item>
                <div style={{ background: '#fafafa', borderRadius: 8, padding: '10px 14px' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}><HistoryOutlined style={{ marginRight: 4 }} />
                    创建：{editingCourse.created_at || '—'}
                    {editingCourse.updated_at && editingCourse.updated_at !== editingCourse.created_at && <span>　|　上次编辑：{editingCourse.updated_at}</span>}
                    {editingCourse.updated_by && <span>　|　编辑人：{editingCourse.updated_by}</span>}
                  </Text>
                </div>
              </Form>
            )},
            // ═══ Tab 2: 课时进度 ═══
            { key: 'sessions', label: <span><ClockCircleOutlined />课时进度</span>, children: (
              <div>
                {/* 手动已授课时 + 实时进度预览 */}
                <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
                  <Row gutter={16} align="middle">
                    <Col span={8}>
                      <Text strong>总课时（只读）</Text>
                      <Input value={editingCourse.max_hours || 48} disabled style={{ borderRadius: 8, marginTop: 4 }} />
                    </Col>
                    <Col span={8}>
                      <Text strong>已授课时</Text>
                      <InputNumber min={0} max={editingCourse.max_hours || 64} value={manualSessions}
                        onChange={handleManualSessionsChange}
                        style={{ width: '100%', borderRadius: 8, marginTop: 4 }}
                        status={sessionsError ? 'error' : ''} />
                      {sessionsError && <Text type="danger" style={{ fontSize: 10 }}>{sessionsError}</Text>}
                    </Col>
                    <Col span={8}>
                      <Text strong>实时进度预览</Text>
                      <div style={{ marginTop: 4 }}>
                        <Progress percent={previewProgress} strokeColor={previewProgress >= 80 ? '#52c41a' : previewProgress >= 50 ? '#1677ff' : '#fa8c16'} format={() => `${previewProgress}%`} />
                      </div>
                    </Col>
                  </Row>
                </Card>

                {/* 冲突提示 */}
                {hasConflict && (
                  <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                    message={`明细合计 ${detailSum} 节 ≠ 手动值 ${manualSessions} 节`}
                    action={<Button size="small" onClick={() => setConflictModalOpen(true)}>解决冲突</Button>} />
                )}

                {/* 工具栏 */}
                <Space style={{ marginBottom: 12 }} wrap>
                  <Button type="primary" icon={<PlusOutlined />} size="small" onClick={openAddSession} style={{ borderRadius: 6 }}>添加单节课</Button>
                  <Button icon={<PlusOutlined />} size="small" onClick={() => setBatchModalOpen(true)} style={{ borderRadius: 6 }}>批量录入</Button>
                  {selectedSessionRows.length > 0 && (
                    <Popconfirm title={`删除选中的 ${selectedSessionRows.length} 条课时？合计 ${selectedSessionRows.reduce((s, r) => s + (r.hours || 0), 0)} 节`} onConfirm={handleBatchDeleteSessions}>
                      <Button danger size="small" icon={<DeleteOutlined />} style={{ borderRadius: 6 }}>批量删除({selectedSessionRows.length})</Button>
                    </Popconfirm>
                  )}
                  <Button size="small" icon={<ReloadOutlined />} style={{ borderRadius: 6 }}
                    onClick={() => editingCourse && loadSessions(editingCourse.id)}>刷新</Button>
                </Space>

                {sessionItems.length === 0 || !visible ? (
                  <Empty description={visible ? "暂无课时记录" : "暂无数据"} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                    {visible && <Button type="link" onClick={openAddSession}>添加第一节课</Button>}
                  </Empty>
                ) : (
                  <Table dataSource={sessionItems} rowKey="id" size="small" pagination={false}
                    rowSelection={{ selectedRowKeys: selectedSessionRows.map(r => r.id), onChange: (_, rows) => setSelectedSessionRows(rows) }}
                    summary={() => (
                      <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={3}><Text strong>明细合计：{detailSum} 节</Text></Table.Summary.Cell><Table.Summary.Cell index={3} /><Table.Summary.Cell index={4} /></Table.Summary.Row>
                    )}
                    columns={[
                      { title: '日期', dataIndex: 'date', width: 100, defaultSortOrder: 'ascend', sorter: (a: any, b: any) => a.date.localeCompare(b.date) },
                      { title: '节数', dataIndex: 'hours', width: 50 },
                      { title: '授课内容', dataIndex: 'topic', ellipsis: true },
                      { title: '出勤', dataIndex: 'attendance', width: 50, render: (v: number) => `${v}人` },
                      { title: '操作', width: 140, render: (_: any, r: any) => (
                        <Space size={0}>
                          <Button type="link" size="small" onClick={() => openEditSession(r)}>编辑</Button>
                          <Button type="link" size="small" onClick={() => handleDuplicateSession(r)}>复制</Button>
                          <Popconfirm title="删除此课时？" onConfirm={() => handleSessionDelete(r.id)}>
                            <Button type="link" size="small" danger>删除</Button>
                          </Popconfirm>
                        </Space>
                      )},
                    ]} />
                )}
              </div>
            )},
          ]} />
        )}
      </Drawer>

      {/* 课时明细 新增/编辑弹窗 */}
      <Modal title={editingSession ? '编辑课时' : '新增课时'} open={sessionModalOpen} onCancel={() => setSessionModalOpen(false)} onOk={handleSessionSave} okText="保存" width={460} destroyOnClose>
        <Form form={sessionForm} layout="vertical">
          <Form.Item name="date" label="上课日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%', borderRadius: 8 }} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="hours" label="课时节数" rules={[{ required: true }]}><InputNumber min={1} max={8} style={{ width: '100%', borderRadius: 8 }} /></Form.Item></Col>
            <Col span={12}>
              <Form.Item name="attendance" label="出勤人数">
                <InputNumber min={0} style={{ width: '100%', borderRadius: 8 }}
                  addonAfter={
                    <Space size={0}>
                      <Tooltip title="全体出勤"><Button type="link" size="small" style={{ padding: 0 }} onClick={() => sessionForm.setFieldValue('attendance', editingCourse?.students || 0)}>全</Button></Tooltip>
                      <Tooltip title="清零"><Button type="link" size="small" style={{ padding: 0 }} onClick={() => sessionForm.setFieldValue('attendance', 0)}>空</Button></Tooltip>
                    </Space>
                  } />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="topic" label="授课内容"><Input.TextArea rows={2} placeholder="本节课知识点/章节" style={{ borderRadius: 8 }} /></Form.Item>
        </Form>
      </Modal>

      {/* 批量录入弹窗 */}
      <Modal title="批量录入课时" open={batchModalOpen} onCancel={() => setBatchModalOpen(false)} onOk={handleBatchAdd} okText="创建" width={360}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>快速创建空课时记录（后续可逐一编辑详情）</Text>
          <Space>
            <Text>课时数量：</Text>
            <InputNumber min={1} max={20} value={batchCount} onChange={v => setBatchCount(v || 1)} />
          </Space>
        </Space>
      </Modal>

      {/* 冲突解决弹窗 */}
      <Modal title="解决课时冲突" open={conflictModalOpen} onCancel={() => setConflictModalOpen(false)} footer={null} width={460}>
        <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message={`明细合计 ${detailSum} 节 ≠ 手动已授课时 ${manualSessions} 节，差值 ${Math.abs(manualSessions - detailSum)} 节`} />
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Card size="small" hoverable onClick={() => resolveConflict('sync')} style={{ cursor: 'pointer' }}>
            <Text strong>方案一：以明细合计为准</Text>
            <br /><Text type="secondary">将「已授课时」同步为明细总和 {detailSum} 节</Text>
          </Card>
          <Card size="small" hoverable onClick={() => resolveConflict('overwrite')} style={{ cursor: 'pointer' }}>
            <Text strong>方案二：以手动值为准</Text>
            <br /><Text type="secondary">自动调整最后一节课时数，使明细总和 = {manualSessions} 节</Text>
          </Card>
        </Space>
      </Modal>

      {/* ── 详情抽屉（完整只读展示 + 行点击打开） ── */}
      <Drawer title={selectedCourse ? <Space><BrandBadge /><BookOutlined />{selectedCourse.name}</Space> : ''}
        open={drawerOpen} onClose={() => setDrawerOpen(false)} width={720} destroyOnClose
        maskClosable={true} keyboard={true}
        extra={<Button icon={<EditOutlined />} onClick={() => { setDrawerOpen(false); handleEdit(selectedCourse); }}>编辑课程</Button>}
      >
        {selectedCourse ? (
          <Tabs activeKey={drawerTab} onChange={setDrawerTab} destroyOnHidden
            items={[
              { key: 'basic', label: <span><BookOutlined />基础信息</span>, children: (
                <div>
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="课程名称">{selectedCourse.name}</Descriptions.Item>
                    <Descriptions.Item label="课程编号">{selectedCourse.code}</Descriptions.Item>
                    <Descriptions.Item label="授课教师">{selectedCourse.teacher}</Descriptions.Item>
                    <Descriptions.Item label="所属学期">{selectedCourse.semester}</Descriptions.Item>
                    <Descriptions.Item label="课程分类">{selectedCourse.category || '—'}</Descriptions.Item>
                    <Descriptions.Item label="总课时">{selectedCourse.max_hours || 48} 节</Descriptions.Item>
                    <Descriptions.Item label="已授课时">{selectedCourse.sessions || 0} 节</Descriptions.Item>
                    <Descriptions.Item label="课程状态">{statusTag(selectedCourse.status)}</Descriptions.Item>
                    <Descriptions.Item label="选课人数">{selectedCourse.students || 0} 人</Descriptions.Item>
                    <Descriptions.Item label="创建时间" span={2}>{selectedCourse.created_at || '—'}</Descriptions.Item>
                    <Descriptions.Item label="最后编辑">{selectedCourse.updated_at || '—'}</Descriptions.Item>
                    <Descriptions.Item label="编辑人">{selectedCourse.updated_by || '—'}</Descriptions.Item>
                  </Descriptions>
                  <Divider />
                  <Text strong>学习进度</Text>
                  <Progress percent={selectedCourse.progress || 0} style={{ marginTop: 4, marginBottom: 12 }} format={() => `${selectedCourse.progress || 0}%`} />
                  <Text strong>课程简介</Text>
                  <Paragraph style={{ marginTop: 4, color: '#666' }}>{selectedCourse.description || '暂无简介'}</Paragraph>
                </div>
              )},
              { key: 'students', label: <span><TeamOutlined />选课学生</span>, children: (
                <div>
                  {/* 添加学生按钮 — 功能操作，始终可见 */}
                  <div style={{ marginBottom: 12 }}>
                    <Button type="primary" size="small" icon={<PlusOutlined />} style={{ borderRadius: 6 }}
                      onClick={() => { studentForm.resetFields(); setStudentModalOpen(true); }}>
                      添加学生
                    </Button>
                  </div>
                  {(selectedCourse.student_list || []).length === 0 ? (
                    <Empty description="暂无选课学生，点击上方按钮添加" />
                  ) : (() => {
                    const slist = (selectedCourse.student_list || []).filter((s: any) =>
                      !studentSearch || s.name?.includes(studentSearch) || s.student_id?.includes(studentSearch)
                    );
                    return (
                      <>
                        <Row gutter={16} style={{ marginBottom: 12 }}>
                          <Col span={12}><Statistic title="选课总人数" value={(selectedCourse.student_list || []).length} suffix="人" /></Col>
                          <Col span={12}><Statistic title="当前筛选" value={studentSearch ? slist.length : (selectedCourse.student_list || []).length} suffix="人" /></Col>
                        </Row>
                        <Input placeholder="搜索学号/姓名" prefix={<SearchOutlined />} allowClear
                          value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                          style={{ borderRadius: 8, marginBottom: 12 }} />
                        <Table dataSource={slist} rowKey="id" size="small" pagination={{ pageSize: 8 }}
                          locale={{ emptyText: <Empty description="暂无数据" /> }}
                          summary={() => (<Table.Summary.Row><Table.Summary.Cell index={0} colSpan={2}><Text strong>合计</Text></Table.Summary.Cell><Table.Summary.Cell index={2}>{slist.length} 名学生</Table.Summary.Cell><Table.Summary.Cell index={3} /><Table.Summary.Cell index={4} /></Table.Summary.Row>)}
                          columns={[
                            { title: '学号', dataIndex: 'student_id', width: 100 },
                            { title: '姓名', dataIndex: 'name', width: 80 },
                            { title: '班级', dataIndex: 'class', width: 90 },
                            { title: '学习进度', dataIndex: 'progress', width: 120, render: (v: number) => <Progress percent={v || 0} size="small" format={() => `${v || 0}%`} /> },
                            { title: '出勤', dataIndex: 'attendance', width: 80, render: (v: number) => `${v || 0} 次` },
                            { title: '操作', width: 130, render: (_: any, r: any) => (
                              <Space size={0}>
                                <Tooltip title="私聊该学生">
                                  <Button type="link" size="small" icon={<MessageOutlined />}
                                    style={{ color: BRAND.colors.primary, fontSize: 11 }}
                                    onClick={() => startPrivateChat(r.name)}>私聊</Button>
                                </Tooltip>
                                <Popconfirm title={`移除「${r.name}」？`} onConfirm={async () => {
                                try {
                                  await courseMgmtApi.removeStudent(selectedCourse.id, r.id);
                                  message.success(`已移除「${r.name}」`);
                                  // 刷新详情
                                  const res = await courseMgmtApi.getCourse(selectedCourse.id);
                                  if (res.data.success) setSelectedCourse(res.data.data);
                                  loadEnums();
                                } catch { message.error('移除失败'); }
                              }}>
                                <Button type="link" size="small" danger style={{ fontSize: 11 }}>移除</Button>
                              </Popconfirm>
                              </Space>
                            )},
                          ]} />
                      </>
                    );
                  })()}
                </div>
              )},
              { key: 'sessions', label: <span><ClockCircleOutlined />课时明细</span>, children: (
                <div>
                  {(() => {
                    const details = selectedCourse.session_details || [];
                    const total = details.reduce((s: number, d: any) => s + (d.hours || 0), 0);
                    return (
                      <>
                        <Row gutter={16} style={{ marginBottom: 12 }}>
                          <Col span={8}><Statistic title="总课时" value={selectedCourse.max_hours || 48} suffix="节" /></Col>
                          <Col span={8}><Statistic title="明细合计" value={total} suffix="节" /></Col>
                          <Col span={8}><Statistic title="进度" value={selectedCourse.progress || 0} suffix="%" /></Col>
                        </Row>
                        {details.length === 0 || !visible ? (
                          <Empty description={visible ? "暂无课时记录" : "暂无数据"} />
                        ) : (
                          <Table dataSource={details} rowKey="id" size="small" pagination={{ pageSize: 10 }}
                            locale={{ emptyText: <Empty description="暂无数据" /> }}
                            columns={[
                              { title: '日期', dataIndex: 'date', width: 100, defaultSortOrder: 'ascend', sorter: (a: any, b: any) => a.date.localeCompare(b.date) },
                              { title: '节数', dataIndex: 'hours', width: 50 },
                              { title: '授课内容', dataIndex: 'topic', ellipsis: true },
                              { title: '出勤', dataIndex: 'attendance', width: 60, render: (v: number) => `${v || 0}人` },
                            ]}
                            summary={() => (<Table.Summary.Row><Table.Summary.Cell index={0} colSpan={2}><Text strong>合计</Text></Table.Summary.Cell><Table.Summary.Cell index={2} /><Table.Summary.Cell index={3}>{total} 节</Table.Summary.Cell></Table.Summary.Row>)}
                          />
                        )}
                      </>
                    );
                  })()}
                </div>
              )},
              { key: 'resources', label: <span><LinkOutlined />教学资源</span>,
                children: <Empty description="课件/作业/题库由资料与题库模块管理" /> },
            ]} />
        ) : (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" tip="加载课程数据..." /></div>
        )}
      </Drawer>

      {/* ── 添加学生弹窗 ── */}
      <Modal title={<Space><UserOutlined />添加学生</Space>} open={studentModalOpen}
        onCancel={() => { setStudentModalOpen(false); studentForm.resetFields(); }}
        onOk={async () => {
          if (!selectedCourse) return;
          const vals = await studentForm.validateFields().catch(() => null);
          if (!vals) return;
          setAddingStudent(true);
          try {
            await courseMgmtApi.addStudent(selectedCourse.id, vals);
            message.success(`已添加「${vals.name}」`);
            setStudentModalOpen(false); studentForm.resetFields();
            // 刷新课程详情
            const res = await courseMgmtApi.getCourse(selectedCourse.id);
            if (res.data.success) setSelectedCourse(res.data.data);
            loadEnums();
          } catch (e: any) {
            const detail = e.response?.data?.detail || '添加失败';
            if (e.response?.status === 409) message.error(`重复：${detail}`);
            else message.error(detail);
          } finally { setAddingStudent(false); }
        }}
        okText="确认添加" confirmLoading={addingStudent} destroyOnClose width={420}
      >
        <Form form={studentForm} layout="vertical">
          <Form.Item name="name" label="学生姓名" rules={[{ required: true, message: '请输入姓名' }, { max: 30 }]}>
            <Input placeholder="张三" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="student_id" label="学号" rules={[{ required: true, message: '请输入学号' }, { max: 20 }]}>
            <Input placeholder="2024001" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="class_name" label="班级">
            <Input placeholder="如：1班" style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── 双层删除确认弹窗 ── */}
      <Modal title={<Space><DeleteOutlined style={{ color: '#ff4d4f' }} />删除课程</Space>}
        open={deleteStep >= 1} onCancel={() => { setDeleteTarget(null); setDeleteStep(0); }} footer={null} width={480} destroyOnClose>
        {deleteStep === 1 && deleteTarget && (
          <div>
            <Alert type="error" showIcon style={{ marginBottom: 16 }}
              message={`确认删除「${deleteTarget.name}」？`}
              description="删除后课程基础信息、所有课时记录、学生绑定关系将被永久清除，数据无法恢复。" />
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => { setDeleteTarget(null); setDeleteStep(0); }}>取消</Button>
              <Button danger type="primary" onClick={() => setDeleteStep(2)}>继续确认删除</Button>
            </Space>
          </div>
        )}
        {deleteStep === 2 && deleteTarget && (
          <div>
            <Alert type="error" showIcon style={{ marginBottom: 12 }}
              message="最后一步：输入课程名称确认" />
            <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
              请输入 <Text strong code>{deleteTarget.name}</Text> 完成验证：
            </Text>
            <Input value={deleteNameInput} onChange={e => setDeleteNameInput(e.target.value)}
              placeholder={`输入「${deleteTarget.name}」确认`} style={{ borderRadius: 8, marginBottom: 16 }}
              status={deleteNameInput && deleteNameInput !== deleteTarget.name ? 'error' : ''} />
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setDeleteStep(1)}>返回上一步</Button>
              <Button danger type="primary" disabled={deleteNameInput !== deleteTarget.name}
                onClick={confirmDelete}>确认永久删除</Button>
            </Space>
          </div>
        )}
      </Modal>

      {/* 布置作业弹窗 */}
      <Modal title={<Space><FormOutlined />布置作业 · {hwCourse?.name}</Space>}
        open={hwModalOpen} onCancel={() => { setHwModalOpen(false); hwForm.resetFields(); }}
        onOk={handleHwSubmit} okText="发布作业" width={560} destroyOnClose>
        <Form form={hwForm} layout="vertical">
          <Form.Item name="course_name" label="课程" rules={[{ required: true }]}>
            <Input disabled style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="title" label="作业标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="KNN算法编程作业" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="content" label="作业内容">
            <Input.TextArea rows={4} placeholder="作业描述、要求..." style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="deadline" label="截止时间">
            <DatePicker showTime style={{ width: '100%', borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="selected_students" label="下发学生（留空=全班）">
            <Select mode="tags" style={{ borderRadius: 8 }} placeholder="输入学生名后回车" />
          </Form.Item>
        </Form>
      </Modal>

      <div className="brand-watermark">Edu-TA 课程管理 · 全动态后端驱动</div>
    </div>
  );
};

export default CourseManagement;
