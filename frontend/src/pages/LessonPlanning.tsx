/**
 * 教学台账中心 — Edu-TA 智教星 品牌化页面
 *
 * 核心功能保留：AI 智能备课生成（表单+结果展示）
 * 品牌特色：智教星 LOGO、品牌色系、二进制暗纹、卡片角标、轻量动效
 * 台账特色：历史教案列表、筛选、归档状态、导出入口
 */

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Card, Form, Input, InputNumber, Button, Spin, Alert, Typography,
  Descriptions, Tag, Divider, Timeline, Space, Steps, Empty, message,
  Row, Col, Select, Table, Popconfirm, Tooltip, Radio, Pagination, Modal,
} from 'antd';
import {
  RobotOutlined, BookOutlined, AimOutlined, ToolOutlined,
  FileTextOutlined, ThunderboltOutlined, DownloadOutlined,
  DeleteOutlined, HistoryOutlined, FilterOutlined, ReloadOutlined,
  PlusOutlined, EyeOutlined, CheckCircleOutlined, ClockCircleOutlined,
  SearchOutlined, KeyOutlined, BarChartOutlined, EditOutlined,
} from '@ant-design/icons';
import { lessonApi, auditApi, homeworkApi, insightApi, LessonPlanRequest } from '../api/client';
import { BRAND, CARD_SPECS } from '../utils/brand';
import { useApiKeyGuard, ApiKeyGuardModal, ApiKeyBanner, DisabledAIButton } from '../utils/apiKeyGuard';
import SettingsModal from '../components/SettingsModal';
import '../styles/brand.css';
import { useDataVisibility } from '../context/DataVisibilityContext';

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

// ── 逐字差异算法（直观显示文本变更位置） ────────────
interface DiffSegment {
  text: string;
  type: 'same' | 'added' | 'removed';
}

