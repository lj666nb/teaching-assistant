/**
 * 布置作业 — 教师端作业发布与管理
 *
 * 功能：新建作业、查看提交、编辑、删除
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Button, Space, Modal, Form, Input, DatePicker, Select,
  Tag, Typography, message, Popconfirm, Tooltip, Empty, Drawer, Descriptions,
  List, Statistic, Row, Col,
} from 'antd';
import {
  PlusOutlined, FormOutlined, EyeOutlined, EditOutlined, DeleteOutlined,
  SendOutlined, TeamOutlined, ClockCircleOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { BRAND } from '../utils/brand';
import axios from 'axios';
import { API_BASE_URL } from '../api/base';
import dayjs from 'dayjs';
import '../styles/brand.css';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const api = axios.create({ baseURL: API_BASE_URL, timeout: 30000 });

const BrandBadge: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <span dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle' }} />
);

interface Assignment {
  id: string; course_id: string; course_name: string; teacher_name: string;
  title: string; content: string; deadline: string;
  selected_students: string[]; attachments: string[]; question_ids: string[];
  status: string; submission_count: number; graded_count: number;
  created_at: string; updated_at: string;
}

interface Submission {
  id: string; assignment_id: string; student_name: string;
  content: string; files: string[]; score: number; feedback: string;
  graded_by: string; status: string; submitted_at: string; graded_at: string;
}

const AssignmentPublish: React.FC = () => {
  const { username } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();

  // 提交查看抽屉
  const [subDrawerOpen, setSubDrawerOpen] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);

  // 批改弹窗
  const [gradeModalOpen, setGradeModalOpen] = useState(false);
  const [gradingSub, setGradingSub] = useState<Submission | null>(null);
  const [gradeScore, setGradeScore] = useState(0);
  const [gradeFeedback, setGradeFeedback] = useState('');

  const load = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    try {
      const res = await api.get('/assignments', { params: { teacher: username } });
      setAssignments(res.data?.data?.assignments || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [username]);

  useEffect(() => { load(); }, [load]);

  const handlePublish = async () => {
    try {
      const vals = await form.validateFields();
      const body = {
        ...vals,
        teacher_name: username,
        deadline: vals.deadline ? dayjs(vals.deadline).toISOString() : '',
        selected_students: vals.selected_students || [],
      };
      if (editingId) {
        await api.put(`/assignments/${editingId}`, body);
        message.success('作业已更新');
      } else {
        await api.post('/assignments', body);
        message.success('作业发布成功！学生将在"我的作业"中收到');
      }
      setModalOpen(false);
      setEditingId(null);
      form.resetFields();
      load();
    } catch { /* validation */ }
  };

  const handleEdit = (a: Assignment) => {
    setEditingId(a.id);
    form.setFieldsValue({
      course_name: a.course_name,
      title: a.title,
      content: a.content,
      deadline: a.deadline ? dayjs(a.deadline) : undefined,
      selected_students: a.selected_students,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/assignments/${id}`);
    message.success('已删除');
    load();
  };

  const viewSubmissions = async (a: Assignment) => {
    setSelectedAssignment(a);
    setSubLoading(true);
    setSubDrawerOpen(true);
    try {
      const res = await api.get(`/assignments/${a.id}/submissions`);
      setSubmissions(res.data?.data?.submissions || []);
    } catch { setSubmissions([]); }
    finally { setSubLoading(false); }
  };

  const openGrade = (sub: Submission) => {
    setGradingSub(sub);
    setGradeScore(sub.score || 0);
    setGradeFeedback(sub.feedback || '');
    setGradeModalOpen(true);
  };

  const handleGrade = async () => {
    if (!gradingSub) return;
    await api.put(`/assignments/submissions/${gradingSub.id}/grade`, {
      score: gradeScore,
      feedback: gradeFeedback,
      graded_by: username,
    });
    message.success('批改完成');
    setGradeModalOpen(false);
    if (selectedAssignment) viewSubmissions(selectedAssignment);
  };

  const statusTag = (s: string) => {
    const m: Record<string, { color: string; text: string }> = {
      published: { color: 'blue', text: '进行中' },
      closed: { color: 'default', text: '已截止' },
      draft: { color: 'orange', text: '草稿' },
    };
    const t = m[s] || { color: 'default', text: s };
    return <Tag color={t.color}>{t.text}</Tag>;
  };

  return (
    <div className="page-enter">
      <Card className="brand-card" style={{ marginBottom: 16 }}
        title={<Space><BrandBadge /><FormOutlined style={{ color: BRAND.colors.primary }} /><Text strong>作业列表</Text><Tag style={{ borderRadius: 6 }}>{assignments.length} 份</Tag></Space>}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingId(null); form.resetFields(); setModalOpen(true); }} style={{ borderRadius: 8 }}>布置新作业</Button>}>
        <Table dataSource={assignments} rowKey="id" loading={loading} pagination={{ pageSize: 8 }}
          locale={{ emptyText: <Empty description="暂无作业" image={Empty.PRESENTED_IMAGE_SIMPLE}><Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>布置新作业</Button></Empty> }}
          columns={[
            { title: '作业标题', dataIndex: 'title', render: (v: string) => <Text strong>{v}</Text> },
            { title: '课程', dataIndex: 'course_name', render: (v: string) => v ? <Tag>{v}</Tag> : '-' },
            { title: '截止时间', dataIndex: 'deadline', render: (v: string) => v ? dayjs(v).format('MM/DD HH:mm') : '不限' },
            { title: '状态', dataIndex: 'status', render: (v: string) => statusTag(v) },
            { title: '提交/批改', render: (_: any, r: Assignment) => <Text>{r.submission_count || 0}/{r.graded_count || 0}</Text> },
            { title: '操作', width: 260, render: (_: any, r: Assignment) => (
              <Space size={0}>
                <Tooltip title="查看提交"><Button type="link" size="small" icon={<EyeOutlined />}
                  style={{ color: BRAND.colors.primary }} onClick={() => viewSubmissions(r)}>提交</Button></Tooltip>
                <Tooltip title="编辑"><Button type="link" size="small" icon={<EditOutlined />}
                  onClick={() => handleEdit(r)}>编辑</Button></Tooltip>
                <Popconfirm title="确认删除此作业及所有提交？" onConfirm={() => handleDelete(r.id)}>
                  <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              </Space>
            )},
          ]} />
      </Card>

      {/* 发布/编辑弹窗 */}
      <Modal title={<Space><BrandBadge /><FormOutlined />{editingId ? '编辑作业' : '布置新作业'}</Space>}
        open={modalOpen} onCancel={() => { setModalOpen(false); setEditingId(null); form.resetFields(); }}
        onOk={handlePublish} okText={editingId ? '保存修改' : '发布作业'} width={600} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="course_name" label="课程名称" rules={[{ required: true, message: '请输入课程名称' }]}>
            <Input placeholder="如：机器学习" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="title" label="作业标题" rules={[{ required: true, message: '请输入作业标题' }]}>
            <Input placeholder="如：KNN算法编程作业" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="content" label="作业内容（Markdown）">
            <TextArea rows={5} placeholder="作业描述、要求、题目等..." style={{ borderRadius: 8 }} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="deadline" label="截止时间">
                <DatePicker showTime style={{ width: '100%', borderRadius: 8 }} placeholder="不限制" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="selected_students" label="下发学生（逗号分隔，留空=全班）">
                <Select mode="tags" style={{ borderRadius: 8 }} placeholder="输入学生名后回车" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 提交查看抽屉 */}
      <Drawer title={<Space><EyeOutlined />{selectedAssignment?.title} — 学生提交</Space>}
        open={subDrawerOpen} onClose={() => setSubDrawerOpen(false)} width={640}>
        {subLoading ? <Card loading /> : submissions.length === 0 ? <Empty description="暂无提交" /> : (
          <List dataSource={submissions} renderItem={(s: Submission) => (
            <Card key={s.id} size="small" style={{ marginBottom: 12 }}
              title={<Space><TeamOutlined /><Text strong>{s.student_name}</Text>
                <Tag color={s.status === 'graded' ? 'green' : s.status === 'submitted' ? 'blue' : 'default'}>
                  {s.status === 'graded' ? `已批改 · ${s.score}分` : s.status === 'submitted' ? '已提交' : '未提交'}
                </Tag>
              </Space>}
              extra={s.status !== 'pending' && <Button size="small" type="primary" icon={<CheckCircleOutlined />}
                onClick={() => openGrade(s)}>{s.status === 'graded' ? '修改评分' : '批改打分'}</Button>}>
              {s.content && <Paragraph ellipsis={{ rows: 2 }}>{s.content}</Paragraph>}
              {s.feedback && <Paragraph type="success" style={{ background: '#f6ffed', padding: 8, borderRadius: 6 }}>💬 {s.feedback}</Paragraph>}
              {s.submitted_at && <Text type="secondary" style={{ fontSize: 11 }}>提交于 {dayjs(s.submitted_at).format('MM/DD HH:mm')}</Text>}
            </Card>
          )} />
        )}
      </Drawer>

      {/* 批改弹窗 */}
      <Modal title="批改打分" open={gradeModalOpen} onOk={handleGrade} onCancel={() => setGradeModalOpen(false)} okText="确认">
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text strong>学生：</Text><Text>{gradingSub?.student_name}</Text>
          </div>
          <div>
            <Text strong>分数 (0-100)：</Text>
            <Input type="number" min={0} max={100} value={gradeScore}
              onChange={e => setGradeScore(Number(e.target.value))} style={{ width: 100, marginLeft: 8, borderRadius: 8 }} />
          </div>
          <div>
            <Text strong>评语：</Text>
            <TextArea rows={3} value={gradeFeedback}
              onChange={e => setGradeFeedback(e.target.value)} placeholder="对学生的作业进行点评..." style={{ borderRadius: 8 }} />
          </div>
        </Space>
      </Modal>
    </div>
  );
};

export default AssignmentPublish;
