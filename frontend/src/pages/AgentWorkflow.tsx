/**
 * Agent 编排工作台 — Edu-TA 智教星
 *
 * 可视化多步骤 Agent 工作流：
 * - 左侧：工作流选择 + 参数配置 + 历史记录
 * - 右侧：流程可视化（步骤节点 + 状态指示）+ 实时进度 + 最终报告
 *
 * 预置 2 大工作流：
 * 1. 班级诊断全流程（出题→批改→分析→建议）
 * 2. 智能备课→出题一站式
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Typography, Space, Row, Col, Button, Tag, Select, Input, InputNumber,
  Divider, Spin, Empty, message, Steps, Collapse, Descriptions, Statistic,
  Alert, List, Progress, Popconfirm, Badge, Tabs, Tooltip,
} from 'antd';
import {
  RobotOutlined, ThunderboltOutlined, PlayCircleOutlined, ReloadOutlined,
  ExperimentOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, SyncOutlined, HistoryOutlined, ApiOutlined,
  BranchesOutlined, ArrowRightOutlined, EyeOutlined, DeleteOutlined,
  FileTextOutlined, BarChartOutlined, BulbOutlined, TeamOutlined,
  FormOutlined, TrophyOutlined, WarningOutlined, LinkOutlined,
} from '@ant-design/icons';
import { agentApi } from '../api/client';
import { BRAND } from '../utils/brand';
import '../styles/brand.css';

const { Title, Text, Paragraph } = Typography;

const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', color || BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle' }} />
);

interface WorkflowType {
  type: string;
  name: string;
  description: string;
  params: { name: string; label: string; type: string; required: boolean; default?: any; placeholder?: string; options?: string[] }[];
}

interface StepStatus {
  agent_name: string;
  status: string;
  input_summary: string;
  output_text: string;
  error: string;
  duration_ms: number;
}

interface WorkflowResult {
  workflow_id: string;
  type: string;
  status: string;
  steps: StepStatus[];
  final_output: Record<string, any>;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#d9d9d9',
  running: '#1677ff',
  completed: '#52c41a',
  failed: '#ff4d4f',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  running: <SyncOutlined spin />,
  completed: <CheckCircleOutlined />,
  failed: <CloseCircleOutlined />,
};

const WF_ICONS: Record<string, React.ReactNode> = {
  class_diagnosis: <ExperimentOutlined />,
  lesson_to_exam: <FormOutlined />,
};

const AgentWorkflow: React.FC = () => {
  const [wfTypes, setWfTypes] = useState<WorkflowType[]>([]);
  const [selectedType, setSelectedType] = useState<string>('class_diagnosis');
  const [params, setParams] = useState<Record<string, any>>({});
  const [running, setRunning] = useState(false);
  const [currentWfId, setCurrentWfId] = useState<string>('');
  const [steps, setSteps] = useState<StepStatus[]>([]);
  const [finalOutput, setFinalOutput] = useState<Record<string, any> | null>(null);
  const [wfStatus, setWfStatus] = useState<string>('');
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const navigate = useNavigate();

  // 从最终输出中提取导航所需的 ID
  const planId = finalOutput?.["备课"]?.plan_id || '';
  const materialId = finalOutput?.["资料出题"]?.material_id || '';

  // 加载工作流类型
  useEffect(() => {
    agentApi.listTypes().then(res => {
      if (res.data.success) setWfTypes(res.data.data?.types || []);
    }).catch(() => {});
    loadHistory();
  }, []);

  const loadHistory = () => {
    setLoadingHistory(true);
    agentApi.listHistory().then(res => {
      if (res.data.success) setHistory(res.data.data?.workflows || []);
    }).catch(() => {}).finally(() => setLoadingHistory(false));
  };

  // 重置参数（切换工作流时）
  const currentType = wfTypes.find(t => t.type === selectedType);
  useEffect(() => {
    if (currentType) {
      const defaults: Record<string, any> = {};
      currentType.params.forEach(p => {
        if (p.default !== undefined) defaults[p.name] = p.default;
      });
      setParams(defaults);
    }
  }, [selectedType]);

  // 启动工作流
  const startWorkflow = async () => {
    if (!selectedType) return;
    // 验证必填参数
    if (currentType) {
      for (const p of currentType.params) {
        if (p.required && !params[p.name]) {
          message.warning(`请填写「${p.label}」`);
          return;
        }
      }
    }

    setRunning(true);
    setSteps([]);
    setFinalOutput(null);
    setWfStatus('running');

    try {
      const res = await agentApi.startWorkflow(selectedType, params);
      if (res.data.success) {
        const wfId = res.data.data?.workflow_id;
        setCurrentWfId(wfId);
        connectSSE(wfId);
        message.success('工作流已启动，正在执行...');
      } else {
        message.error(res.data.message || '启动失败');
        setRunning(false);
      }
    } catch (e: any) {
      message.error('启动失败: ' + (e.response?.data?.detail || e.message));
      setRunning(false);
    }
  };

  // 连接 SSE 实时进度
  const connectSSE = useCallback((wfId: string) => {
    // 断开旧连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const url = agentApi.progressUrl(wfId);
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'step_update') {
          setSteps(prev => {
            const existing = prev.findIndex(s => s.agent_name === data.step_name);
            const step: StepStatus = {
              agent_name: data.step_name,
              status: data.status,
              input_summary: data.summary || '',
              output_text: data.output_preview || '',
              error: '',
              duration_ms: 0,
            };
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = { ...updated[existing], ...step };
              return updated;
            }
            return [...prev, step];
          });
        } else if (data.event === 'workflow_done') {
          setWfStatus(data.status || 'completed');
          if (data.result) {
            setSteps(data.result.steps || []);
            setFinalOutput(data.result.final_output || null);
          }
          setRunning(false);
          es.close();
          eventSourceRef.current = null;
          loadHistory();
          if (data.status === 'completed') {
            message.success('工作流执行完成！');
          } else if (data.status === 'failed') {
            message.error('工作流执行失败');
          }
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // SSE 连接错误，可能是工作流已完成
      es.close();
      eventSourceRef.current = null;
      // 降级：轮询结果
      pollResult(wfId);
    };

    eventSourceRef.current = es;
  }, []);

  // 轮询降级
  const pollResult = async (wfId: string) => {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await agentApi.getResult(wfId);
        if (res.data.success) {
          const r = res.data.data;
          setSteps(r.steps || []);
          setFinalOutput(r.final_output || null);
          setWfStatus(r.status);
          if (r.status === 'completed' || r.status === 'failed') {
            setRunning(false);
            loadHistory();
            if (r.status === 'completed') message.success('工作流执行完成！');
            else message.error('工作流执行失败');
            return;
          }
        }
      } catch { break; }
    }
    setRunning(false);
  };

  // 清理 SSE
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  // 查看历史记录
  const viewHistory = async (wfId: string) => {
    setCurrentWfId(wfId);
    try {
      const res = await agentApi.getResult(wfId);
      if (res.data.success) {
        const r = res.data.data;
        setSteps(r.steps || []);
        setFinalOutput(r.final_output || null);
        setWfStatus(r.status);
        setSelectedType(r.type);
      }
    } catch { message.error('加载失败'); }
  };

  // 删除历史
  const deleteHistory = async (wfId: string) => {
    try {
      await agentApi.delete(wfId);
      message.success('已删除');
      loadHistory();
      if (currentWfId === wfId) {
        setCurrentWfId('');
        setSteps([]);
        setFinalOutput(null);
        setWfStatus('');
      }
    } catch { message.error('删除失败'); }
  };

  // ── 渲染最终报告 ──
  const renderFinalReport = () => {
    if (!finalOutput) return null;

    const renderStepOutput = (key: string, output: any, icon: React.ReactNode) => {
      if (!output) return null;
      const isFallback = output._fallback || output._mock;

      return (
        <Card size="small" className="brand-card" style={{ marginBottom: 12 }}
          title={<Space>{icon}<Text strong>{key}</Text>{isFallback && <Tag color="orange" style={{ fontSize: 10 }}>降级方案</Tag>}</Space>}>
          {/* 试卷 */}
          {output.exam_title && (
            <div>
              <Text strong style={{ fontSize: 14 }}>{output.exam_title}</Text>
              <Tag style={{ marginLeft: 8 }}>总分 {output.total_score}</Tag>
              <Tag>时限 {output.time_limit}min</Tag>
              {output.sections?.map((sec: any, si: number) => (
                <div key={si} style={{ marginTop: 8 }}>
                  <Text type="secondary">{sec.type}（{sec.difficulty}）共 {sec.questions?.length || 0} 题</Text>
                  <div style={{ maxHeight: 360, overflow: 'auto' }}>
                  {sec.questions?.map((q: any, qi: number) => (
                    <div key={qi} style={{ padding: '4px 8px', margin: '2px 0', background: '#fafafa', borderRadius: 4 }}>
                      <Tag style={{ fontSize: 10 }}>第{q.number}题</Tag>
                      <Text style={{ fontSize: 12 }}>{q.question?.slice(0, 80)}{(q.question || '').length > 80 ? '...' : ''}</Text>
                      <Tag color="blue" style={{ fontSize: 10 }}>{q.difficulty}</Tag>
                    </div>
                  ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 成绩汇总 */}
          {output.summary && (
            <Row gutter={12}>
              <Col span={6}><Statistic title="学生数" value={output.summary.total_students || output.summary.total_students} suffix="人" /></Col>
              <Col span={6}><Statistic title="平均分" value={output.summary.avg_score || output.summary.avg_percentage} suffix="分" /></Col>
              <Col span={6}><Statistic title="通过率" value={output.summary.pass_rate} suffix="%" /></Col>
              <Col span={6}>
                {output.summary.score_distribution && (
                  <div style={{ fontSize: 11 }}>
                    {Object.entries(output.summary.score_distribution).map(([k, v]) => (
                      <div key={k}>{k}: {v as number}人</div>
                    ))}
                  </div>
                )}
              </Col>
            </Row>
          )}

          {/* 指标 */}
          {output.metrics && (
            <Row gutter={12}>
              <Col span={6}><Statistic title="平均分" value={output.metrics.avg_score} suffix="分" /></Col>
              <Col span={6}><Statistic title="通过率" value={output.metrics.pass_rate} suffix="%" /></Col>
              <Col span={6}><Statistic title="优秀率" value={output.metrics.excellent_rate} suffix="%" /></Col>
              <Col span={6}><Statistic title="标准差" value={output.metrics.std_dev} /></Col>
            </Row>
          )}

          {/* 薄弱知识点 */}
          {output.weak_points && output.weak_points.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text strong style={{ fontSize: 12 }}>薄弱知识点：</Text>
              <Space wrap size={[4, 4]} style={{ marginTop: 4 }}>
                {output.weak_points.map((wp: any, i: number) => (
                  <Tag key={i} color="error" style={{ borderRadius: 6 }}>
                    {wp.name}（掌握率 {wp.avg_score_rate}%）
                  </Tag>
                ))}
              </Space>
            </div>
          )}

          {/* 预警学生 */}
          {output.warning_students && output.warning_students.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text strong style={{ fontSize: 12, color: BRAND.colors.error }}>⚠️ 预警学生：</Text>
              <Space wrap size={[4, 4]} style={{ marginTop: 4 }}>
                {output.warning_students.map((ws: any, i: number) => (
                  <Tag key={i} color="orange" style={{ borderRadius: 6 }}>{ws.name}（{ws.score}分）</Tag>
                ))}
              </Space>
            </div>
          )}

          {/* 分层 */}
          {output.class_tiers && (
            <div style={{ marginTop: 8 }}>
              <Row gutter={12}>
                <Col span={8}><Tag color="green">优秀层：{output.class_tiers.excellent?.length || 0}人</Tag></Col>
                <Col span={8}><Tag color="blue">中等层：{output.class_tiers.medium?.length || 0}人</Tag></Col>
                <Col span={8}><Tag color="red">薄弱层：{output.class_tiers.weak?.length || 0}人</Tag></Col>
              </Row>
            </div>
          )}

          {/* 教学策略 */}
          {output.class_strategy && (
            <Collapse size="small" style={{ marginTop: 8 }}
              items={[{
                key: 'strategy', label: '班级改进策略',
                children: (
                  <div>
                    <Text strong>教学调整：</Text>
                    <ul style={{ paddingLeft: 20, fontSize: 12 }}>
                      {output.class_strategy.teaching_adjustments?.map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                    <Text strong>课后作业：</Text>
                    <ul style={{ paddingLeft: 20, fontSize: 12 }}>
                      {output.class_strategy.homework_plan?.map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                ),
              }]}
            />
          )}

          {/* 薄弱点计划 */}
          {output.weak_point_plans && output.weak_point_plans.length > 0 && (
            <Collapse size="small" style={{ marginTop: 8 }}
              items={[{
                key: 'weak', label: `薄弱点突破计划（${output.weak_point_plans.length}项）`,
                children: output.weak_point_plans.map((wp: any, i: number) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <Text strong>{wp.point}</Text>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      目标：{wp.target} | 方法：{wp.method} | 时间：{wp.timeline}
                    </div>
                  </div>
                )),
              }]}
            />
          )}

          {/* 个性化方案 */}
          {output.individual_plans && output.individual_plans.length > 0 && (
            <Collapse size="small" style={{ marginTop: 8 }}
              items={[{
                key: 'individual', label: `个体辅导方案（${output.individual_plans.length}人）`,
                children: output.individual_plans.map((ip: any, i: number) => (
                  <Tag key={i} style={{ margin: 2 }}>{ip.student}: {ip.strategy}</Tag>
                )),
              }]}
            />
          )}

          {/* 下一步目标 */}
          {output.next_goals && (
            <div style={{ marginTop: 8 }}>
              <Text strong>下阶段目标：</Text>
              <ul style={{ paddingLeft: 20, fontSize: 12 }}>
                {output.next_goals.map((g: string, i: number) => <li key={i}>{g}</li>)}
              </ul>
              {output.expected_effect && <Text type="secondary" style={{ fontSize: 11 }}>{output.expected_effect}</Text>}
            </div>
          )}

          {/* ═══ 教案（备课Agent 输出）—— 与教学台账中心一致的质量 ═══ */}
          {output.sessions && (
            <div style={{ marginTop: 4 }}>
              {/* 课程基本信息 */}
              {output.course_name && (
                <Descriptions size="small" column={2} style={{ marginBottom: 8 }}
                  labelStyle={{ fontSize: 11, color: '#888' }} contentStyle={{ fontSize: 12 }}>
                  <Descriptions.Item label="课程">{output.course_name}</Descriptions.Item>
                  <Descriptions.Item label="章节">{output.chapter || '-'}</Descriptions.Item>
                  <Descriptions.Item label="课时">{output.total_hours ?? '-'} 课时</Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={output.is_fallback ? 'orange' : 'green'} style={{ borderRadius: 6, fontSize: 10 }}>
                      {output.is_fallback ? '模板教案' : 'AI 生成'}
                    </Tag>
                  </Descriptions.Item>
                </Descriptions>
              )}

              {/* 教学目标 */}
              {output.objectives && output.objectives.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 12 }}>🎯 教学目标</Text>
                  <Space wrap size={[4, 4]} style={{ marginTop: 4 }}>
                    {output.objectives.map((obj: any, i: number) => (
                      <Tag key={i} style={{ borderRadius: 6, fontSize: 11, background: `${BRAND.colors.primary}08`, color: BRAND.colors.primary, border: `1px solid ${BRAND.colors.primary}30` }}>
                        {obj.dimension && <Text style={{ fontSize: 10, color: BRAND.colors.primary, fontWeight: 600 }}>【{obj.dimension}】</Text>}
                        {obj.content || obj}
                      </Tag>
                    ))}
                  </Space>
                </div>
              )}

              {/* 教学方法 + 教学资源 */}
              <Row gutter={8} style={{ marginBottom: 8 }}>
                {output.methods && output.methods.length > 0 && (
                  <Col span={12}>
                    <Text strong style={{ fontSize: 12 }}>📝 教学方法</Text>
                    <div style={{ marginTop: 2 }}>
                      <Space wrap size={[2, 2]}>
                        {output.methods.map((m: string, i: number) => (
                          <Tag key={i} style={{ borderRadius: 6, fontSize: 10, background: `${BRAND.colors.purple}08`, color: BRAND.colors.purple, border: `1px solid ${BRAND.colors.purple}20` }}>{m}</Tag>
                        ))}
                      </Space>
                    </div>
                  </Col>
                )}
                {output.resources && output.resources.length > 0 && (
                  <Col span={12}>
                    <Text strong style={{ fontSize: 12 }}>📦 教学资源</Text>
                    <div style={{ marginTop: 2 }}>
                      <Space wrap size={[2, 2]}>
                        {output.resources.map((r: string, i: number) => (
                          <Tag key={i} style={{ borderRadius: 6, fontSize: 10, background: `${BRAND.colors.green}08`, color: BRAND.colors.green, border: `1px solid ${BRAND.colors.green}20` }}>{r}</Tag>
                        ))}
                      </Space>
                    </div>
                  </Col>
                )}
              </Row>

              {/* 教学流程 */}
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>📋 教学流程</Text>
              {output.sessions?.map((s: any, i: number) => (
                <div key={i} style={{ padding: '8px 10px', margin: '4px 0', background: '#f6ffed', borderRadius: 6, borderLeft: `3px solid ${BRAND.colors.primary}` }}>
                  <Space size={4} style={{ marginBottom: 4 }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: BRAND.colors.primaryGradient, color: '#fff', fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {s.session_order || i + 1}
                    </span>
                    <Text strong style={{ fontSize: 13, color: BRAND.colors.primary }}>{s.session_topic}</Text>
                  </Space>
                  {/* 重点难点 */}
                  {s.key_points && s.key_points.length > 0 && (
                    <div style={{ marginTop: 2 }}>
                      <Space wrap size={[2, 2]}>
                        {s.key_points.map((kp: string, j: number) => (
                          <Tag key={j} color="orange" style={{ borderRadius: 6, fontSize: 10 }}>📌 {kp}</Tag>
                        ))}
                      </Space>
                    </div>
                  )}
                  {/* 教学活动详情 */}
                  {s.activities && s.activities.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {s.activities.map((act: any, ai: number) => (
                        <div key={ai} style={{ padding: '6px 8px', margin: '3px 0', background: '#fafafa', borderRadius: 4 }}>
                          <Space size={4} style={{ marginBottom: 2 }}>
                            <Tag style={{ borderRadius: 6, fontSize: 9, background: `${BRAND.colors.primary}08`, border: 'none' }}>{act.duration}min</Tag>
                            <Tag style={{ borderRadius: 6, fontSize: 9, background: `${BRAND.colors.purple}08`, color: BRAND.colors.purple, border: 'none' }}>{act.activity_type}</Tag>
                            {act.teacher_activity && <Text style={{ fontSize: 9, color: BRAND.colors.purple }}>🎤有讲解脚本</Text>}
                            {act.example && <Text style={{ fontSize: 9, color: BRAND.colors.orange }}>📝有示例</Text>}
                          </Space>
                          <div style={{ fontSize: 12, lineHeight: 1.5, color: '#333' }}>{act.content}</div>
                          {act.teacher_activity && (
                            <div style={{ marginTop: 4, fontSize: 11, color: '#555', background: '#f0f5ff', padding: '4px 8px', borderRadius: 4, borderLeft: '2px solid #69b1ff' }}>
                              <Text type="secondary" style={{ fontSize: 9 }}>🎤 教师讲解：</Text>
                              {act.teacher_activity.length > 200 ? act.teacher_activity.slice(0, 200) + '...' : act.teacher_activity}
                            </div>
                          )}
                          {act.example && (
                            <div style={{ marginTop: 3, fontSize: 11, color: '#555', background: '#fff7e6', padding: '4px 8px', borderRadius: 4, borderLeft: '2px solid #ffa940' }}>
                              <Text type="secondary" style={{ fontSize: 9 }}>📝 教学示例：</Text>
                              {act.example.length > 200 ? act.example.slice(0, 200) + '...' : act.example}
                            </div>
                          )}
                        </div>
                      ))}
                      {/* 活动时长合计 */}
                      <Text type="secondary" style={{ fontSize: 10 }}>
                        本课时共 {s.activities.reduce((sum: number, a: any) => sum + (a.duration || 0), 0)} 分钟
                      </Text>
                    </div>
                  )}
                  {/* 课后作业（最后一条 session） */}
                  {s.homework && (
                    <div style={{ marginTop: 6, padding: '4px 8px', background: '#fff7e6', borderRadius: 4, fontSize: 11 }}>
                      <Text strong style={{ fontSize: 10 }}>📝 课后作业：</Text>
                      <div style={{ color: '#555', whiteSpace: 'pre-wrap' }}>
                        {typeof s.homework === 'string' ? s.homework.slice(0, 300) : JSON.stringify(s.homework).slice(0, 300)}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* 学情分析 */}
              {output.learner_analysis && Object.keys(output.learner_analysis).length > 0 && (
                <Collapse size="small" style={{ marginTop: 8 }}
                  items={[{
                    key: 'learner', label: <Text strong style={{ fontSize: 12 }}>🔍 学情分析</Text>,
                    children: (
                      <div style={{ fontSize: 11 }}>
                        {output.learner_analysis.common_misconceptions && output.learner_analysis.common_misconceptions.length > 0 && (
                          <div style={{ marginBottom: 4 }}>
                            <Text strong>常见误区：</Text>
                            <ul style={{ paddingLeft: 18, margin: '2px 0' }}>
                              {output.learner_analysis.common_misconceptions.map((m: string, i: number) => <li key={i}>{m}</li>)}
                            </ul>
                          </div>
                        )}
                        {output.learner_analysis.difficult_areas && output.learner_analysis.difficult_areas.length > 0 && (
                          <div style={{ marginBottom: 4 }}>
                            <Text strong>理解难点：</Text>
                            <ul style={{ paddingLeft: 18, margin: '2px 0' }}>
                              {output.learner_analysis.difficult_areas.map((d: string, i: number) => <li key={i}>{d}</li>)}
                            </ul>
                          </div>
                        )}
                        {output.learner_analysis.weak_abilities && output.learner_analysis.weak_abilities.length > 0 && (
                          <div>
                            <Text strong>能力薄弱点：</Text>
                            <ul style={{ paddingLeft: 18, margin: '2px 0' }}>
                              {output.learner_analysis.weak_abilities.map((w: string, i: number) => <li key={i}>{w}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    ),
                  }]}
                />
              )}

              {/* 降级提示 */}
              {output.is_fallback && (
                <Alert type="warning" showIcon style={{ marginTop: 8, borderRadius: 6, fontSize: 11 }}
                  message="模板教案（非 AI 生成）"
                  description="AI 大模型暂时不可用，当前显示的是结构化教学模板，建议在教学中台账中心编辑完善。" />
              )}
            </div>
          )}

          {/* ═══ 配套习题（资料出题Agent 输出）—— 完整题目展示 ═══ */}
          {output.sections && output.sections.length > 0 && output.sections[0]?.questions && (
            <div style={{ marginTop: 4 }}>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                📝 配套习题（共 {output.question_count || output.sections[0]?.questions?.length || 0} 题）
              </Text>
              {output.sections.map((sec: any, si: number) => (
                <div key={si}>
                  {sec.questions?.map((q: any, qi: number) => (
                    <div key={qi} style={{ padding: '8px 10px', margin: '4px 0', background: '#fafafa', borderRadius: 6, borderLeft: `3px solid ${BRAND.colors.orange}` }}>
                      <Space size={4} style={{ marginBottom: 4 }} wrap>
                        <Tag style={{ borderRadius: 6, fontSize: 10, background: BRAND.colors.primaryGradient, color: '#fff', border: 'none' }}>第{q.number || qi + 1}题</Tag>
                        <Tag color="blue" style={{ borderRadius: 6, fontSize: 10 }}>{q.type || '题目'}</Tag>
                        <Tag color={q.difficulty === '基础' ? 'green' : q.difficulty === '中等' ? 'blue' : q.difficulty === '提高' ? 'orange' : q.difficulty === '综合' ? 'purple' : 'red'}
                          style={{ borderRadius: 6, fontSize: 10 }}>{q.difficulty || '中等'}</Tag>
                        {q.knowledge_point && <Tag style={{ borderRadius: 6, fontSize: 9, background: '#f0f5ff' }}>{q.knowledge_point}</Tag>}
                        {q.estimated_time && <Text type="secondary" style={{ fontSize: 10 }}>⏱ {q.estimated_time}min</Text>}
                      </Space>
                      <div style={{ fontSize: 12, lineHeight: 1.6, color: '#333', marginBottom: 4 }}>{q.question}</div>
                      {/* 选择题选项 */}
                      {q.options && q.options.length > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          {q.options.map((opt: string, oi: number) => (
                            <Tag key={oi} style={{ borderRadius: 4, fontSize: 11, margin: '1px 3px 1px 0', background: '#f0f5ff' }}>{opt}</Tag>
                          ))}
                        </div>
                      )}
                      {/* 答案 + 解析 */}
                      {(q.answer || q.explanation) && (
                        <Collapse size="small" ghost
                          items={[{
                            key: `ans-${qi}`,
                            label: <Text style={{ fontSize: 11, color: BRAND.colors.primary }}>查看答案与解析</Text>,
                            children: (
                              <div style={{ fontSize: 11 }}>
                                {q.answer && (
                                  <div style={{ marginBottom: 4 }}>
                                    <Text strong style={{ color: '#389e0d' }}>✅ 答案：</Text>
                                    <Text>{q.answer}</Text>
                                  </div>
                                )}
                                {q.explanation && (
                                  <div style={{ marginBottom: 4 }}>
                                    <Text strong>💡 解析：</Text>
                                    <Text>{q.explanation}</Text>
                                  </div>
                                )}
                                {q.scoring_rubric && (
                                  <div style={{ marginBottom: 4 }}>
                                    <Text strong>📊 评分细则：</Text>
                                    <Text>{q.scoring_rubric}</Text>
                                  </div>
                                )}
                                {q.common_mistakes && (
                                  <div>
                                    <Text strong style={{ color: '#ff4d4f' }}>⚠️ 常见错误：</Text>
                                    <Text>{q.common_mistakes}</Text>
                                  </div>
                                )}
                              </div>
                            ),
                          }]}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* 降级出题方案 */}
          {output._fallback && output.sections && (
            <Alert type="warning" showIcon style={{ marginTop: 8, borderRadius: 6, fontSize: 11 }}
              message="模板习题（非 AI 生成）" description="AI 出题失败，当前为基础模板题目。" />
          )}

          {/* ═══ 课后作业建议（作业建议Agent 输出） ═══ */}
          {output.homework_plan && output.homework_plan.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text strong style={{ fontSize: 12 }}>📋 课后作业建议</Text>
              {output.homework_plan.map((hw: any, i: number) => (
                <div key={i} style={{ padding: '6px 8px', margin: '2px 0', background: '#f0f5ff', borderRadius: 4 }}>
                  <Tag color="blue" style={{ borderRadius: 6, fontSize: 10 }}>{hw.level || '作业'}</Tag>
                  <Text style={{ fontSize: 11 }}>{hw.content?.slice(0, 200) || hw}</Text>
                  {hw.answer_hint && <Tag color="green" style={{ fontSize: 9, marginLeft: 4 }}>提示</Tag>}
                </div>
              ))}
            </div>
          )}

          {/* 导航链接：备课 → 教学台账中心 / 资料出题 → 资料与题库 */}
          {key === '备课' && output.plan_id && (
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: `2px solid ${BRAND.colors.primary}15` }}>
              <Button
                type="primary" icon={<LinkOutlined />}
                style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, height: 34 }}
                onClick={() => navigate(`/lesson?plan_id=${output.plan_id}`)}
              >
                在教学台账中心查看完整教案
              </Button>
            </div>
          )}
          {key === '资料出题' && output.material_id && (
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: `2px solid ${BRAND.colors.primary}15` }}>
              <Button
                type="primary" icon={<LinkOutlined />}
                style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, height: 34 }}
                onClick={() => navigate(`/materials?material_id=${output.material_id}`)}
              >
                在资料与题库查看生成的题目
              </Button>
            </div>
          )}
          {key === '作业建议' && output.suggested_exercises && (
            <div style={{ marginTop: 8 }}>
              <Text strong style={{ fontSize: 12 }}>分层巩固练习：</Text>
              {output.suggested_exercises?.map((e: any, i: number) => (
                <div key={i} style={{ padding: '6px 8px', margin: '2px 0', background: '#fff7e6', borderRadius: 4 }}>
                  <Tag color="orange" style={{ borderRadius: 6, fontSize: 10 }}>{e.type || e.level || '练习'}</Tag>
                  <Text style={{ fontSize: 12 }}>{typeof e === 'string' ? e.slice(0, 150) : e.question?.slice(0, 150) || e.content?.slice(0, 150)}</Text>
                </div>
              ))}
            </div>
          )}
        </Card>
      );
    };

    const entries = Object.entries(finalOutput).filter(([k]) => k !== 'workflow_type');
    return (
      <div>
        <Divider><Text strong>📊 完整报告</Text></Divider>
        {entries.map(([key, output]) => renderStepOutput(key, output,
          key.includes('出题') || key.includes('Exam') ? <FileTextOutlined /> :
          key.includes('批改') || key.includes('Grade') ? <TrophyOutlined /> :
          key.includes('分析') || key.includes('Analysis') ? <BarChartOutlined /> :
          key.includes('建议') || key.includes('Plan') || key.includes('作业') ? <BulbOutlined /> :
          key.includes('备课') || key.includes('Lesson') ? <FormOutlined /> :
          key.includes('拔高') || key.includes('Enrich') ? <ArrowRightOutlined /> :
          key.includes('补差') || key.includes('Remedial') ? <WarningOutlined /> :
          <RobotOutlined />
        ))}
      </div>
    );
  };

  return (
    <div className="page-enter">
      {/* 页面头部 */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Space align="center" size={10}>
            <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 32, height: 32, display: 'inline-flex', animation: 'logoPulse 0.8s ease-out' }} />
            <div>
              <Title level={4} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: BRAND.colors.textPrimary }}>智教星 · Agent 编排工作台</Title>
              <Text type="secondary" style={{ fontSize: 11 }}>多步骤智能自动化流程 · 出题→批改→分析→建议全链路</Text>
            </div>
          </Space>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} onClick={loadHistory} style={{ borderRadius: 6 }}>刷新</Button>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* ── 左侧：工作流选择 + 参数配置 + 历史 ── */}
        <Col span={8}>
          {/* 工作流类型选择 */}
          <Card className="brand-card" size="small" style={{ marginBottom: 12 }}
            title={<Space><BrandBadge /><ThunderboltOutlined style={{ color: BRAND.colors.orange }} /><Text strong>预置工作流</Text></Space>}>
            {wfTypes.map(wt => (
              <Card
                key={wt.type}
                size="small"
                hoverable
                style={{
                  marginBottom: 8, cursor: 'pointer',
                  border: selectedType === wt.type ? `2px solid ${BRAND.colors.primary}` : undefined,
                  background: selectedType === wt.type ? `${BRAND.colors.primary}08` : undefined,
                }}
                onClick={() => { setSelectedType(wt.type); setSteps([]); setFinalOutput(null); setWfStatus(''); }}
              >
                <Space>
                  {WF_ICONS[wt.type] || <RobotOutlined />}
                  <div>
                    <Text strong style={{ fontSize: 13 }}>{wt.name}</Text>
                    <div><Text type="secondary" style={{ fontSize: 11 }}>{wt.description}</Text></div>
                    <Tag style={{ fontSize: 10, marginTop: 2 }}>
                      {wt.type === 'class_diagnosis' ? '4步链式' : '3步链式'}
                    </Tag>
                  </div>
                </Space>
              </Card>
            ))}
          </Card>

          {/* 参数配置 */}
          {currentType && (
            <Card className="brand-card" size="small" style={{ marginBottom: 12 }}
              title={<Space><ApiOutlined style={{ color: BRAND.colors.primary }} /><Text strong>参数配置</Text></Space>}>
              {currentType.params.map(p => (
                <div key={p.name} style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, marginBottom: 2, display: 'block' }}>
                    {p.label} {p.required && <Text type="danger">*</Text>}
                  </Text>
                  {p.type === 'number' ? (
                    <InputNumber
                      style={{ width: '100%', borderRadius: 6 }}
                      placeholder={p.placeholder}
                      value={params[p.name]}
                      onChange={v => setParams({ ...params, [p.name]: v })}
                      min={1} max={50}
                    />
                  ) : p.type === 'select' ? (
                    <Select
                      style={{ width: '100%', borderRadius: 6 }}
                      value={params[p.name]}
                      onChange={v => setParams({ ...params, [p.name]: v })}
                      options={(p.options || []).map(o => ({ value: o, label: o }))}
                    />
                  ) : p.type === 'multiselect' ? (
                    <Select
                      mode="multiple"
                      style={{ width: '100%', borderRadius: 6 }}
                      value={params[p.name]}
                      onChange={v => setParams({ ...params, [p.name]: v })}
                      options={(p.options || []).map(o => ({ value: o, label: o }))}
                    />
                  ) : p.type === 'textarea' ? (
                    <Input.TextArea
                      rows={3}
                      style={{ borderRadius: 6, resize: 'none' }}
                      placeholder={p.placeholder}
                      value={params[p.name] || ''}
                      onChange={e => setParams({ ...params, [p.name]: e.target.value })}
                    />
                  ) : (
                    <Input
                      style={{ borderRadius: 6 }}
                      placeholder={p.placeholder}
                      value={params[p.name] || ''}
                      onChange={e => setParams({ ...params, [p.name]: e.target.value })}
                    />
                  )}
                </div>
              ))}
              <Button
                type="primary"
                block
                icon={running ? <SyncOutlined spin /> : <PlayCircleOutlined />}
                onClick={startWorkflow}
                loading={running}
                disabled={running}
                style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, marginTop: 8 }}
              >
                {running ? '执行中...' : '启动工作流'}
              </Button>
            </Card>
          )}

          {/* 历史记录 */}
          <Card className="brand-card" size="small"
            title={<Space><HistoryOutlined style={{ color: BRAND.colors.purple }} /><Text strong>历史记录</Text></Space>}
            extra={<Button type="link" size="small" loading={loadingHistory} onClick={loadHistory}>刷新</Button>}
            bodyStyle={{ padding: '4px 12px', maxHeight: 320, overflow: 'auto' }}>
            {history.length === 0 ? (
              <Empty description="暂无历史记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <List size="small" dataSource={history}
                renderItem={item => (
                  <List.Item
                    style={{ cursor: 'pointer', padding: '6px 4px', borderRadius: 6,
                      background: currentWfId === item.id ? `${BRAND.colors.primary}08` : undefined }}
                    onClick={() => viewHistory(item.id)}
                    actions={[
                      <Popconfirm title="删除此记录？" onConfirm={e => { e?.stopPropagation(); deleteHistory(item.id); }}>
                        <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ fontSize: 11 }}
                          onClick={e => e.stopPropagation()} />
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={WF_ICONS[item.type] || <RobotOutlined />}
                      title={
                        <Text style={{ fontSize: 12 }}>
                          {item.course_name ? (
                            <Space size={4}>
                              <Text strong>{item.course_name}</Text>
                              {item.chapter && <Text type="secondary" style={{ fontSize: 11 }}>— {item.chapter}</Text>}
                            </Space>
                          ) : (item.name || item.type)}
                        </Text>
                      }
                      description={
                        <Space size={4}>
                          <Badge status={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'running' ? 'processing' : 'default'} />
                          <Text style={{ fontSize: 10 }}>{item.created_at?.slice(0, 16)}</Text>
                          {item.name && item.course_name && (
                            <Tag style={{ fontSize: 9, borderRadius: 4, lineHeight: '16px' }}>{item.name}</Tag>
                          )}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* ── 右侧：流程可视化 + 进度 + 结果 ── */}
        <Col span={16}>
          <Card className="brand-card"
            title={<Space><BrandBadge /><ExperimentOutlined style={{ color: BRAND.colors.primary }} /><Text strong>工作流执行面板</Text></Space>}
            extra={wfStatus && (
              <Tag color={wfStatus === 'completed' ? 'success' : wfStatus === 'failed' ? 'error' : 'processing'}
                style={{ borderRadius: 6 }}>
                {wfStatus === 'completed' ? '已完成' : wfStatus === 'failed' ? '失败' : '执行中'}
              </Tag>
            )}
            bodyStyle={{ padding: '16px 20px', minHeight: 520 }}>
            {steps.length === 0 && !running && !finalOutput ? (
              <div style={{ textAlign: 'center', padding: 80 }}>
                <ThunderboltOutlined style={{ fontSize: 48, color: BRAND.colors.border }} />
                <Paragraph style={{ marginTop: 16, color: BRAND.colors.textTertiary }}>
                  选择左侧工作流类型，填写参数后点击「启动工作流」
                </Paragraph>
                <Paragraph style={{ color: BRAND.colors.textTertiary, fontSize: 12 }}>
                  Agent 编排将自动串联多步骤 AI 流程，实时展示进度
                </Paragraph>
              </div>
            ) : (
              <div>
                {/* 流程可视化 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 20 }}>
                  {steps.map((step, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && step.agent_name !== 'branch' && (
                        <ArrowRightOutlined style={{ color: BRAND.colors.border, fontSize: 16 }} />
                      )}
                      <Tooltip title={`${step.input_summary || step.agent_name} — ${step.status}`}>
                        <div style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 14px',
                          borderRadius: 12, border: `2px solid ${STATUS_COLORS[step.status] || '#d9d9d9'}`,
                          background: `${STATUS_COLORS[step.status] || '#d9d9d9'}10`,
                          minWidth: 80, transition: 'all 0.3s',
                        }}>
                          <span style={{ fontSize: 18, color: STATUS_COLORS[step.status] || '#d9d9d9' }}>
                            {STATUS_ICONS[step.status] || <ClockCircleOutlined />}
                          </span>
                          <Text strong style={{ fontSize: 12, marginTop: 2 }}>{step.agent_name}</Text>
                          {step.duration_ms > 0 && (
                            <Text type="secondary" style={{ fontSize: 10 }}>{(step.duration_ms / 1000).toFixed(1)}s</Text>
                          )}
                        </div>
                      </Tooltip>
                    </React.Fragment>
                  ))}
                </div>

                {/* 步骤详情 */}
                {steps.map((step, i) => (
                  <Card key={i} size="small" style={{ marginBottom: 8 }}
                    title={
                      <Space>
                        <span style={{ color: STATUS_COLORS[step.status] }}>{STATUS_ICONS[step.status]}</span>
                        <Text strong style={{ fontSize: 13 }}>{step.agent_name}</Text>
                        <Tag color={step.status === 'completed' ? 'success' : step.status === 'failed' ? 'error' : 'processing'}
                          style={{ borderRadius: 6, fontSize: 10 }}>{step.status}</Tag>
                        {step.duration_ms > 0 && <Text type="secondary" style={{ fontSize: 11 }}>{(step.duration_ms / 1000).toFixed(1)}s</Text>}
                      </Space>
                    }>
                    {step.error ? (
                      <Alert type="error" message={step.error} style={{ borderRadius: 6 }} />
                    ) : (
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>{step.input_summary}</Text>
                        {step.output_text && (
                          <Paragraph style={{ marginTop: 4, fontSize: 12, background: '#fafafa', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                            {step.output_text.length > 300 ? step.output_text.slice(0, 300) + '...' : step.output_text}
                          </Paragraph>
                        )}
                        {/* 导航按钮：备课 → 教学台账中心 / 资料出题 → 资料与题库 */}
                        {step.status === 'completed' && step.agent_name === '备课' && (
                          <Button
                            type="link" size="small" icon={<LinkOutlined />}
                            style={{ padding: 0, marginTop: 4, fontSize: 12 }}
                            onClick={() => navigate(planId ? `/lesson?plan_id=${planId}` : '/lesson')}
                          >
                            在教学台账中心查看教案
                          </Button>
                        )}
                        {step.status === 'completed' && step.agent_name === '资料出题' && (
                          <Button
                            type="link" size="small" icon={<LinkOutlined />}
                            style={{ padding: 0, marginTop: 4, fontSize: 12 }}
                            onClick={() => navigate(materialId ? `/materials?material_id=${materialId}` : '/materials')}
                          >
                            在资料与题库查看生成的题目
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                ))}

                {/* 最终报告 */}
                {renderFinalReport()}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <div className="brand-watermark">Edu-TA Agent 编排 · 多步骤智能自动化</div>
    </div>
  );
};

export default AgentWorkflow;