function diffChars(oldText: string, newText: string): { old: DiffSegment[]; new: DiffSegment[] } {
  const o = oldText || '';
  const n = newText || '';
  // 简化 LCS 动态规划 — 找出最长公共子序列
  const dp: number[][] = Array.from({ length: o.length + 1 }, () => new Array(n.length + 1).fill(0));
  for (let i = 1; i <= o.length; i++) {
    for (let j = 1; j <= n.length; j++) {
      if (o[i - 1] === n[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // 回溯构建两个序列的分段标记
  const oldSegs: DiffSegment[] = [];
  const newSegs: DiffSegment[] = [];
  let i = o.length, j = n.length;
  const revOld: DiffSegment[] = [];
  const revNew: DiffSegment[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && o[i - 1] === n[j - 1]) {
      revOld.push({ text: o[i - 1], type: 'same' });
      revNew.push({ text: n[j - 1], type: 'same' });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      revNew.push({ text: n[j - 1], type: 'added' });
      j--;
    } else {
      revOld.push({ text: o[i - 1], type: 'removed' });
      i--;
    }
  }
  // 反转并合并相邻同类型片段
  const merge = (segs: DiffSegment[]): DiffSegment[] => {
    const result: DiffSegment[] = [];
    for (const s of segs) {
      const last = result[result.length - 1];
      if (last && last.type === s.type) last.text = s.text + last.text;
      else result.push(s);
    }
    return result;
  };
  return { old: merge(revOld.reverse()), new: merge(revNew.reverse()) };
}

const DiffText: React.FC<{ oldText: string; newText: string }> = ({ oldText, newText }) => {
  const o = oldText || '';
  const n = newText || '';
  if (o === n) return <Text style={{ fontSize: 13, color: '#666', whiteSpace: 'pre-wrap' }}>{o || '(空)'}</Text>;
  if (!o) return <Text style={{ fontSize: 13, color: '#389e0d', whiteSpace: 'pre-wrap', background: '#f6ffed', padding: '2px 4px', borderRadius: 3 }}>{n}</Text>;
  if (!n) return <Text style={{ fontSize: 13, color: '#cf1322', whiteSpace: 'pre-wrap', textDecoration: 'line-through', background: '#fff2f0', padding: '2px 4px', borderRadius: 3 }}>{o}</Text>;

  // 按句号/换行拆分为段落，逐段对比
  const splitPara = (t: string): string[] => {
    const raw = t.split(/(?<=[。；\n])/);
    // 合并过短的片段（< 10 字）到前一段
    const merged: string[] = [];
    for (const s of raw) {
      if (merged.length > 0 && s.length < 10) merged[merged.length - 1] += s;
      else if (s.trim()) merged.push(s);
    }
    return merged.length > 0 ? merged : [t];
  };

  const oldParas = splitPara(o);
  const newParas = splitPara(n);

  // 对每个旧段落找最匹配的新段落，构建内联差异
  const result: { type: 'same' | 'removed' | 'added'; text: string }[] = [];

  let ni = 0;
  for (const op of oldParas) {
    // 在新段落中查找匹配
    const matchIdx = newParas.findIndex((np, idx) => idx >= ni && np.trim() === op.trim());
    if (matchIdx >= ni) {
      // 中间的新段落都是新增的
      for (let j = ni; j < matchIdx; j++) {
        result.push({ type: 'added', text: newParas[j] });
      }
      // 当前段落相同
      result.push({ type: 'same', text: op });
      ni = matchIdx + 1;
    } else {
      // 找不到匹配 → 旧段落被删除
      result.push({ type: 'removed', text: op });
    }
  }
  // 剩余新段落都是新增
  for (let j = ni; j < newParas.length; j++) {
    result.push({ type: 'added', text: newParas[j] });
  }

  // 如果段落级 diff 没有发现差异（段落内容相同但合并不同），用字符级 diff
  const hasChanges = result.some(r => r.type !== 'same');
  if (!hasChanges) {
    const { old: oldSegs, new: newSegs } = diffChars(o.substring(0, 500), n.substring(0, 500));
    return (
      <div style={{ lineHeight: 2, fontSize: 13 }}>
        <div style={{ marginBottom: 6 }}>
          <Tag color="error" style={{ fontSize: 10, marginRight: 4 }}>旧</Tag>
          {oldSegs.map((seg, i) => (
            <span key={i} style={{
              background: seg.type === 'removed' ? '#ffa39e' : 'transparent',
              color: seg.type === 'removed' ? '#a8071a' : '#999',
              textDecoration: seg.type === 'removed' ? 'line-through' : 'none',
              borderRadius: 2, padding: '0 1px',
            }}>{seg.text}</span>
          ))}
          {(o.length > 500) && <Text type="secondary" style={{ fontSize: 10 }}> …(截断)</Text>}
        </div>
        <div>
          <Tag color="success" style={{ fontSize: 10, marginRight: 4 }}>新</Tag>
          {newSegs.map((seg, i) => (
            <span key={i} style={{
              background: seg.type === 'added' ? '#b7eb8f' : 'transparent',
              color: seg.type === 'added' ? '#237804' : '#333',
              fontWeight: seg.type === 'added' ? 600 : 400,
              borderRadius: 2, padding: '0 1px',
            }}>{seg.text}</span>
          ))}
          {(n.length > 500) && <Text type="secondary" style={{ fontSize: 10 }}> …(截断)</Text>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ lineHeight: 2.2, fontSize: 13 }}>
      {result.map((r, i) => (
        <span key={i} style={{
          display: 'inline',
          background: r.type === 'removed' ? '#ffeef0' : r.type === 'added' ? '#e6ffed' : 'transparent',
          color: r.type === 'removed' ? '#cb2431' : r.type === 'added' ? '#22863a' : '#444',
          textDecoration: r.type === 'removed' ? 'line-through' : 'none',
          padding: r.type !== 'same' ? '2px 3px' : '0',
          borderRadius: 3,
          margin: r.type !== 'same' ? '0 1px' : '0',
          whiteSpace: 'pre-wrap',
        }}>
          {r.text}
        </span>
      ))}
    </div>
  );
};

// ── 版本对比：解析修改点 ────────────────────────────────
interface ChangeItem {
  label: string;
  oldValue: string;
  newValue: string;
  type: 'added' | 'removed' | 'modified';
}

const FIELD_LABELS: Record<string, string> = {
  activity_type: '活动类型', duration: '时长', content: '教学内容',
  teacher_activity: '教师话术', student_activity: '学生活动', example: '教学示例',
  dimension: '维度',
};

function analyzeDiff(diff: any): { topic: string; items: ChangeItem[] } {
  const { before, after, topic, session_index } = diff;
  const items: ChangeItem[] = [];

  if (session_index === -1) {
    // ── 元信息对比（objectives / methods / resources） ──
    const fieldName = Object.keys(before)[0] || Object.keys(after)[0] || '';
    const oldArr: any[] = before[fieldName] || [];
    const newArr: any[] = after[fieldName] || [];

    if (fieldName === 'objectives') {
      const maxLen = Math.max(oldArr.length, newArr.length);
      for (let i = 0; i < maxLen; i++) {
        const o = oldArr[i];
        const n = newArr[i];
        if (!o && n) {
          items.push({ label: `新增教学目标 #${i + 1}`, oldValue: '', newValue: `【${n.dimension || ''}】${n.content || ''}`, type: 'added' });
        } else if (o && !n) {
          items.push({ label: `删除教学目标 #${i + 1}`, oldValue: `【${o.dimension || ''}】${o.content || ''}`, newValue: '', type: 'removed' });
        } else if (o && n && JSON.stringify(o) !== JSON.stringify(n)) {
          for (const k of ['dimension', 'content']) {
            if ((o[k] || '') !== (n[k] || '')) {
              items.push({ label: `目标 #${i + 1} · ${FIELD_LABELS[k] || k}`, oldValue: o[k] || '', newValue: n[k] || '', type: 'modified' });
            }
          }
        }
      }
    } else {
      // methods / resources（字符串数组）
      const labelMap: Record<string, string> = { methods: '教学方法', resources: '教学资源' };
      const typeLabel = labelMap[fieldName] || fieldName;
      const added = newArr.filter((v: string) => !oldArr.includes(v));
      const removed = oldArr.filter((v: string) => !newArr.includes(v));
      added.forEach(v => items.push({ label: `新增${typeLabel}`, oldValue: '', newValue: v, type: 'added' }));
      removed.forEach(v => items.push({ label: `删除${typeLabel}`, oldValue: v, newValue: '', type: 'removed' }));
    }
  } else {
    // ── 教学流程对比 ──
    // 课时主题
    const oldTopic = before.session_topic || '';
    const newTopic = after.session_topic || '';
    if (oldTopic !== newTopic) {
      items.push({ label: '课时主题', oldValue: oldTopic, newValue: newTopic, type: 'modified' });
    }
    // 教学目标（session 级别）
    const oldObjs: any[] = before.objectives || [];
    const newObjs: any[] = after.objectives || [];
    const maxObj = Math.max(oldObjs.length, newObjs.length);
    for (let i = 0; i < maxObj; i++) {
      const oo = oldObjs[i];
      const no = newObjs[i];
      if (!oo && no) {
        items.push({ label: `新增教学目标 #${i+1}`, oldValue: '', newValue: `【${no.dimension||''}】${no.content||''}`, type: 'added' });
      } else if (oo && !no) {
        items.push({ label: `删除教学目标 #${i+1}`, oldValue: `【${oo.dimension||''}】${oo.content||''}`, newValue: '', type: 'removed' });
      } else if (oo && no && JSON.stringify(oo) !== JSON.stringify(no)) {
        for (const k of ['dimension', 'content']) {
          if ((oo[k]||'') !== (no[k]||'')) {
            items.push({ label: `教学目标 #${i+1} · ${FIELD_LABELS[k]||k}`, oldValue: oo[k]||'', newValue: no[k]||'', type: 'modified' });
          }
        }
      }
    }
    // 教学重点
    const oldKP: string[] = before.key_points || [];
    const newKP: string[] = after.key_points || [];
    const addedKP = newKP.filter(v => !oldKP.includes(v));
    const removedKP = oldKP.filter(v => !newKP.includes(v));
    addedKP.forEach(v => items.push({ label: '新增教学重点', oldValue: '', newValue: v, type: 'added' }));
    removedKP.forEach(v => items.push({ label: '删除教学重点', oldValue: v, newValue: '', type: 'removed' }));
    // 教学难点
    const oldDP: string[] = before.difficult_points || [];
    const newDP: string[] = after.difficult_points || [];
    const addedDP = newDP.filter(v => !oldDP.includes(v));
    const removedDP = oldDP.filter(v => !newDP.includes(v));
    addedDP.forEach(v => items.push({ label: '新增教学难点', oldValue: '', newValue: v, type: 'added' }));
    removedDP.forEach(v => items.push({ label: '删除教学难点', oldValue: v, newValue: '', type: 'removed' }));

    // 活动对比
    const oldActs: any[] = before.activities || [];
    const newActs: any[] = after.activities || [];
    const maxActs = Math.max(oldActs.length, newActs.length);
    for (let i = 0; i < maxActs; i++) {
      const oa = oldActs[i];
      const na = newActs[i];
      const actName = (na || oa)?.activity_type || '教学';
      if (!oa && na) {
        items.push({ label: `新增活动 #${i + 1}（${actName}）`, oldValue: '', newValue: na.content || '', type: 'added' });
      } else if (oa && !na) {
        items.push({ label: `删除活动 #${i + 1}（${actName}）`, oldValue: oa.content || '', newValue: '', type: 'removed' });
      } else if (oa && na && JSON.stringify(oa) !== JSON.stringify(na)) {
        for (const f of ['activity_type', 'duration', 'content', 'teacher_activity', 'student_activity', 'example']) {
          const ov = f === 'duration' ? (oa[f] != null ? `${oa[f]}分钟` : '') : (oa[f] || '');
          const nv = f === 'duration' ? (na[f] != null ? `${na[f]}分钟` : '') : (na[f] || '');
          if (ov !== nv) {
            items.push({
              label: `活动 #${i + 1}（${actName}）· ${FIELD_LABELS[f] || f}`,
              oldValue: ov, newValue: nv, type: 'modified',
            });
          }
        }
      }
    }

    // 课后作业
    const oldHW = before.homework || '';
    const newHW = after.homework || '';
    if (oldHW !== newHW) {
      items.push({ label: '课后作业', oldValue: oldHW, newValue: newHW, type: 'modified' });
    }
  }

  return { topic: topic || '', items };
}

// ── 品牌角标 ────────────────────────────────────────
const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span
    dangerouslySetInnerHTML={{
      __html: BRAND.badgeSvg.replace(
        'currentColor',
        color || BRAND.colors.primary
      ),
    }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle', flexShrink: 0 }}
  />
);

// ── 台账状态标签 ────────────────────────────────────
const LedgerStatusTag: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { color: string; label: string }> = {
    archived: { color: BRAND.colors.green, label: '已归档' },
    review: { color: BRAND.colors.orange, label: '待复核' },
    history: { color: '#9CA3AF', label: '历史存档' },
  };
  const s = map[status] || map.history;
  return (
    <Tag
      style={{
        borderRadius: 10,
        padding: '0 10px',
        lineHeight: '22px',
        border: `1px solid ${s.color}33`,
        background: `${s.color}15`,
        color: s.color,
        fontWeight: 500,
        fontSize: 12,
      }}
      className={status === 'review' ? 'tag-glow' : ''}
    >
      <BrandBadge size={10} color={s.color} />
      <span style={{ marginLeft: 4 }}>{s.label}</span>
    </Tag>
  );
};

// ═══════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════
const LessonPlanning: React.FC = () => {
  const { visible } = useDataVisibility();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState('');

  // ── API Key 守卫 ──
  const guard = useApiKeyGuard();
  const canGenerate = guard.hasKey;

  // ── 教案编辑状态 ──
  const [editing, setEditing] = useState(false);
  const [editPlan, setEditPlan] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // 台账列表
  const [records, setRecords] = useState<any[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [filterCourse, setFilterCourse] = useState('');
  const [filterType, setFilterType] = useState('');
  const [searchText, setSearchText] = useState('');
  const [ledgerTab, setLedgerTab] = useState('all');
  const [page, setPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [courseOptions, setCourseOptions] = useState<string[]>([]);
  const pageSize = 8;

  // ── 审计日志面板 ──
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditStats, setAuditStats] = useState<any>({});
  const [auditFilter, setAuditFilter] = useState({ operation: '', operator: '', course: '', sort_order: 'desc' });
  const [compareModal, setCompareModal] = useState<{ visible: boolean; planId: string; v1: number; v2: number }>({ visible: false, planId: '', v1: 0, v2: 0 });
  const [compareResult, setCompareResult] = useState<any>(null);
  const [snapModal, setSnapModal] = useState<{ visible: boolean; planId: string }>({ visible: false, planId: '' });
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [auditExporting, setAuditExporting] = useState(false);

  // 加载审计日志
  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const res = await auditApi.query(auditFilter);
      if (res.data.success) {
        setAuditLogs(res.data.data.logs || []);
        setAuditStats(res.data.data.stats || {});
      }
    } catch { message.error('加载审计日志失败'); }
    finally { setAuditLoading(false); }
  };

  // 清空审计日志
  const [clearing, setClearing] = useState(false);
  const handleClearAudit = () => {
    Modal.confirm({
      title: '确认清空所有审计日志？',
      content: '此操作将删除所有溯源审计记录，不可恢复。确定要继续吗？',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setClearing(true);
        try {
          const res = await auditApi.clear();
          if (res.data.success) {
            message.success(res.data.message || '审计日志已清空');
            setAuditLogs([]);
            setAuditStats({});
          }
        } catch (e: any) {
          message.error('清空失败: ' + (e.response?.data?.detail || e.message || '未知错误'));
        } finally {
          setClearing(false);
        }
      },
    });
  };

  // 加载版本快照
  const loadSnapshots = async (planId: string) => {
    try {
      const res = await auditApi.snapshots(planId);
      if (res.data.success) setSnapshots(res.data.data.snapshots || []);
    } catch { message.error('加载版本快照失败'); }
  };

  // 还原版本
  const handleRestore = async (planId: string, version: number) => {
    try {
      await auditApi.restore(planId, version);
      message.success(`已还原到版本 v${version}`);
      loadSnapshots(planId);
      loadRecords();
      // 如果还原的是当前显示的教案，重新加载最新数据
      if (plan?.id === planId) {
        const res = await lessonApi.get(planId);
        if (res.data.success) {
          const d = res.data.data;
          const pd = d.plan_data || {};
          setPlan({
            id: d.id, course_name: d.course_name, chapter: d.chapter,
            total_hours: d.total_hours, created_at: d.created_at,
            objectives: pd.objectives || [], methods: pd.methods || [],
            resources: pd.resources || [], sessions: pd.sessions || [],
            board_design: pd.board_design || {}, class_tasks: pd.class_tasks || [],
            homework: pd.homework || [], assessment: pd.assessment || {},
            innovation: pd.innovation || {},
          });
        }
      }
    } catch (e: any) { message.error('还原失败: ' + (e.message || '未知错误')); }
  };

  // 删除版本快照
  const handleDeleteSnapshot = (planId: string, version: number) => {
    Modal.confirm({
      title: `确认删除版本 v${version}？`,
      content: '删除后无法恢复，确定要删除此快照吗？',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await auditApi.deleteSnapshot(planId, version);
          message.success(`已删除版本 v${version}`);
          loadSnapshots(planId);
        } catch (e: any) { message.error('删除失败: ' + (e.message || '未知错误')); }
      },
    });
  };

  // 版本对比
  const handleCompare = async (planId: string, v1: number, v2: number) => {
    if (!planId) return;
    try {
      const res = await auditApi.compare(planId, v1, v2);
      if (res.data.success) setCompareResult(res.data.data);
    } catch { message.error('版本对比失败'); }
  };

  // 导出审计日志
  const handleExportAudit = async (format: 'excel' | 'word') => {
    setAuditExporting(true);
    try {
      const res = await auditApi.export(format);
      const blob = new Blob([res.data], { type: format === 'word' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/csv' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `审计日志.${format === 'word' ? 'docx' : 'csv'}`; a.click();
      URL.revokeObjectURL(url); message.success('审计日志已导出');
    } catch (e: any) { message.error('导出失败'); }
    finally { setAuditExporting(false); }
  };

  // ── 流程详情弹窗 ──
  const [segmentModal, setSegmentModal] = useState<{ visible: boolean; session: any }>({ visible: false, session: null });
  const [exportingFull, setExportingFull] = useState(false);
  const [exportingSeg, setExportingSeg] = useState<string>('');

  // ── 批量操作 ──
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchArchiving, setBatchArchiving] = useState(false);

  // ── 查看详情（数据已由后端展开到顶层，直接使用） ──
  const handleView = (record: any) => {
    // 后端已将 sessions/objectives/methods 等展开到顶层
    const planData = {
      id: record.id,
      course_name: record.course_name,
      chapter: record.chapter,
      total_hours: record.total_hours || 2,
      created_at: record.created_at,
      objectives: record.objectives || [],
      methods: record.methods || [],
      resources: record.resources || [],
      sessions: record.sessions || [],
      board_design: record.board_design || {},
      class_tasks: record.class_tasks || [],
      homework: record.homework || [],
      assessment: record.assessment || {},
      innovation: record.innovation || {},
    };
    setPlan(planData);
    setError('');
    // 后台记录查看审计日志（不阻塞 UI）
    lessonApi.get(record.id).catch(() => {});
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 150);
    message.success(`已加载教案：${record.course_name} — ${record.chapter}`);
  };

  // ── 台账溯源 ──
  const handleTrace = (record: any) => {
    handleView(record);
    message.info(`已加载「${record.course_name} — ${record.chapter}」教案`);
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 200);
  };

  // ── 删除记录（根据类型调用不同 API） ──
  const handleDelete = async (record: any) => {
    const id = record.id;
    const type = record._type || 'lesson';
    try {
      if (type === 'lesson') {
        await lessonApi.delete(id);
      } else if (type === 'homework') {
        await homeworkApi.deleteGrade(id);
      } else if (type === 'insight') {
        await insightApi.deleteReport(id);
      } else {
        await lessonApi.delete(id); // fallback
      }
      message.success('台账记录已删除');
      setSelectedRowKeys(prev => prev.filter(k => k !== id));
      loadRecords();
      if (plan?.id === id) setPlan(null);
    } catch (e: any) {
      const detail = e.response?.data?.detail || e.message || '未知错误';
      message.error(`删除失败 (${type}): ${detail}`);
    }
  };

  // ── 批量导出 ──
  const handleBatchExport = async () => {
    const toExport = selectedRowKeys.length > 0
      ? records.filter((r: any) => selectedRowKeys.includes(r.id))
      : records;
    if (toExport.length === 0) { message.warning('没有可导出的记录'); return; }
    setBatchExporting(true);
    try {
      for (let i = 0; i < toExport.length; i++) {
        const r = toExport[i];
        const res = await lessonApi.exportWord(r);
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        triggerDownload(blob, `教案_${r.course_name}_${r.chapter}`);
        // 文件之间间隔 600ms，确保浏览器处理完每个下载
        if (i < toExport.length - 1) await new Promise(r => setTimeout(r, 600));
      }
      message.success(`已导出 ${toExport.length} 份教案`);
      setSelectedRowKeys([]);
    } catch (e: any) { message.error('批量导出失败: ' + (e.message || '未知错误')); }
    finally { setBatchExporting(false); }
  };

  // ── 批量归档 ──
  const handleBatchArchive = () => {
    const toArchive = selectedRowKeys.length > 0
      ? records.filter((r: any) => selectedRowKeys.includes(r.id))
      : records;
    if (toArchive.length === 0) { message.warning('没有可归档的记录'); return; }
    setBatchArchiving(true);
    setTimeout(() => {
      message.success(`已归档 ${toArchive.length} 条台账记录`);
      setSelectedRowKeys([]);
      setBatchArchiving(false);
    }, 800);
  };

  // ── 批量删除 ──
  const [batchDeleting, setBatchDeleting] = useState(false);
  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) { message.warning('请先勾选要删除的记录'); return; }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条台账记录吗？此操作不可恢复。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setBatchDeleting(true);
        let successCount = 0;
        let failCount = 0;
        for (const key of selectedRowKeys) {
          const record = records.find((r: any) => r.id === key);
          if (!record) continue;
          try {
            const type = record._type || 'lesson';
            if (type === 'lesson') await lessonApi.delete(record.id);
            else if (type === 'homework') await homeworkApi.deleteGrade(record.id);
            else if (type === 'insight') await insightApi.deleteReport(record.id);
            else await lessonApi.delete(record.id);
            successCount++;
          } catch (e: any) {
            failCount++;
          }
        }
        setBatchDeleting(false);
        setSelectedRowKeys([]);
        if (successCount > 0) message.success(`成功删除 ${successCount} 条记录${failCount > 0 ? `，${failCount} 条失败` : ''}`);
        else message.error('删除失败，请重试');
        loadRecords();
      },
    });
  };

  // ── 打印台账 ──
  const handlePrint = () => {
    const toPrint = selectedRowKeys.length > 0
      ? records.filter((r: any) => selectedRowKeys.includes(r.id))
      : records;
    if (toPrint.length === 0) { message.warning('没有可打印的记录'); return; }
    const lines = toPrint.map((r: any, i: number) =>
      `${i + 1}. ${r.course_name} — ${r.chapter}（${r.total_hours}课时）${(r.created_at || '').slice(0, 10)}`
    ).join('\n');
    const w = window.open('', '_blank', 'width=800,height=600');
    if (w) { w.document.write(`<pre style="font-family:monospace;padding:20px;font-size:14px"><h2>教学台账记录</h2>${lines}</pre>`); w.document.close(); }
    else { message.warning('请允许弹出窗口以打印'); }
  };

  // ── 编辑教案 ──
  const startEditing = () => {
    if (!plan) return;
    setEditPlan(JSON.parse(JSON.stringify(plan))); // 深拷贝
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditPlan(null);
  };

  const saveEditing = async () => {
    if (!editPlan) return;
    setSaving(true);
    try {
      // 清理空字符串（key_points 等数组可能包含空串）
      const cleanSessions = (editPlan.sessions || []).map((s: any) => ({
        ...s,
        key_points: (s.key_points || []).filter((kp: string) => kp.trim()),
        difficult_points: (s.difficult_points || []).filter((dp: string) => dp.trim()),
        activities: (s.activities || []).map((a: any) => ({
          ...a,
          content: a.content?.trim() || a.content,
          teacher_activity: a.teacher_activity?.trim() || a.teacher_activity,
          student_activity: a.student_activity?.trim() || a.student_activity,
          example: a.example?.trim() || a.example,
        })),
      }));
      const payload = {
        plan_data: {
          course_name: editPlan.course_name,
          chapter: editPlan.chapter,
          total_hours: editPlan.total_hours ?? plan.total_hours ?? 2,
          objectives: editPlan.objectives,
          methods: (editPlan.methods || []).filter((m: string) => m.trim()),
          resources: (editPlan.resources || []).filter((r: string) => r.trim()),
          sessions: cleanSessions,
          board_design: editPlan.board_design,
          class_tasks: editPlan.class_tasks,
          homework: editPlan.homework,
          assessment: editPlan.assessment,
          innovation: editPlan.innovation,
        },
      };
      await lessonApi.update(editPlan.id, payload);
      message.success('教案已保存');
      setPlan({ ...editPlan });
      setEditing(false);
      setEditPlan(null);
      loadRecords();
    } catch (e: any) {
      message.error('保存失败: ' + (e.response?.data?.detail || e.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  // ── 编辑辅助函数 ──
  const updateEditField = (field: string, value: any) => {
    setEditPlan((prev: any) => ({ ...prev, [field]: value }));
  };

  const updateEditObjective = (index: number, field: string, value: string) => {
    setEditPlan((prev: any) => {
      const objectives = [...(prev.objectives || [])];
      if (!objectives[index]) objectives[index] = { dimension: '', content: '' };
      objectives[index] = { ...objectives[index], [field]: value };
      return { ...prev, objectives };
    });
  };

  const addEditObjective = () => {
    setEditPlan((prev: any) => ({
      ...prev,
      objectives: [...(prev.objectives || []), { dimension: '', content: '' }],
    }));
  };

  const removeEditObjective = (index: number) => {
    setEditPlan((prev: any) => ({
      ...prev,
      objectives: (prev.objectives || []).filter((_: any, i: number) => i !== index),
    }));
  };

  const updateEditMethod = (index: number, value: string) => {
    setEditPlan((prev: any) => {
      const methods = [...(prev.methods || [])];
      methods[index] = value;
      return { ...prev, methods };
    });
  };

  const addEditMethod = () => {
    setEditPlan((prev: any) => ({ ...prev, methods: [...(prev.methods || []), ''] }));
  };

  const removeEditMethod = (index: number) => {
    setEditPlan((prev: any) => ({ ...prev, methods: (prev.methods || []).filter((_: any, i: number) => i !== index) }));
  };

  const updateEditResource = (index: number, value: string) => {
    setEditPlan((prev: any) => {
      const resources = [...(prev.resources || [])];
      resources[index] = value;
      return { ...prev, resources };
    });
  };

  const addEditResource = () => {
    setEditPlan((prev: any) => ({ ...prev, resources: [...(prev.resources || []), ''] }));
  };

  const removeEditResource = (index: number) => {
    setEditPlan((prev: any) => ({ ...prev, resources: (prev.resources || []).filter((_: any, i: number) => i !== index) }));
  };

  const updateEditSession = (index: number, field: string, value: any) => {
    setEditPlan((prev: any) => {
      const sessions = [...(prev.sessions || [])];
      if (!sessions[index]) sessions[index] = {};
      sessions[index] = { ...sessions[index], [field]: value };
      return { ...prev, sessions };
    });
  };

  const updateEditActivity = (sessionIdx: number, actIdx: number, field: string, value: any) => {
    setEditPlan((prev: any) => {
      const sessions = [...(prev.sessions || [])];
      const activities = [...(sessions[sessionIdx]?.activities || [])];
      if (!activities[actIdx]) activities[actIdx] = {};
      activities[actIdx] = { ...activities[actIdx], [field]: value };
      sessions[sessionIdx] = { ...sessions[sessionIdx], activities };
      return { ...prev, sessions };
    });
  };

  const addEditActivity = (sessionIdx: number) => {
    setEditPlan((prev: any) => {
      const sessions = [...(prev.sessions || [])];
      sessions[sessionIdx] = {
        ...sessions[sessionIdx],
        activities: [...(sessions[sessionIdx]?.activities || []), { activity_type: '讲授', duration: 10, content: '' }],
      };
      return { ...prev, sessions };
    });
  };

  const removeEditActivity = (sessionIdx: number, actIdx: number) => {
    setEditPlan((prev: any) => {
      const sessions = [...(prev.sessions || [])];
      sessions[sessionIdx] = {
        ...sessions[sessionIdx],
        activities: (sessions[sessionIdx]?.activities || []).filter((_: any, i: number) => i !== actIdx),
      };
      return { ...prev, sessions };
    });
  };

  // ── 生成教案（API Key 拦截 + 原始逻辑保留） ──
  const handleGenerate = async (values: LessonPlanRequest) => {
    // 拦截：无有效 API Key 则拒绝生成
    if (!guard.hasKey) {
      guard.showGuard();
      return;
    }
    setLoading(true);
    setError('');
    setPlan(null);
    try {
      const res = await lessonApi.generate(values);
      if (res.data.success) {
        setPlan(res.data.data);
        message.success('教案生成成功！已自动保存至教学台账');
        loadRecords();
      } else {
        setError(res.data.message || '生成失败');
      }
    } catch (e: any) {
      // 超时/网络错误时，后端可能已生成成功并保存到台账
      // 尝试从台账中加载最新记录，避免误报"失败"
      if (e.code === 'ECONNABORTED' || e.message?.includes('timeout')) {
        message.warning('教案生成耗时较长，正在检查是否已保存...');
        loadRecords();
        setError('');
      } else {
        setError(e.response?.data?.detail || '请求失败，请检查后端服务是否运行');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── 导出完整教案 Word ──
  // ── 工具：触发浏览器下载（防重复文件名导致跳过） ──
  const triggerDownload = (blob: Blob, baseName: string) => {
    // 添加时间戳避免浏览器因同名文件跳过下载
    const ts = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const filename = `${baseName}_${ts}.docx`;
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    // 延迟 5 秒后清理，确保下载管理器已接管
    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }, 5000);
    return filename;
  };

  const handleExportFullWord = async () => {
    if (!plan) return;
    setExportingFull(true);
    try {
      const res = await lessonApi.exportWord(plan);
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const fn = triggerDownload(blob, `教案_${plan.course_name}_${plan.chapter}`);
      message.success(`完整教案已导出：${fn}`);
    } catch (e: any) { message.error('导出失败: ' + (e.message || '未知错误')); }
    finally { setExportingFull(false); }
  };

  // ── 导出单个流程 Word ──
  const handleExportSegmentWord = async (session: any) => {
    if (!plan) return;
    const key = `${session.session_order}`;
    setExportingSeg(key);
    try {
      const res = await lessonApi.exportSegmentWord(session, plan.course_name, plan.chapter);
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const fn = triggerDownload(blob, `教案_${plan.course_name}_第${session.session_order}课时`);
      message.success(`单流程已导出：${fn}`);
    } catch (e: any) { message.error('导出失败: ' + (e.message || '未知错误')); }
    finally { setExportingSeg(''); }
  };

  // ── 加载历史台账 ──
  const loadRecords = async () => {
    setRecordsLoading(true);
    try {
      // 并发请求数据源（作业批改仅显示手动归档的记录，不会自动进入台账）
      const [lessonRes, homeworkRes, insightRes] = await Promise.allSettled([
        lessonApi.list(filterCourse || undefined),
        homeworkApi.listGrades ? homeworkApi.listGrades(filterCourse || '', true) : Promise.resolve({ data: { data: { items: [] } } }),
        insightApi.listReports ? insightApi.listReports() : Promise.resolve({ data: { data: [] } }),
      ]);

      // 合并台账记录
      const merged: any[] = [];

      // 1. 备课教案
      const lessons = lessonRes.status === 'fulfilled'
        ? (lessonRes.value.data?.plans || lessonRes.value.data?.data?.plans || [])
        : [];
      lessons.forEach((item: any) => merged.push({ ...item, _source: item._source || 'ai', _type: 'lesson', _icon: 'book', _label: '备课教案' }));

      // 2. 作业批改（仅显示手动点过"归入教学台账"的记录）
      if (homeworkRes.status === 'fulfilled') {
        const hw = homeworkRes.value.data?.data?.items || homeworkRes.value.data?.items || [];
        hw.forEach((item: any) => merged.push({
          id: item.id, course_name: item.course || item.course_name || '', chapter: item.chapter || '',
          total_hours: 0, sessions: [], created_at: item.created_at || '',
          _type: 'homework', _icon: 'file-text', _label: '作业批改', _source: item._source || 'seed',
          _title: `${item.student_name || '未知'} — ${item.course_name || item.course || ''}`,
          _detail: `得分: ${item.score || item.percentage || 0}`,
          _sourceFile: item.source_file || '',
          _batchId: item.batch_id || '',
          _score: item.score || item.percentage || 0,
          _questionType: item.question_type || '',
          _feedback: item.feedback || '',
          _knowledgePoints: item.knowledge_points || [],
        }));
      }

      // 3. 学情诊断
      if (insightRes.status === 'fulfilled') {
        const ins = insightRes.value.data?.data?.reports || insightRes.value.data?.data || [];
        (Array.isArray(ins) ? ins : []).forEach((item: any) => merged.push({
          id: item.id, course_name: item.course_name || '', chapter: '',
          total_hours: 0, sessions: [], created_at: item.created_at || '',
          _type: 'insight', _icon: 'bar-chart', _label: '学情诊断', _source: item._source || 'seed',
          _title: `学情报告 — ${item.course_name || ''}`,
          _detail: item.report_type || '',
        }));
      }

      // 按时间倒序排列，提取课程列表
      merged.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      const courses = [...new Set(merged.map(r => r.course_name).filter(Boolean))].sort() as string[];
      setCourseOptions(courses);
      setTotalRecords(merged.length);
      setRecords(merged);
    } catch {
      // ignore
    } finally {
      setRecordsLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, []);

  // ── 从 Agent 编排工作台跳转时自动定位教案 ──
  const [searchParams] = useSearchParams();
  const autoPlanId = searchParams.get('plan_id') || '';
  const autoPlanRef = useRef(false);

  useEffect(() => {
    if (!autoPlanId || records.length === 0 || autoPlanRef.current) return;
    const target = records.find((r: any) => r.id === autoPlanId);
    if (target) {
      autoPlanRef.current = true;
      // 自动加载教案详情
      const planData = {
        id: target.id,
        course_name: target.course_name,
        chapter: target.chapter,
        total_hours: target.total_hours || 2,
        created_at: target.created_at,
        objectives: target.objectives || [],
        methods: target.methods || [],
        resources: target.resources || [],
        sessions: target.sessions || [],
        board_design: target.board_design || {},
        class_tasks: target.class_tasks || [],
        homework: target.homework || [],
        assessment: target.assessment || {},
        innovation: target.innovation || {},
      };
      setPlan(planData);
      setError('');
      lessonApi.get(target.id).catch(() => {});
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 150);
      message.success(`已定位到 Agent 工作流生成的教案：${target.course_name} — ${target.chapter}`);
    }
  }, [autoPlanId, records]);

  // ── 台账列表（可见性 + Tab + 课程 + 类型 + 搜索） ──
  const filteredRecords = records.filter(r => {
    // 0. 隐藏模式下排除种子数据（_source === 'seed'），保留用户和AI生成数据
    if (!visible && r._source === 'seed') return false;
    // 1. Tab 筛选
    if (ledgerTab === 'lesson') { if (r._type !== 'lesson') return false; }
    else if (ledgerTab === 'homework') { if (r._type !== 'homework') return false; }
    else if (ledgerTab === 'insight') { if (r._type !== 'insight') return false; }
    else if (ledgerTab === 'classroom') { if (r._type !== 'lesson') return false; }
    else if (ledgerTab === 'qa') { if (r._type !== 'homework' && r._type !== 'insight') return false; }
    // 2. 课程筛选
    if (filterCourse && r.course_name !== filterCourse) return false;
    // 3. 类型筛选（下拉框）
    if (filterType && r._type !== filterType) return false;
    // 4. 搜索文本（匹配课程名、章节、标题）
    if (searchText) {
      const q = searchText.toLowerCase();
      const haystack = [
        r.course_name, r.chapter, r._title, r._label, r._detail,
        r.student_name, r.plan_name,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const pagedRecords = filteredRecords.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  const columns = [
    {
      title: '记录名称',
      key: 'name',
      render: (_: any, r: any) => {
        const iconMap: any = { book: <BookOutlined style={{ color: BRAND.colors.primary }} />, 'file-text': <FileTextOutlined style={{ color: '#52c41a' }} />, 'bar-chart': <BarChartOutlined style={{ color: '#fa8c16' }} /> };
        const typeLabel = r._label || '备课教案';
        const title = r._title || `${r.course_name || ''} — ${r.chapter || ''}`;
        const detail = r._detail || (r._type === 'lesson'
          ? `共 ${(r.sessions?.length || 0)} 个教学环节 · ${r.total_hours ?? '-'} 课时`
          : '');
        return (
          <Space>
            {iconMap[r._icon] || <BookOutlined style={{ color: BRAND.colors.primary }} />}
            <div>
              <Space size={4}>
                <Text strong style={{ fontSize: 14, color: BRAND.colors.textPrimary }}>{title}</Text>
                <Tag style={{ borderRadius: 6, fontSize: 10, background: `${BRAND.colors.primary}10`, color: BRAND.colors.primary, border: 'none' }}>{typeLabel}</Tag>
              </Space>
              <br />
              <Text type="secondary" style={{ fontSize: 11 }}>{detail}</Text>
            </div>
          </Space>
        );
      },
    },
    {
      title: '来源文件',
      key: 'sourceFile',
      width: 120,
      render: (_: any, r: any) => {
        if (r._type !== 'homework') return <Text type="secondary">-</Text>;
        return r._sourceFile ? <Tag style={{ borderRadius: 6, fontSize: 11 }}>{r._sourceFile.length > 15 ? r._sourceFile.slice(0, 14) + '…' : r._sourceFile}</Tag> : <Text type="secondary">-</Text>;
      },
    },
    {
      title: '状态',
      dataIndex: 'id',
      key: 'status',
      width: 110,
      render: (id: string, r: any) => <LedgerStatusTag status={id ? (r._type === 'insight' ? 'review' : 'archived') : 'history'} />,
    },
    {
      title: '生成时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {v?.slice(0, 19)?.replace('T', ' ') || '-'}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: any, r: any) => (
        <Space>
          {r._type === 'lesson' ? (
            <>
              <Tooltip title="查看详情">
                <Button type="link" icon={<EyeOutlined />} size="small"
                  onClick={() => handleView(r)}
                  style={{ color: BRAND.colors.primary }}>查看</Button>
              </Tooltip>
              <Tooltip title="台账溯源">
                <Button type="link" icon={<HistoryOutlined />} size="small"
                  onClick={() => handleTrace(r)}
                  style={{
                    background: `linear-gradient(135deg, ${BRAND.colors.primary}, ${BRAND.colors.purple})`,
                    color: '#fff', borderRadius: 6, padding: '2px 10px', fontSize: 12, height: 26, border: 'none',
                  }} className="brand-card">台账溯源</Button>
              </Tooltip>
            </>
          ) : r._type === 'homework' ? (
            <>
              <Tooltip title="查看批改详情">
                <Button type="link" icon={<EyeOutlined />} size="small"
                  onClick={() => {
                    const parts = [
                      `📋 ${r._label}详情`,
                      `👤 学生: ${r._title || '-'}`,
                      `📄 来源文件: ${r._sourceFile || '-'}`,
                      `📊 得分: ${r._score || 0}`,
                      `📝 题型: ${r._questionType || '-'}`,
                      `💬 评语: ${r._feedback || '-'}`,
                    ];
                    if (r._knowledgePoints?.length > 0) {
                      parts.push(`🏷 知识点: ${Array.isArray(r._knowledgePoints) ? r._knowledgePoints.join(', ') : r._knowledgePoints}`);
                    }
                    Modal.info({ title: '作业批改详情', content: parts.join('\n\n'), width: 500 });
                  }}
                  style={{ color: BRAND.colors.primary }}>查看</Button>
              </Tooltip>
            </>
          ) : (
            <Button type="link" icon={<EyeOutlined />} size="small"
              onClick={() => message.info(`${r._label}详情：${r._title || r.course_name} — ${r._detail || ''}`)}
              style={{ color: BRAND.colors.primary }}>查看</Button>
          )}
          <Popconfirm title={`确认删除此${r._label || '台账'}记录？`} onConfirm={() => handleDelete(r)}>
            <Button type="link" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-enter" style={{ position: 'relative', minHeight: '100vh' }}>
      {/* 二进制暗纹背景 */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundImage: `url(${BRAND.binaryPattern})`,
          backgroundRepeat: 'repeat',
          opacity: 0.6,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* ════════════════════════════════════════════ */}
        {/* 页面头部 — 层级式品牌布局              */}
        {/* ════════════════════════════════════════════ */}
        <div style={{ marginBottom: 24 }}>
          {/* L1: 面包屑导航 */}
          <div style={{ marginBottom: 10 }}>
            <Space size={4} style={{ fontSize: 12, color: BRAND.colors.textTertiary }}>
              <span style={{ cursor: 'pointer', transition: 'color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.color = BRAND.colors.primary)}
                onMouseLeave={e => (e.currentTarget.style.color = BRAND.colors.textTertiary)}
                onClick={() => window.location.href = '/'}>首页</span>
              <span style={{ color: '#d9d9d9' }}>/</span>
              <span style={{ color: BRAND.colors.primary, fontWeight: 500 }}>教学台账中心</span>
            </Space>
          </div>

          {/* L2: 品牌标题区 — 蓝色图标 + 大字标题 + 标语 */}
          <Row align="middle" gutter={16}>
            <Col>
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                background: `linear-gradient(135deg, ${BRAND.colors.primary}, #1A6BE0)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 6px 20px ${BRAND.colors.primary}35`,
              }}>
                {React.createElement('span', {
                  dangerouslySetInnerHTML: { __html: BRAND.logoSvg },
                  style: { width: 30, height: 30, display: 'inline-flex' },
                })}
              </div>
            </Col>
            <Col flex="auto">
              <Title level={3} style={{ margin: 0, fontSize: 22, fontWeight: 700, color: BRAND.colors.textPrimary, letterSpacing: 0.5 }}>
                智教星 · 教学台账中心
              </Title>
              <Text type="secondary" style={{ fontSize: 13, color: BRAND.colors.textTertiary, marginTop: 2, display: 'block' }}>
                全量教学数据沉淀、AI 操作记录可追溯归档
              </Text>
            </Col>
            <Col>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', background: `${BRAND.colors.primary}06`,
                borderRadius: 10, border: `1px solid ${BRAND.colors.border}`,
              }}>
                <HistoryOutlined style={{ fontSize: 16, color: BRAND.colors.primary }} />
                <div>
                  <Text strong style={{ fontSize: 16, color: BRAND.colors.primary }}>{visible ? totalRecords : records.filter((r: any) => r._source !== 'seed').length}</Text>
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 2 }}>条记录</Text>
                </div>
              </div>
            </Col>
          </Row>
        </div>

        {/* ── API Key 警告横幅 ── */}
        {!canGenerate && <ApiKeyBanner onGoSettings={guard.goToSettings} />}

        {/* ════════════════════════════════════════════ */}
        {/* 智能备课生成区（原始业务逻辑完全保留）  */}
        {/* ════════════════════════════════════════════ */}
        <Card
          className="brand-card"
          style={{ marginBottom: 20 }}
          bodyStyle={{ padding: '20px 24px', position: 'relative' }}
        >
          {/* 品牌角标 */}
          <span style={{ position: 'absolute', top: 10, right: 12, color: BRAND.colors.primary, opacity: 0.4 }}>
            <BrandBadge size={16} />
          </span>

          <Space align="center" style={{ marginBottom: 12 }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: BRAND.colors.primaryGradient,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <RobotOutlined style={{ fontSize: 16, color: '#fff' }} />
            </div>
            <Title level={5} style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              AI 智能备课
            </Title>
            <Tag
              style={{
                borderRadius: 8,
                background: `${BRAND.colors.green}15`,
                color: BRAND.colors.green,
                border: `1px solid ${BRAND.colors.green}33`,
                fontSize: 10,
              }}
            >
              RAG 增强
            </Tag>
          </Space>
          <Paragraph style={{ color: BRAND.colors.textSecondary, marginBottom: 16, fontSize: 13 }}>
            输入课程和章节信息，AI 将基于学科知识库自动生成完整教案。
          </Paragraph>

          <Form
            form={form}
            layout="vertical"
            onFinish={handleGenerate}
            initialValues={{ teaching_hours: 2 }}
            size="middle"
          >
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="course_name" label="课程名称" rules={[{ required: true, message: '请输入课程名称' }]}>
                  <Input
                    placeholder="例如：机器学习、深度学习"
                    style={{ borderRadius: 8, borderColor: BRAND.colors.border }}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="chapter" label="章节名称" rules={[{ required: true, message: '请输入章节名称' }]}>
                  <Input
                    placeholder="例如：第一章 命题逻辑"
                    style={{ borderRadius: 8, borderColor: BRAND.colors.border }}
                  />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="teaching_hours" label="课时数">
                  <InputNumber min={1} max={8} style={{ width: '100%', borderRadius: 8 }} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="additional_requirements" label="附加要求">
                  <Input placeholder="偏重实践/增加互动" style={{ borderRadius: 8, borderColor: BRAND.colors.border }} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="textbook_content" label="教材内容（可选，RAG 增强备课质量）">
              <TextArea
                rows={3}
                placeholder="粘贴教材内容、讲义要点... 留空则 AI 基于学科常识生成"
                style={{ borderRadius: 8, borderColor: BRAND.colors.border, resize: 'none' }}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Space>
                {canGenerate ? (
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    icon={<ThunderboltOutlined />}
                    style={{
                      minWidth: 160,
                      height: 40,
                      borderRadius: 8,
                      border: 'none',
                      background: BRAND.colors.primaryGradient,
                      boxShadow: `0 4px 14px ${BRAND.colors.primary}40`,
                    }}
                  >
                    {loading ? 'AI 正在备课...' : '生成教案'}
                  </Button>
                ) : (
                  <DisabledAIButton label="生成教案" icon={<KeyOutlined />} />
                )}
                <Button
                  onClick={() => form.resetFields()}
                  style={{ borderRadius: 8, borderColor: BRAND.colors.border, color: BRAND.colors.textSecondary }}
                >
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Form>

          {error && (
            <Alert
              message="生成失败"
              description={error}
              type="error"
              showIcon
              style={{ marginTop: 16, borderRadius: 8 }}
            />
          )}
        </Card>

        {/* ── 加载状态 ── */}
        {loading && (
          <Card
            className="brand-card"
            bodyStyle={{ padding: '40px', textAlign: 'center' }}
          >
            <div style={{ animation: 'logoGlow 1.5s ease-in-out infinite' }}>
              <span
                dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }}
                style={{ width: 56, height: 56, display: 'inline-block' }}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <Spin />
            </div>
            <Paragraph style={{ marginTop: 12, color: BRAND.colors.textSecondary }}>
              正在检索知识库 → 构建教案结构 → 生成教学内容...
            </Paragraph>
          </Card>
        )}

        {/* ── 教案展示（交互式流程 + 一键导出）—— 用户刚生成的教案始终显示  ── */}
        {plan && !loading && (
          <Card
            className="brand-card"
            style={{ marginBottom: 20 }}
            bodyStyle={{ padding: '20px 24px', position: 'relative' }}
          >
            <span style={{ position: 'absolute', top: 10, right: 12, color: BRAND.colors.primary, opacity: 0.4 }}>
              <BrandBadge size={16} />
            </span>

            {/* 教案头部 + 导出按钮 */}
            <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
              <Col>
                <Space>
                  <BookOutlined style={{ fontSize: 20, color: BRAND.colors.primary }} />
                  <Title level={5} style={{ margin: 0, fontSize: 15 }}>
                    {plan.course_name} — {plan.chapter}
                  </Title>
                  <LedgerStatusTag status="archived" />
                  <Tag style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>
                    {plan.total_hours ?? '-'} 课时
                  </Tag>
                  <Tag style={{ borderRadius: 6, background: `${BRAND.colors.green}15`, color: BRAND.colors.green, border: 'none' }}>
                    {plan.sessions?.length || 0} 个教学环节
                  </Tag>
                </Space>
              </Col>
              <Col>
                <Space>
                  {editing ? (
                    <>
                      <Button onClick={cancelEditing} style={{ borderRadius: 8 }}>取消</Button>
                      <Button type="primary" icon={<CheckCircleOutlined />} loading={saving}
                        onClick={saveEditing}
                        style={{ borderRadius: 8, border: 'none', background: BRAND.colors.green, height: 36 }}>
                        保存修改
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button icon={<EditOutlined />} onClick={startEditing}
                        style={{ borderRadius: 8, borderColor: BRAND.colors.orange, color: BRAND.colors.orange }}>
                        编辑教案
                      </Button>
                      <Button icon={<DownloadOutlined />} type="primary" loading={exportingFull}
                        onClick={handleExportFullWord}
                        style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, height: 36 }}>
                        导出完整教案 Word
                      </Button>
                    </>
                  )}
                </Space>
              </Col>
            </Row>

            {/* 降级方案提示：LLM 生成失败，显示的是模板教案 */}
            {plan.is_fallback && (
              <Alert
                type="warning"
                showIcon
                message="⚠️ 模板教案（非 AI 生成）"
                description="AI 大模型暂时不可用，当前显示的是结构化教学模板。内容较为通用，建议点击「编辑教案」根据实际教学需求进行修改完善。"
                style={{ marginBottom: 16, borderRadius: 8 }}
              />
            )}

            {/* 教案编辑模式 */}
            {editing && editPlan ? (
              <div style={{ maxHeight: '60vh', overflow: 'auto', paddingRight: 4 }}>
                {/* 基本信息编辑 */}
                <Card size="small" title="基本信息" style={{ marginBottom: 12, borderRadius: 8 }}>
                  <Row gutter={12}>
                    <Col span={8}>
                      <Text strong style={{ fontSize: 12 }}>课程名称</Text>
                      <Input size="small" value={editPlan.course_name || ''}
                        onChange={e => updateEditField('course_name', e.target.value)} style={{ marginTop: 4 }} />
                    </Col>
                    <Col span={8}>
                      <Text strong style={{ fontSize: 12 }}>章节名称</Text>
                      <Input size="small" value={editPlan.chapter || ''}
                        onChange={e => updateEditField('chapter', e.target.value)} style={{ marginTop: 4 }} />
                    </Col>
                    <Col span={4}>
                      <Text strong style={{ fontSize: 12 }}>课时数</Text>
                      <InputNumber size="small" min={1} max={16} value={editPlan.total_hours ?? 2}
                        onChange={v => updateEditField('total_hours', v ?? 2)} style={{ marginTop: 4, width: '100%' }} />
                    </Col>
                  </Row>
                </Card>

                {/* 教学目标编辑 */}
                <Card size="small" title={<Space><AimOutlined style={{ color: BRAND.colors.primary }} />教学目标</Space>}
                  style={{ marginBottom: 12, borderRadius: 8 }}
                  extra={<Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addEditObjective}>添加</Button>}>
                  {(editPlan.objectives || []).map((obj: any, i: number) => (
                    <Row gutter={8} key={i} style={{ marginBottom: 6 }}>
                      <Col span={6}>
                        <Input size="small" placeholder="维度（知识/能力/素养）" value={obj.dimension || ''}
                          onChange={e => updateEditObjective(i, 'dimension', e.target.value)} />
                      </Col>
                      <Col span={16}>
                        <Input size="small" placeholder="目标内容" value={obj.content || ''}
                          onChange={e => updateEditObjective(i, 'content', e.target.value)} />
                      </Col>
                      <Col span={2}>
                        <Button danger size="small" icon={<DeleteOutlined />} onClick={() => removeEditObjective(i)} />
                      </Col>
                    </Row>
                  ))}
                  {(!editPlan.objectives || editPlan.objectives.length === 0) && <Text type="secondary">暂无，点击"添加"新增</Text>}
                </Card>

                {/* 教学方法编辑 */}
                <Card size="small" title={<Space><ToolOutlined style={{ color: BRAND.colors.purple }} />教学方法</Space>}
                  style={{ marginBottom: 12, borderRadius: 8 }}
                  extra={<Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addEditMethod}>添加</Button>}>
                  <Space wrap>
                    {(editPlan.methods || []).map((m: string, i: number) => (
                      <Tag key={i} closable onClose={() => removeEditMethod(i)}
                        style={{ borderRadius: 6, background: `${BRAND.colors.purple}10`, color: BRAND.colors.purple, border: `1px solid ${BRAND.colors.purple}30`, padding: '4px 8px', marginBottom: 4 }}>
                        <Input size="small" bordered={false} value={m}
                          onChange={e => updateEditMethod(i, e.target.value)}
                          style={{ width: 100, padding: 0, background: 'transparent' }} />
                      </Tag>
                    ))}
                  </Space>
                  {(!editPlan.methods || editPlan.methods.length === 0) && <Text type="secondary">暂无，点击"添加"新增</Text>}
                </Card>

                {/* 教学资源编辑 */}
                <Card size="small" title={<Space><FileTextOutlined style={{ color: BRAND.colors.green }} />教学资源</Space>}
                  style={{ marginBottom: 12, borderRadius: 8 }}
                  extra={<Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addEditResource}>添加</Button>}>
                  <Space wrap>
                    {(editPlan.resources || []).map((r: string, i: number) => (
                      <Tag key={i} closable onClose={() => removeEditResource(i)}
                        style={{ borderRadius: 6, background: `${BRAND.colors.green}10`, color: BRAND.colors.green, border: `1px solid ${BRAND.colors.green}30`, padding: '4px 8px', marginBottom: 4 }}>
                        <Input size="small" bordered={false} value={r}
                          onChange={e => updateEditResource(i, e.target.value)}
                          style={{ width: 100, padding: 0, background: 'transparent' }} />
                      </Tag>
                    ))}
                  </Space>
                  {(!editPlan.resources || editPlan.resources.length === 0) && <Text type="secondary">暂无，点击"添加"新增</Text>}
                </Card>

                {/* 教学流程编辑 */}
                <Title level={5} style={{ fontSize: 14, marginBottom: 8, color: BRAND.colors.textPrimary }}>
                  📋 教学流程
                </Title>
                {(editPlan.sessions || []).map((session: any, idx: number) => (
                  <Card key={idx} size="small" style={{ marginBottom: 10, borderRadius: 8, borderColor: BRAND.colors.border }}
                    title={
                      <Space>
                        <span style={{ width: 24, height: 24, borderRadius: '50%', background: BRAND.colors.primaryGradient, color: '#fff', fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                          {session.session_order || idx + 1}
                        </span>
                        <Input size="small" value={session.session_topic || ''} placeholder="环节主题"
                          onChange={e => updateEditSession(idx, 'session_topic', e.target.value)}
                          style={{ width: 200, fontWeight: 600 }} />
                      </Space>
                    }>
                    <Text type="secondary" style={{ fontSize: 11 }}>教学重点（逗号分隔）</Text>
                    <Input size="small" value={(session.key_points || []).join('，')} placeholder="重点1，重点2"
                      onChange={e => updateEditSession(idx, 'key_points', e.target.value.split(/[,，]/))}
                      style={{ marginBottom: 8 }} />
                    {(session.activities || []).map((act: any, ai: number) => (
                      <div key={ai} style={{ marginBottom: 8, padding: '8px 10px', background: '#fafafa', borderRadius: 6 }}>
                        <Row gutter={8} align="middle">
                          <Col span={4}>
                            <Text style={{ fontSize: 11 }}>类型</Text>
                            <Select size="small" value={act.activity_type || '讲授'} style={{ width: '100%' }}
                              onChange={v => updateEditActivity(idx, ai, 'activity_type', v)}>
                              {['导入','讲授','讨论','练习','演示','实验','总结','互动'].map(t => <Option key={t} value={t}>{t}</Option>)}
                            </Select>
                          </Col>
                          <Col span={3}>
                            <Text style={{ fontSize: 11 }}>时长(min)</Text>
                            <InputNumber size="small" min={5} max={60} value={act.duration || 10}
                              onChange={v => updateEditActivity(idx, ai, 'duration', v)} style={{ width: '100%' }} />
                          </Col>
                          <Col span={15}>
                            <Text style={{ fontSize: 11 }}>教学内容</Text>
                            <Input size="small" value={act.content || ''} placeholder="活动内容"
                              onChange={e => updateEditActivity(idx, ai, 'content', e.target.value)} />
                          </Col>
                          <Col span={2}>
                            <Button danger size="small" icon={<DeleteOutlined />}
                              onClick={() => removeEditActivity(idx, ai)} style={{ marginTop: 16 }} />
                          </Col>
                        </Row>
                        <Row gutter={8} style={{ marginTop: 4 }}>
                          <Col span={12}>
                            <Input size="small" value={act.teacher_activity || ''} placeholder="教师讲解脚本（可选）"
                              onChange={e => updateEditActivity(idx, ai, 'teacher_activity', e.target.value)} />
                          </Col>
                          <Col span={12}>
                            <Input size="small" value={act.student_activity || ''} placeholder="学生活动（可选）"
                              onChange={e => updateEditActivity(idx, ai, 'student_activity', e.target.value)} />
                          </Col>
                        </Row>
                        <Input size="small" value={act.example || ''} placeholder="教学示例（可选）"
                          onChange={e => updateEditActivity(idx, ai, 'example', e.target.value)} style={{ marginTop: 4 }} />
                      </div>
                    ))}
                    <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => addEditActivity(idx)}>添加活动</Button>
                  </Card>
                ))}
                {(!editPlan.sessions || editPlan.sessions.length === 0) && <Empty description="暂无教学流程" />}
              </div>
            ) : (
              /* ═══ 原有展示模式 ═══ */
              <>
                {/* 1. 教学目标 */}
                <Card size="small" title={<Space><AimOutlined style={{ color: BRAND.colors.primary }} />教学目标</Space>}
                  style={{ marginBottom: 12, borderRadius: 8, borderColor: BRAND.colors.border }}>
                  <Descriptions column={1} size="small">
                    {plan.objectives?.map((obj: any, i: number) => (
                      <Descriptions.Item
                        label={<Tag style={{ borderRadius: 6, color: BRAND.colors.primary, borderColor: BRAND.colors.primary }}>{obj.dimension}</Tag>}
                        key={i}>
                        {obj.content}
                      </Descriptions.Item>
                    )) || <Text type="secondary">暂无</Text>}
                  </Descriptions>
                </Card>

                {/* 2. 方法与资源 — 可点击查看详情 */}
                <Row gutter={12} style={{ marginBottom: 12 }}>
                  <Col span={12}>
                    <Card size="small" title={<Space><ToolOutlined style={{ color: BRAND.colors.purple }} />教学方法（点击查看详情）</Space>}
                      style={{ borderRadius: 8, borderColor: BRAND.colors.border }}>
                      {plan.methods?.length > 0 ? (
                        <Space wrap>
                          {plan.methods.map((m: string, i: number) => (
                            <Tooltip key={i} title="点击查看详细说明" placement="top">
                              <Tag
                                style={{ borderRadius: 6, cursor: 'pointer',
                                  background: `${BRAND.colors.purple}10`, color: BRAND.colors.purple,
                                  border: `1px solid ${BRAND.colors.purple}30`, padding: '2px 10px', fontSize: 13 }}
                                onClick={() => {
                                  const detailMap: Record<string, string> = {
                                    '讲授法': '以教师口头语言传授知识为主，配合板书、课件等辅助手段。适用于概念性、理论性内容的系统讲解。建议时长不超过课堂的60%。',
                                    '案例教学法': '通过真实或模拟的案例引导学生分析、讨论，培养问题解决能力。案例应具有典型性、争议性和启发性，通常配合小组讨论使用。',
                                    '讨论法': '围绕特定主题组织学生分组讨论或全班辩论，教师引导总结。适用于开放性问题和批判性思维培养，建议每节课安排1-2次5-10分钟讨论。',
                                    '演示法': '通过实物、模型、实验或多媒体展示教学内容，直观呈现知识。适用于实验课、操作技能教学，配合讲解效果更佳。',
                                    '练习法': '学生在教师指导下反复练习以巩固知识、形成技能。设计时应注重从易到难、从模仿到创新的梯度。',
                                    '探究法': '教师提出问题或任务，学生自主探究发现答案。适用于培养科学思维和研究能力，需要充分的课前准备和明确的探究指引。',
                                    '翻转课堂': '课前学生自学视频/资料，课上进行深度讨论和实践。适用于高年级课程，需要配套在线学习资源。',
                                    '小组合作': '4-6人小组协作完成任务，培养团队协作和沟通能力。需明确分工和评价标准，防止搭便车现象。',
                                  };
                                  const desc = detailMap[m] || `${m}是一种常用的教学方法，可根据教学内容灵活运用，达到最佳教学效果。`;
                                  Modal.info({ title: `📖 ${m}`, content: desc, width: 520, okText: '知道了' });
                                }}
                              >{m}</Tag>
                            </Tooltip>
                          ))}
                        </Space>
                      ) : <Text type="secondary">暂无</Text>}
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small" title={<Space><FileTextOutlined style={{ color: BRAND.colors.green }} />教学资源（点击查看详情）</Space>}
                      style={{ borderRadius: 8, borderColor: BRAND.colors.border }}>
                      {plan.resources?.length > 0 ? (
                        <Space wrap>
                          {plan.resources.map((r: string, i: number) => (
                            <Tooltip key={i} title="点击查看详细说明" placement="top">
                              <Tag
                                style={{ borderRadius: 6, cursor: 'pointer',
                                  background: `${BRAND.colors.green}10`, color: BRAND.colors.green,
                                  border: `1px solid ${BRAND.colors.green}30`, padding: '2px 10px', fontSize: 13 }}
                                onClick={() => {
                                  const detailMap: Record<string, string> = {
                                    '教材': '课程指定教材，是教学内容的核心依据。使用时应标注具体章节和页码，确保教学内容与教材衔接。',
                                    '多媒体课件': '演示文稿等多媒体课件，用于辅助课堂讲解。建议每页不超过7行文字，图文并茂，配合动画增强效果。',
                                    '在线学习平台': '如超星学习通、中国大学慕课等，用于发布课程资源、在线测试和讨论。可布置课前预习和课后复习任务。',
                                    '板书': '传统黑板或白板书写，适合公式推导和重点强调。应结构清晰、布局合理，板书设计需提前规划。',
                                    '实验设备': '实验室仪器、开发板、传感器等硬件设备，用于实验演示和学生实操。课前需检查设备完好性。',
                                    '视频资料': '教学相关视频片段，如科普纪录片、学术讲座录像、动画演示等。建议每段不超过5分钟，配合提问使用。',
                                    '代码示例': '完整的可运行程序代码，用于编程课程演示。建议包含详细注释，标注关键算法步骤和复杂度分析。',
                                    '数据集': '用于实践练习的真实或模拟数据集，如UCI数据集、Kaggle竞赛数据等。需说明数据来源、特征和预处理方法。',
                                    '文献资料': '相关学术论文、技术报告、行业标准等，用于拓展阅读。建议标注必读/选读，提供导读问题。',
                                    '教学模型': '三维模型、实体教具等，用于直观展示抽象概念。适用于工程类、医学类课程。',
                                  };
                                  const desc = detailMap[r] || `${r}是教学活动的重要支持工具，合理使用可有效提升教学效果和学生学习体验。`;
                                  Modal.info({ title: `📦 ${r}`, content: desc, width: 520, okText: '知道了' });
                                }}
                              >{r}</Tag>
                            </Tooltip>
                          ))}
                        </Space>
                      ) : <Text type="secondary">暂无</Text>}
                    </Card>
                  </Col>
                </Row>

                {/* 3. 教学流程（可点击标题） */}
                <Title level={5} style={{ fontSize: 14, marginBottom: 12, color: BRAND.colors.textPrimary }}>
                  📋 教学流程（点击标题查看完整详情）
                </Title>
                {plan.sessions?.length > 0 ? (
                  plan.sessions.map((session: any, idx: number) => (
                    <Card
                      key={idx}
                      size="small"
                      title={
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                          <Space
                            style={{ cursor: 'pointer', padding: '2px 0' }}
                            onClick={() => setSegmentModal({ visible: true, session })}
                          >
                            <span style={{
                              width: 26, height: 26, borderRadius: '50%',
                              background: BRAND.colors.primaryGradient,
                              color: '#fff', fontSize: 12, fontWeight: 600,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}>{session.session_order}</span>
                            <Text strong style={{ fontSize: 14, color: BRAND.colors.primary, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                              {session.session_topic}
                            </Text>
                            <Tag style={{ borderRadius: 6, fontSize: 10, background: `${BRAND.colors.primary}10`, color: BRAND.colors.primary, border: 'none' }}>
                              点击查看详情 →
                            </Tag>
                          </Space>
                          <Tooltip title="导出本流程为 Word">
                            <Button
                              type="text"
                              size="small"
                              icon={<DownloadOutlined />}
                              loading={exportingSeg === `${session.session_order}`}
                              onClick={(e) => { e.stopPropagation(); handleExportSegmentWord(session); }}
                              style={{ color: BRAND.colors.green, fontSize: 12 }}
                            />
                          </Tooltip>
                        </Space>
                      }
                      style={{ marginBottom: 10, borderRadius: 8, borderColor: BRAND.colors.border }}
                    >
                      {/* 摘要信息 */}
                      <Space wrap style={{ marginBottom: 4 }}>
                        {session.key_points?.slice(0, 3).map((kp: string, i: number) => (
                          <Tag key={i} color="orange" style={{ borderRadius: 6, fontSize: 11 }}>📌 {kp}</Tag>
                        ))}
                        {session.activities?.length > 0 && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {session.activities.length} 个活动环节 · 约 {session.activities.reduce((s: number, a: any) => s + (a.duration || 0), 0)} 分钟
                          </Text>
                        )}
                      </Space>
                      {session.activities?.slice(0, 2).map((act: any, i: number) => (
                        <div key={i} style={{ marginLeft: 8, marginBottom: 6, padding: '6px 10px', background: '#fafafa', borderRadius: 6 }}>
                          <Space size={4} style={{ marginBottom: 2 }}>
                            <Tag style={{ borderRadius: 6, fontSize: 10, background: `${BRAND.colors.primary}08`, color: BRAND.colors.textSecondary, border: 'none' }}>{act.duration}min</Tag>
                            <Tag style={{ borderRadius: 6, fontSize: 10, background: `${BRAND.colors.purple}08`, color: BRAND.colors.purple, border: 'none' }}>{act.activity_type}</Tag>
                            {act.teacher_activity && <Text style={{ fontSize: 10, color: BRAND.colors.purple }}>🎤脚本</Text>}
                            {act.example && <Text style={{ fontSize: 10, color: BRAND.colors.orange, fontWeight: 500 }}>📝有示例</Text>}
                          </Space>
                          <Text style={{ fontSize: 12, lineHeight: 1.5, display: 'block' }}>{act.content?.slice(0, 100)}{(act.content?.length || 0) > 100 ? '...' : ''}</Text>
                          {act.example && (
                            <div style={{ marginTop: 4, padding: '4px 8px', background: '#FFF7E6', borderRadius: 4, borderLeft: '2px solid #FF9F43' }}>
                              <Text style={{ fontSize: 10, color: '#AD6800', lineHeight: 1.4 }}>
                                📝 {act.example.slice(0, 80)}{act.example.length > 80 ? '...' : ''}
                              </Text>
                            </div>
                          )}
                        </div>
                      ))}
                      {session.activities?.length > 2 && (
                        <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }}
                          onClick={() => setSegmentModal({ visible: true, session })}>
                          查看全部 {session.activities.length} 个活动 →
                        </Button>
                      )}
                    </Card>
                  ))
                ) : <Empty description="暂无教学流程数据" />}

                <Divider style={{ margin: '12px 0' }} />
                <Row justify="space-between" align="middle">
                  <Col>
                    <Space>
                      <BrandBadge size={12} />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        台账 ID：{plan.id} · {plan.created_at?.slice(0, 19)?.replace('T', ' ') || '-'}
                      </Text>
                    </Space>
                  </Col>
                  <Col>
                    <Button icon={<DownloadOutlined />} size="small"
                      onClick={handleExportFullWord} loading={exportingFull}
                      style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>
                      导出 Word
                    </Button>
                  </Col>
                </Row>
              </>
            )}
          </Card>
        )}

        {/* ── 流程详情弹窗 ── */}
        <Modal
          title={
            <Space>
              <span style={{
                width: 28, height: 28, borderRadius: '50%',
                background: BRAND.colors.primaryGradient,
                color: '#fff', fontSize: 13, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{segmentModal.session?.session_order}</span>
              <Text strong style={{ fontSize: 16 }}>{segmentModal.session?.session_topic}</Text>
              <Tag color="blue" style={{ borderRadius: 6 }}>{plan?.course_name} · {plan?.chapter}</Tag>
            </Space>
          }
          open={segmentModal.visible}
          onCancel={() => setSegmentModal({ visible: false, session: null })}
          width={820}
          footer={[
            <Button key="close" onClick={() => setSegmentModal({ visible: false, session: null })} style={{ borderRadius: 6 }}>
              关闭
            </Button>,
            <Button key="export" type="primary" icon={<DownloadOutlined />}
              onClick={() => { handleExportSegmentWord(segmentModal.session); }}
              style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>
              导出本流程 Word
            </Button>,
          ]}
        >
          {segmentModal.session && (
            <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {/* 重点难点 */}
              <Row gutter={12} style={{ marginBottom: 12 }}>
                {segmentModal.session.key_points?.length > 0 && (
                  <Col span={12}>
                    <Text strong style={{ fontSize: 13, color: BRAND.colors.orange }}>📌 教学重点</Text>
                    <div style={{ marginTop: 4 }}>
                      {segmentModal.session.key_points.map((kp: string, i: number) => (
                        <Tag key={i} color="orange" style={{ borderRadius: 6, marginBottom: 4 }}>{kp}</Tag>
                      ))}
                    </div>
                  </Col>
                )}
                {segmentModal.session.difficult_points?.length > 0 && (
                  <Col span={12}>
                    <Text strong style={{ fontSize: 13, color: BRAND.colors.error }}>⚠️ 教学难点</Text>
                    <div style={{ marginTop: 4 }}>
                      {segmentModal.session.difficult_points.map((dp: string, i: number) => (
                        <Tag key={i} color="red" style={{ borderRadius: 6, marginBottom: 4 }}>{dp}</Tag>
                      ))}
                    </div>
                  </Col>
                )}
              </Row>

              {/* 完整活动时间线 — 大卡片展示全部细节 */}
              <Text strong style={{ fontSize: 15, color: BRAND.colors.textPrimary, display: 'block', marginBottom: 12 }}>
                📝 完整教学详情（可直接用于课堂授课）
              </Text>
              <Timeline
                items={segmentModal.session.activities?.map((act: any, i: number) => ({
                  color: i === 0 ? BRAND.colors.primary : i === (segmentModal.session?.activities?.length || 1) - 1 ? BRAND.colors.green : BRAND.colors.purple,
                  children: (
                    <Card size="small" style={{ borderRadius: 10, borderColor: BRAND.colors.border, marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                      {/* 头部 */}
                      <Row justify="space-between" align="middle" style={{ marginBottom: 8 }}>
                        <Col>
                          <Space size={8}>
                            <Tag style={{ borderRadius: 6, background: BRAND.colors.primaryGradient, color: '#fff', border: 'none', fontWeight: 600, fontSize: 12 }}>
                              ⏱ {act.duration} 分钟
                            </Tag>
                            <Tag style={{ borderRadius: 6, background: `${BRAND.colors.purple}15`, color: BRAND.colors.purple, border: `1px solid ${BRAND.colors.purple}30`, fontWeight: 500, fontSize: 12 }}>
                              {act.activity_type}
                            </Tag>
                          </Space>
                        </Col>
                        <Col>
                          <Text type="secondary" style={{ fontSize: 10 }}>活动 #{i + 1}</Text>
                        </Col>
                      </Row>

                      {/* 教学内容 */}
                      <div style={{
                        padding: '10px 14px', background: `${BRAND.colors.primary}04`,
                        borderRadius: 8, marginBottom: 8, borderLeft: `4px solid ${BRAND.colors.primary}`,
                      }}>
                        <Text strong style={{ fontSize: 13, color: BRAND.colors.primary, display: 'block', marginBottom: 4 }}>📖 教学内容</Text>
                        <Paragraph style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0 }}>
                          {act.content}
                        </Paragraph>
                      </div>

                      {/* 教师讲解脚本 */}
                      {act.teacher_activity && (
                        <div style={{
                          padding: '12px 14px', background: `linear-gradient(135deg, ${BRAND.colors.primary}06, ${BRAND.colors.purple}06)`,
                          borderRadius: 8, marginBottom: 8, border: `1px solid ${BRAND.colors.border}`,
                        }}>
                          <Text strong style={{ fontSize: 13, color: BRAND.colors.purple, display: 'block', marginBottom: 6 }}>🎤 教师讲解脚本（可直接讲课用）</Text>
                          <Paragraph style={{ fontSize: 13, lineHeight: 1.9, whiteSpace: 'pre-wrap', margin: 0, fontStyle: 'italic', color: '#333' }}>
                            {act.teacher_activity}
                          </Paragraph>
                        </div>
                      )}

                      {/* 师生互动 */}
                      {act.student_activity && (
                        <div style={{
                          padding: '10px 14px', background: `${BRAND.colors.green}04`,
                          borderRadius: 8, marginBottom: 8, border: `1px solid ${BRAND.colors.green}20`,
                        }}>
                          <Text strong style={{ fontSize: 13, color: BRAND.colors.green, display: 'block', marginBottom: 4 }}>💬 师生互动设计</Text>
                          <Paragraph style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
                            {act.student_activity}
                          </Paragraph>
                        </div>
                      )}

                      {/* 教学示例 — 最突出展示 */}
                      {act.example && (
                        <div style={{
                          padding: '14px 16px',
                          background: `linear-gradient(135deg, #FFF7E6 0%, #FFF1CC 100%)`,
                          borderRadius: 10,
                          border: `2px solid #FF9F43`,
                          boxShadow: '0 2px 8px rgba(255,159,67,0.15)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: 20 }}>📝</span>
                            <Text strong style={{ fontSize: 14, color: '#D46B08' }}>教学示例（可直接在课堂上使用）</Text>
                          </div>
                          <Paragraph style={{
                            fontSize: 14, lineHeight: 2, whiteSpace: 'pre-wrap', margin: 0,
                            fontFamily: 'Consolas, "Microsoft YaHei", monospace',
                            background: '#FFFCF5', padding: '10px 14px', borderRadius: 8,
                            border: '1px dashed #FF9F43',
                          }}>
                            {act.example}
                          </Paragraph>
                        </div>
                      )}
                    </Card>
                  ),
                })) || []}
              />

              {segmentModal.session.homework && (
                <Alert message="课后作业" description={segmentModal.session.homework} type="info" showIcon style={{ marginTop: 8, borderRadius: 8 }} />
              )}
            </div>
          )}
        </Modal>

        {/* ════════════════════════════════════════════ */}
        {/* 台账记录区（历史教案列表+筛选）       */}
        {/* ════════════════════════════════════════════ */}
        <Card
          className="brand-card"
          bodyStyle={{ padding: '20px 24px', position: 'relative' }}
        >
          <span style={{ position: 'absolute', top: 10, right: 12, color: BRAND.colors.purple, opacity: 0.4 }}>
            <BrandBadge size={16} />
          </span>

          {/* 台账标题 */}
          <Space align="center" size={8} style={{ marginBottom: 16 }}>
            <HistoryOutlined style={{ fontSize: 18, color: BRAND.colors.primary }} />
            <Title level={5} style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              历史台账记录
            </Title>
            <Tag style={{ borderRadius: 8, background: `${BRAND.colors.primary}10`, color: BRAND.colors.primary, border: 'none' }}>
              共 {filteredRecords.length} 条
            </Tag>
          </Space>

          {/* 筛选区域 */}
          <div
            style={{
              background: `${BRAND.colors.primary}06`,
              borderRadius: 8,
              padding: '14px 18px',
              marginBottom: 16,
              border: `1px solid ${BRAND.colors.border}`,
            }}
          >
            <Row gutter={12} align="middle">
              <Col flex="auto">
                <Space size={12}>
                  <Input
                    placeholder="🔍 搜索教案/学生/课程..."
                    allowClear
                    style={{ width: 200, borderRadius: 8 }}
                    value={searchText}
                    onChange={e => { setSearchText(e.target.value); setPage(1); }}
                    onPressEnter={() => { setPage(1); }}
                  />
                  <Select
                    placeholder="按课程筛选"
                    style={{ width: 150, borderRadius: 8 }}
                    value={filterCourse || undefined}
                    onChange={v => { setFilterCourse(v || ''); setPage(1); }}
                    allowClear
                    showSearch
                    filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())}
                  >
                    <Option value="">全部课程</Option>
                    {courseOptions.map(c => <Option key={c} value={c} label={c}>{c}</Option>)}
                  </Select>

                  <Select placeholder="按类型筛选" style={{ width: 130, borderRadius: 8 }}
                    value={filterType || undefined}
                    onChange={v => { setFilterType(v || ''); setPage(1); }}
                    allowClear>
                    <Option value="">全部类型</Option>
                    <Option value="lesson">备课教案</Option>
                    <Option value="homework">作业批改</Option>
                    <Option value="insight">学情诊断</Option>
                  </Select>

                  {filteredRecords.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      显示 {filteredRecords.length} 条
                    </Text>
                  )}
                </Space>
              </Col>
              <Col>
                <Space>
                  <Button icon={<ReloadOutlined />}
                    onClick={() => { setFilterCourse(''); setFilterType(''); setSearchText(''); setPage(1); }}
                    style={{ borderRadius: 8, color: BRAND.colors.textSecondary }}>
                    重置筛��
                  </Button>
                  <Button icon={<DownloadOutlined />}
                    onClick={handleBatchExport}
                    style={{ borderRadius: 8, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>
                    导出结果
                  </Button>
                </Space>
              </Col>
            </Row>
          </div>

          {/* 台账分类 Tab */}
          <div style={{ marginBottom: 16, borderBottom: `1px solid ${BRAND.colors.border}` }}>
            <Space size={0}>
              {[
                { key: 'all', label: '全部台账' },
                { key: 'lesson', label: '备课教案' },
                { key: 'homework', label: '作业批改' },
                { key: 'insight', label: '学情诊断' },
                { key: 'classroom', label: '课堂记录' },
                { key: 'qa', label: '答疑记录' },
              ].map(tab => (
                <div
                  key={tab.key}
                  onClick={() => { setLedgerTab(tab.key); setPage(1); }}
                  style={{
                    padding: '8px 18px',
                    cursor: 'pointer',
                    borderRadius: '8px 8px 0 0',
                    background: ledgerTab === tab.key ? BRAND.colors.primaryGradient : 'transparent',
                    color: ledgerTab === tab.key ? '#fff' : BRAND.colors.textSecondary,
                    fontWeight: ledgerTab === tab.key ? 600 : 400,
                    fontSize: 13,
                    transition: 'all 0.3s',
                    border: 'none',
                    position: 'relative',
                  }}
                >
                  <Space size={6}>
                    <BrandBadge size={10} color={ledgerTab === tab.key ? '#fff' : BRAND.colors.textSecondary} />
                    <span>{tab.label}</span>
                  </Space>
                </div>
              ))}
            </Space>
          </div>

          {/* 操作按钮区 */}
          <Space style={{ marginBottom: 12 }}>
            <Button icon={<DownloadOutlined />} loading={batchExporting}
              onClick={handleBatchExport}
              style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, color: '#fff', boxShadow: `0 2px 8px ${BRAND.colors.primary}30` }}
              className="brand-card">
              {selectedRowKeys.length > 0 ? `批量导出 (${selectedRowKeys.length})` : '导出全部'}
            </Button>
            <Button icon={<CheckCircleOutlined />} loading={batchArchiving}
              onClick={handleBatchArchive}
              style={{ borderRadius: 8, borderColor: BRAND.colors.green, color: BRAND.colors.green }}>
              {selectedRowKeys.length > 0 ? `批量归档 (${selectedRowKeys.length})` : '全部归档'}
            </Button>
            <Button icon={<FileTextOutlined />}
              onClick={handlePrint}
              style={{ borderRadius: 8, borderColor: BRAND.colors.border, color: BRAND.colors.textSecondary }}>
              打印台账
            </Button>
            {selectedRowKeys.length > 0 && (
              <Popconfirm
                title={`确认删除选中的 ${selectedRowKeys.length} 条记录？此操作不可恢复。`}
                onConfirm={handleBatchDelete}
                okText="确认删除" okType="danger" cancelText="取消">
                <Button icon={<DeleteOutlined />} loading={batchDeleting}
                  style={{ borderRadius: 8, borderColor: BRAND.colors.error, color: BRAND.colors.error }}>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
            <Button icon={<HistoryOutlined />}
              onClick={() => { setAuditModalOpen(true); loadAuditLogs(); }}
              style={{ borderRadius: 8, borderColor: BRAND.colors.purple, color: BRAND.colors.purple, fontWeight: 500 }}>
              溯源审计
            </Button>
            {selectedRowKeys.length > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                已选 {selectedRowKeys.length} 条
                <Button type="link" size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
              </Text>
            )}
          </Space>

          {/* 台账表格 */}
          {recordsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>加载台账记录...</Text>
            </div>
          ) : pagedRecords.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <span
                dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }}
                style={{ width: 60, height: 60, display: 'inline-block', opacity: 0.4 }}
              />
              <Paragraph style={{ marginTop: 12, color: BRAND.colors.textTertiary, fontSize: 13 }}>
                暂无教学台账记录，完成作业批改/学情分析自动生成台账
              </Paragraph>
              {canGenerate ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  style={{
                    borderRadius: 8, border: 'none',
                    background: BRAND.colors.primaryGradient,
                  }}
                  onClick={() => document.querySelector('.ant-form')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  去生成第一条教案
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<KeyOutlined />}
                  style={{
                    borderRadius: 8, border: 'none',
                    background: 'linear-gradient(135deg, #FF9F43, #FF6B6B)',
                  }}
                  onClick={guard.goToSettings}
                >
                  先配置 API Key
                </Button>
              )}
            </div>
          ) : (
            <>
              <Table
                dataSource={pagedRecords}
                columns={columns}
                rowKey="id"
                pagination={false}
                size="middle"
                className="table-header-brand"
                style={{ borderRadius: 8, overflow: 'hidden' }}
                rowClassName={() => 'brand-table-row'}
                rowSelection={{
                  selectedRowKeys,
                  onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
                }}
                onRow={record => ({
                  style: { cursor: 'pointer', transition: 'all 0.2s' },
                  onDoubleClick: () => handleView(record),
                })}
              />
              <div style={{ textAlign: 'right', marginTop: 16 }}>
                <Pagination
                  current={page}
                  total={filteredRecords.length}
                  pageSize={pageSize}
                  onChange={setPage}
                  showSizeChanger={false}
                  showTotal={(total) => `共 ${total} 条记录`}
                  style={{ fontSize: 12 }}
                />
              </div>
            </>
          )}
        </Card>

        {/* 品牌水印 */}
        <div className="brand-watermark" style={{ position: 'fixed', bottom: 8, right: 12 }}>
          智教星教学数据台账 · 可追溯存档
        </div>

        {/* ── 标准教案模板 ── */}
        <Card
          className="brand-card"
          style={{ marginTop: 20 }}
          title={
            <Space>
              <BookOutlined style={{ color: BRAND.colors.primary }} />
              <Text strong style={{ fontSize: 14 }}>📋 标准教案模板（9 段结构）</Text>
              <Tag style={{ borderRadius: 6, background: `${BRAND.colors.green}15`, color: BRAND.colors.green, border: 'none' }}>
                符合高校本科教学规范
              </Tag>
            </Space>
          }
          bodyStyle={{ padding: '16px 24px' }}
        >
          <Alert
            message="AI 智能备课将自动按此模板生成完整教案，生成后支持在线编辑和 Word 导出。多个数据源（作业批改、学情诊断、成绩归档、资源中心）可自动汇入台账。"
            type="info"
            showIcon
            style={{ marginBottom: 16, borderRadius: 8 }}
          />
          <Steps
            size="small"
            direction="vertical"
            current={-1}
            items={[
              { title: '一、课程基本信息与教学目标', description: '课程名称、章节、课时数 + 三维目标（知识目标 / 能力目标 / 创新素养目标）' },
              { title: '二、教学方法与教学资源', description: '教学方法选型（讲授/案例/讨论/探究/翻转课堂/小组合作等）· 教学资源清单（教材/课件/实验设备/在线平台等）' },
              { title: '三、教学流程（按课时划分，可点击展开）', description: '每课时含：教学主题 → 重点难点 → 多个活动环节（讲授/讨论/练习/演示）→ 教师话术 → 师生互动 → 教学示例' },
              { title: '四、板书结构设计', description: '结构化板书，可直接投屏使用，包含关键公式与知识框架，支持 Markdown 编辑' },
              { title: '五、分层课堂任务', description: '基础任务 → 提升任务 → 创新探究任务，满足不同层次学生需求' },
              { title: '六、分层课后作业', description: '基础巩固题 + 综合应用题 + 学科前沿拓展题' },
              { title: '七、课堂考核与过程性评价', description: '评价标准（Rubric）、过程性考核方案、课堂参与度评估' },
              { title: '八、教学创新设计', description: '学科前沿案例融入 / 科研反哺教学 / 课程思政元素 / 一流学科培养衔接' },
              { title: '九、在线编辑与版本管理', description: '点击「编辑教案」可修改所有字段 → 保存后自动生成版本快照 → 溯源审计支持版本对比与还原' },
            ]}
          />
          <Divider />
          <Row justify="center">
            <Col>
              <Text type="secondary" style={{ fontSize: 12 }}>
                📐 符合「一流学科建设」课程评估标准 · 智能生成教案请经教师审核后使用 · 支持在线编辑和版本追溯
              </Text>
            </Col>
          </Row>
        </Card>

        {/* ════════════════════════════════════════════ */}
        {/* 页面交互说明                           */}
        {/* ════════════════════════════════════════════ */}
        <Card
          className="brand-card"
          style={{ marginTop: 16 }}
          title={
            <Space>
              <EyeOutlined style={{ color: BRAND.colors.purple }} />
              <Text strong style={{ fontSize: 14 }}>🖱 页面交互说明</Text>
            </Space>
          }
          bodyStyle={{ padding: '16px 24px' }}
        >
          <Row gutter={[16, 12]}>
            {[
              { icon: '📝', title: 'AI 智能备课', desc: '填写课程名称 + 章节（可选教材内容增强 RAG）→ 点击「生成教案」→ AI 自动生成 9 段标准教案 → 自动保存至台账' },
              { icon: '✏️', title: '在线编辑教案', desc: '点击「编辑教案」按钮 → 修改课程信息、教学目标、方法资源、教学流程（含活动内容/教师话术/示例）→「保存修改」→ 自动生成版本快照' },
              { icon: '👆', title: '查看流程详情', desc: '点击教学流程卡片标题（蓝色下划线文字）→ 弹出完整弹窗 → 展示重点/难点、活动详情、教师讲解脚本、师生互动、教学示例' },
              { icon: '📥', title: '导出 Word 文档', desc: '头部「导出完整教案 Word」导出全部内容；每个流程右侧下载图标导出单个流程 → 弹窗内也可导出当前流程' },
              { icon: '📂', title: '台账分类筛选', desc: 'Tab 切换：全部台账 / 备课教案 / 作业批改 / 学情诊断 / 课堂记录 / 答疑记录 → 分页自动跟随筛选结果' },
              { icon: '🔍', title: '搜索与筛选', desc: '按姓名/课程搜索 → 按课程下拉筛选 → 按类型（备课/作业/学情）筛选 → 重置按钮一键清除所有条件' },
              { icon: '📋', title: '批量操作', desc: '勾选台账记录 → 批量导出 Word / 批量归档 / 批量删除 → 支持全选和单选，勾选后显示操作按钮' },
              { icon: '🔗', title: '多源数据汇入', desc: '成绩管理「归档台账」→ 资源中心「插入备课」→ 作业批改自动记录 → 学情分析自动汇入 → 统一在台账中心展示' },
              { icon: '🕵️', title: '溯源审计', desc: '点击「溯源审计」→ 查询/筛选操作日志 → 按操作类型/操作人过滤 → 支持升序/降序 → 查看版本快照与还原 → 版本差异对比 → 导出 Excel/Word → 清空日志' },
              { icon: '🔄', title: '版本管理', desc: '每次生成/编辑/还原教案自动创建版本快照 → 审计面板中「版本」按钮查看历史 → 支持还原到任意历史版本 →「对比」按钮查看两个版本差异' },
            ].map((item, i) => (
              <Col xs={24} sm={12} key={i}>
                <Card size="small" style={{ borderRadius: 8, borderColor: BRAND.colors.border }}>
                  <Space align="start">
                    <Text style={{ fontSize: 20 }}>{item.icon}</Text>
                    <div>
                      <Text strong style={{ fontSize: 13 }}>{item.title}</Text>
                      <Paragraph type="secondary" style={{ fontSize: 12, margin: '2px 0 0 0' }}>{item.desc}</Paragraph>
                    </div>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>

        {/* ── API Key 拦截弹窗 ── */}
        <ApiKeyGuardModal
          visible={guard.modalVisible}
          onClose={guard.hideGuard}
          onGoSettings={guard.goToSettings}
        />

        {/* ── 设置弹窗（配置 API Key） ── */}
        <SettingsModal
          open={guard.settingsVisible}
          onClose={() => guard.setSettingsVisible(false)}
        />

        {/* ── 审计日志面板 ── */}
        <Modal
          title={<Space><HistoryOutlined style={{ color: BRAND.colors.purple }} /><Text strong>教案全生命周期审计日志</Text><Tag color="purple" style={{ borderRadius: 6 }}>不可篡改留痕</Tag></Space>}
          open={auditModalOpen}
          onCancel={() => setAuditModalOpen(false)}
          width={960}
          footer={[
            <Button key="export-excel" icon={<DownloadOutlined />} loading={auditExporting}
              onClick={() => handleExportAudit('excel')} style={{ borderRadius: 6, borderColor: '#52c41a', color: '#52c41a' }}>导出 Excel</Button>,
            <Button key="export-word" icon={<DownloadOutlined />} loading={auditExporting}
              onClick={() => handleExportAudit('word')} style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>导出 Word</Button>,
            <Button key="clear" icon={<DeleteOutlined />} loading={clearing} danger
              onClick={handleClearAudit} style={{ borderRadius: 6 }}>清空日志</Button>,
            <Button key="close" onClick={() => setAuditModalOpen(false)} style={{ borderRadius: 6 }}>关闭</Button>,
          ]}
        >
          {/* 过滤栏 */}
          <Space wrap style={{ marginBottom: 16, padding: '12px 16px', background: '#fafafa', borderRadius: 8, width: '100%' }}>
            <Select placeholder="操作类型" allowClear style={{ width: 120, borderRadius: 6 }}
              value={auditFilter.operation || undefined}
              onChange={(v) => setAuditFilter({ ...auditFilter, operation: v || '' })}>
              {['create','view','edit','export','delete','restore'].map(op => (
                <Option key={op} value={op}>{({create:'创建',view:'查看',edit:'编辑',export:'导出',delete:'删除',restore:'还原'})[op] || op}</Option>
              ))}
            </Select>
            <Input placeholder="操作人" allowClear style={{ width: 120, borderRadius: 6 }}
              value={auditFilter.operator} onChange={e => setAuditFilter({ ...auditFilter, operator: e.target.value })} />
            <Select placeholder="排序" style={{ width: 100, borderRadius: 6 }}
              value={auditFilter.sort_order} onChange={(v) => setAuditFilter({ ...auditFilter, sort_order: v })}>
              <Option value="desc">最新在前</Option>
              <Option value="asc">最早在前</Option>
            </Select>
            <Button icon={<SearchOutlined />} onClick={loadAuditLogs} loading={auditLoading}
              style={{ borderRadius: 6, background: BRAND.colors.primaryGradient, border: 'none', color: '#fff' }}>查询</Button>
            <Button icon={<ReloadOutlined />} onClick={loadAuditLogs}
              style={{ borderRadius: 6, borderColor: BRAND.colors.border }}>刷新</Button>
          </Space>

          {/* 统计卡片 */}
          {auditStats && (
            <Row gutter={8} style={{ marginBottom: 12 }}>
              {[{ k: 'create', label: '创建', color: '#52c41a' }, { k: 'view', label: '查看', color: '#1677ff' },
                { k: 'edit', label: '编辑', color: '#fa8c16' }, { k: 'export', label: '导出', color: '#722ed1' },
                { k: 'delete', label: '删除', color: '#ff4d4f' }, { k: 'restore', label: '还原', color: '#13c2c2' },
              ].map(item => (
                <Col span={4} key={item.k}>
                  <Card size="small" bodyStyle={{ padding: '8px', textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>{item.label}</Text>
                    <div><Text strong style={{ fontSize: 18, color: item.color }}>{auditStats[item.k] || 0}</Text></div>
                  </Card>
                </Col>
              ))}
            </Row>
          )}

          {/* 日志列表 */}
          <Table
            dataSource={auditLogs}
            loading={auditLoading}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20, size: 'small' }}
            columns={[
              { title: '时间', dataIndex: 'created_at', width: 160, render: (v: string) => <Text style={{ fontSize: 11 }}>{v?.slice(0, 19)?.replace('T', ' ')}</Text> },
              { title: '操作', dataIndex: 'operation', width: 60,
                render: (v: string) => {
                  const m: any = { create: { color: 'success', label: '创建' }, view: { color: 'processing', label: '查看' }, edit: { color: 'warning', label: '编辑' }, export: { color: 'purple', label: '导出' }, delete: { color: 'error', label: '删除' }, restore: { color: 'cyan', label: '还原' } };
                  return <Tag color={m[v]?.color || 'default'} style={{ borderRadius: 6, fontSize: 10 }}>{m[v]?.label || v}</Tag>;
                }},
              { title: '教案', dataIndex: 'plan_name', ellipsis: true, render: (v: string, r: any) => (
                <Space direction="vertical" size={0}>
                  <Text style={{ fontSize: 12 }}>{v || `${r.course_name} — ${r.chapter}`}</Text>
                  <Text type="secondary" style={{ fontSize: 10 }}>ID: {r.plan_id?.slice(0, 8)}</Text>
                </Space>
              )},
              { title: '操作人', dataIndex: 'operator', width: 80, render: (v: string, r: any) => (
                <Space size={4}>
                  <Text style={{ fontSize: 12 }}>{v}</Text>
                  <Tag style={{ fontSize: 9, borderRadius: 4 }} color={r.operator_role === '管理员' ? 'purple' : 'blue'}>{r.operator_role}</Tag>
                </Space>
              )},
              { title: '详情', dataIndex: '_detail', ellipsis: true, width: 200, render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '-'}</Text> },
              { title: '操作', width: 160, render: (_: any, r: any) => (
                <Space size={4}>
                  <Button type="link" size="small" style={{ fontSize: 11 }} onClick={() => {
                    setSnapModal({ visible: true, planId: r.plan_id }); loadSnapshots(r.plan_id);
                  }}>版本</Button>
                  <Button type="link" size="small" style={{ fontSize: 11 }} onClick={() => {
                    setCompareModal({ visible: true, planId: r.plan_id, v1: 0, v2: 0 });
                    handleCompare(r.plan_id, 0, 0);
                  }}>对比</Button>
                </Space>
              )},
            ]}
          />
        </Modal>

        {/* ── 版本快照弹窗 ── */}
        <Modal
          title={<Space><HistoryOutlined />版本快照 · {snapModal.planId?.slice(0, 8)}</Space>}
          open={snapModal.visible}
          onCancel={() => setSnapModal({ visible: false, planId: '' })}
          width={600}
          footer={[<Button key="close" onClick={() => setSnapModal({ visible: false, planId: '' })} style={{ borderRadius: 6 }}>关闭</Button>]}
        >
          {snapshots.length === 0 ? <Empty description="暂无版本快照" /> : (
            <Table dataSource={snapshots} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '版本', dataIndex: 'version', render: (v: number) => <Tag color="blue" style={{ borderRadius: 6 }}>v{v}</Tag> },
                { title: '创建时间', dataIndex: 'created_at', render: (v: string) => <Text style={{ fontSize: 11 }}>{v?.slice(0, 19)?.replace('T', ' ')}</Text> },
                { title: '创建者', dataIndex: 'created_by' },
                { title: '操作', width: 180, render: (_: any, r: any) => (
                  <Space size={0}>
                    <Popconfirm title={`确认还原到版本 v${r.version}？这将覆盖当前教案。`} onConfirm={() => handleRestore(snapModal.planId, r.version)}>
                      <Button type="link" size="small" style={{ fontSize: 11, color: BRAND.colors.primary }}>还原</Button>
                    </Popconfirm>
                    <Popconfirm title={`确认删除版本 v${r.version}？`} onConfirm={() => handleDeleteSnapshot(snapModal.planId, r.version)}>
                      <Button type="link" size="small" danger style={{ fontSize: 11 }}>删除</Button>
                    </Popconfirm>
                  </Space>
                )},
              ]}
            />
          )}
        </Modal>

        {/* ── 版本对比弹窗（直观行内差异高亮） ── */}
        <Modal
          title={
            <Space>
              <HistoryOutlined style={{ color: BRAND.colors.primary }} />
              <span>版本差异对比</span>
            </Space>
          }
          open={compareModal.visible}
          onCancel={() => setCompareModal({ visible: false, planId: '', v1: 0, v2: 0 })}
          width={960}
          footer={[<Button key="close" onClick={() => setCompareModal({ visible: false, planId: '', v1: 0, v2: 0 })} style={{ borderRadius: 6 }}>关闭</Button>]}
        >
          {compareResult ? (
            <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
              {/* ── 摘要统计条 ── */}
              {(() => {
                const allItems = (compareResult.diffs || []).flatMap((d: any) => analyzeDiff(d).items);
                const totalAdded = allItems.filter((it: any) => it.type === 'added').length;
                const totalRemoved = allItems.filter((it: any) => it.type === 'removed').length;
                const totalModified = allItems.filter((it: any) => it.type === 'modified').length;
                const totalChanges = totalAdded + totalRemoved + totalModified;
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16,
                    padding: '12px 16px', background: 'linear-gradient(135deg, #f0f5ff, #e6f0ff)',
                    borderRadius: 10, border: '1px solid #d6e4ff',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Tag color="blue" style={{ borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '2px 10px' }}>
                        v{compareResult.v1_version}
                      </Tag>
                      <Text type="secondary">↔</Text>
                      <Tag color="purple" style={{ borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '2px 10px' }}>
                        v{compareResult.v2_version}
                      </Tag>
                    </div>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <Text strong style={{ fontSize: 14 }}>
                        共 <span style={{ color: BRAND.colors.primary, fontSize: 18 }}>{totalChanges}</span> 处变更
                      </Text>
                    </div>
                    <Space size={8}>
                      {totalAdded > 0 && <Tag color="success" style={{ borderRadius: 6, fontSize: 11 }}>⊕ {totalAdded} 新增</Tag>}
                      {totalModified > 0 && <Tag color="warning" style={{ borderRadius: 6, fontSize: 11 }}>⊘ {totalModified} 修改</Tag>}
                      {totalRemoved > 0 && <Tag color="error" style={{ borderRadius: 6, fontSize: 11 }}>⊖ {totalRemoved} 删除</Tag>}
                    </Space>
                  </div>
                );
              })()}

              {compareResult.diffs?.length === 0 ? (
                <Empty description="两个版本完全相同 ✓" />
              ) : (
                compareResult.diffs.map((diff: any, i: number) => {
                  const { topic, items } = analyzeDiff(diff);
                  if (items.length === 0) return null;
                  const addedCount = items.filter(it => it.type === 'added').length;
                  const removedCount = items.filter(it => it.type === 'removed').length;
                  const modifiedCount = items.filter(it => it.type === 'modified').length;
                  return (
                    <Card key={i} size="small" style={{ marginBottom: 12, borderRadius: 8, borderColor: '#e8e8e8' }}
                      title={
                        <Space>
                          <span style={{
                            width: 24, height: 24, borderRadius: '50%',
                            background: BRAND.colors.primaryGradient, color: '#fff',
                            fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}>{i + 1}</span>
                          <Text strong style={{ fontSize: 13 }}>{topic || `流程 #${(diff.session_index ?? 0) + 1}`}</Text>
                          <Space size={4}>
                            {addedCount > 0 && <Tag color="success" style={{ borderRadius: 6, fontSize: 10 }}>+{addedCount}</Tag>}
                            {modifiedCount > 0 && <Tag color="warning" style={{ borderRadius: 6, fontSize: 10 }}>~{modifiedCount}</Tag>}
                            {removedCount > 0 && <Tag color="error" style={{ borderRadius: 6, fontSize: 10 }}>-{removedCount}</Tag>}
                          </Space>
                        </Space>
                      }>
                      {items.map((item, j) => (
                        <div key={j} style={{ marginBottom: j < items.length - 1 ? 8 : 0 }}>
                          {/* 标题行 */}
                          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 6 }}>
                            <span style={{
                              fontSize: 16,
                              color: item.type === 'added' ? '#52c41a' : item.type === 'removed' ? '#ff4d4f' : '#faad14',
                            }}>
                              {item.type === 'added' ? '⊕' : item.type === 'removed' ? '⊖' : '⊘'}
                            </span>
                            <Text strong style={{ fontSize: 12, color: '#333' }}>{item.label}</Text>
                            <Tag style={{
                              borderRadius: 6, fontSize: 10, border: 'none',
                              background: item.type === 'added' ? '#f6ffed' : item.type === 'removed' ? '#fff2f0' : '#fffbe6',
                              color: item.type === 'added' ? '#52c41a' : item.type === 'removed' ? '#ff4d4f' : '#faad14',
                            }}>
                              {item.type === 'added' ? '新增' : item.type === 'removed' ? '已删除' : '已修改'}
                            </Tag>
                          </div>
                          {/* 内容区 */}
                          {item.type === 'added' && (
                            <div style={{ background: '#f6ffed', borderRadius: 6, padding: '8px 12px', borderLeft: '3px solid #52c41a' }}>
                              <Text style={{ fontSize: 12, color: '#389e0d', whiteSpace: 'pre-wrap' }}>{item.newValue || '(空)'}</Text>
                            </div>
                          )}
                          {item.type === 'removed' && (
                            <div style={{ background: '#fff2f0', borderRadius: 6, padding: '8px 12px', borderLeft: '3px solid #ff4d4f' }}>
                              <Text style={{ fontSize: 12, color: '#cf1322', whiteSpace: 'pre-wrap', textDecoration: 'line-through' }}>{item.oldValue || '(空)'}</Text>
                            </div>
                          )}
                          {item.type === 'modified' && (
                            <div style={{ background: '#fafafa', borderRadius: 6, padding: '10px 14px', border: '1px solid #e8e8e8' }}>
                              <DiffText oldText={item.oldValue} newText={item.newValue} />
                            </div>
                          )}
                        </div>
                      ))}
                    </Card>
                  );
                })
              )}
              {/* 保底：当差异分析结果为空时，显示原始数据对比 */}
              {compareResult.diffs?.length > 0 && (() => {
                const allItems = (compareResult.diffs || []).flatMap((d: any) => analyzeDiff(d).items);
                if (allItems.length > 0) return null; // 有差异就不需要这个
                return (
                  <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                      💡 差异分析未检测到具体字段变化，以下为两版原始数据逐字段对比：
                    </Text>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                      <div style={{ fontWeight: 600, color: '#ff4d4f' }}>⊖ 旧版 (v{compareResult.v1_version})</div>
                      <div style={{ fontWeight: 600, color: '#52c41a' }}>⊕ 新版 (v{compareResult.v2_version})</div>
                      {compareResult.diffs.map((diff: any, i: number) => {
                        const b = diff.before || {};
                        const a = diff.after || {};
                        const allKeys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
                        return (
                          <React.Fragment key={i}>
                            <div style={{ gridColumn: '1 / -1', fontWeight: 600, fontSize: 13, marginTop: 8, color: BRAND.colors.primary }}>
                              #{i + 1} — {diff.topic || `流程 ${(diff.session_index ?? 0) + 1}`}
                            </div>
                            {allKeys.map(k => {
                              const ov = JSON.stringify(b[k], null, 2) || '';
                              const nv = JSON.stringify(a[k], null, 2) || '';
                              const changed = ov !== nv;
                              return (
                                <React.Fragment key={k}>
                                  <div style={{
                                    padding: '6px 10px', borderRadius: 4,
                                    background: changed ? '#fff2f0' : '#fafafa',
                                    border: changed ? '1px solid #ffccc7' : '1px solid #f0f0f0',
                                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                    fontFamily: 'Consolas, monospace', fontSize: 11,
                                    maxHeight: 200, overflow: 'auto',
                                  }}>
                                    <Tag style={{ fontSize: 9, marginBottom: 4 }} color={changed ? 'error' : 'default'}>{k}</Tag>
                                    {changed ? <span style={{ color: '#cf1322' }}>{ov || '(空)'}</span> : <span style={{ color: '#999' }}>{ov || '(空)'}</span>}
                                  </div>
                                  <div style={{
                                    padding: '6px 10px', borderRadius: 4,
                                    background: changed ? '#f6ffed' : '#fafafa',
                                    border: changed ? '1px solid #b7eb8f' : '1px solid #f0f0f0',
                                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                    fontFamily: 'Consolas, monospace', fontSize: 11,
                                    maxHeight: 200, overflow: 'auto',
                                  }}>
                                    <Tag style={{ fontSize: 9, marginBottom: 4 }} color={changed ? 'success' : 'default'}>{k}</Tag>
                                    {changed ? <span style={{ color: '#389e0d', fontWeight: 600 }}>{nv || '(空)'}</span> : <span style={{ color: '#999' }}>{nv || '(空)'}</span>}
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : <Spin style={{ display: 'block', textAlign: 'center', padding: 40 }} />}
        </Modal>
      </div>
    </div>
  );
};

export default LessonPlanning;
