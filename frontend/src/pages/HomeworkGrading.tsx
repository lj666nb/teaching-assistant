/**
 * 作业智能辅批 — Edu-TA 智教星 三大标签页
 *
 * Tab1 智能批改：单题手动批改 + 8大模块批改报告
 * Tab2 出题助手：AI分层出题 + 导出Word/保存题库
 * Tab3 文件批改：批量上传文件 + CSV/TXT/PDF批量批改
 * 所有AI功能受API Key守卫保护
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Card, Form, Input, Select, InputNumber, Button, Spin, Alert, Typography,
  Tag, Divider, Space, Tabs, Descriptions, List, Progress, Row, Col,
  Statistic, message, Collapse, Table, Tooltip, Empty, Modal, Popconfirm,
  AutoComplete, Upload,
} from 'antd';
import {
  RobotOutlined, CheckCircleOutlined, CloseCircleOutlined, BulbOutlined,
  BookOutlined, ThunderboltOutlined, FileAddOutlined, UploadOutlined,
  InboxOutlined, FileTextOutlined, FilePdfOutlined, FileWordOutlined,
  DeleteOutlined, DownloadOutlined, HistoryOutlined, KeyOutlined,
  StarOutlined, CodeOutlined, ExperimentOutlined, SaveOutlined,
  BarChartOutlined, FileImageOutlined, DatabaseOutlined, ReloadOutlined,
  ClockCircleOutlined, EyeOutlined, EditOutlined, SendOutlined,
} from '@ant-design/icons';
import { homeworkApi, materialApi, ExerciseRequest, knowledgeApi } from '../api/client';
import { BRAND, CARD_SPECS } from '../utils/brand';
import { useApiKeyGuard, ApiKeyGuardModal, ApiKeyBanner, DisabledAIButton } from '../utils/apiKeyGuard';
import SettingsModal from '../components/SettingsModal';
import '../styles/brand.css';
import { useDataVisibility } from '../context/DataVisibilityContext';

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

const BrandBadge: React.FC<{ size?: number; color?: string }> = ({ size = 14, color }) => (
  <span dangerouslySetInnerHTML={{ __html: BRAND.badgeSvg.replace('currentColor', color || BRAND.colors.primary) }}
    style={{ width: size, height: size, display: 'inline-flex', verticalAlign: 'middle', flexShrink: 0 }} />
);

// 课程选项 — 动态从后端加载
const questionTypeOptions = [
  { value: '选择题', label: '选择题' }, { value: '多选题', label: '多选题' },
  { value: '判断题', label: '判断题' }, { value: '填空题', label: '填空题' },
  { value: '简答题', label: '简答题' }, { value: '证明题', label: '证明题' },
  { value: '代码编程题', label: '代码编程题' }, { value: '计算题', label: '计算题' },
];

const difficultyOptions = [
  { value: '基础', label: '基础' }, { value: '提高', label: '提高' },
  { value: '综合', label: '综合' }, { value: '拓展', label: '拓展' },
];

const HomeworkGrading: React.FC = () => {
  const { visible } = useDataVisibility();
  const [exerciseForm] = Form.useForm();

  // API Key 守卫
  const guard = useApiKeyGuard();
  const canGenerate = guard.hasKey;

  // 出题状态
  const [generating, setGenerating] = useState(false);
  const [exercises, setExercises] = useState<any[]>([]);
  const [exError, setExError] = useState('');
  const [savedQuestions, setSavedQuestions] = useState<any[]>([]);  // 已保存到题库的题目（含ID）
  const [savingToBank, setSavingToBank] = useState(false);
  const [publishExModalOpen, setPublishExModalOpen] = useState(false);
  const [publishExTitle, setPublishExTitle] = useState('');
  const [publishExDeadline, setPublishExDeadline] = useState('');
  const [publishingEx, setPublishingEx] = useState(false);
  const [publishedExList, setPublishedExList] = useState<any[]>([]);
  const [pubExLoading, setPubExLoading] = useState(false);
  const [selectedExIds, setSelectedExIds] = useState<string[]>([]);

  // 文件批改
  interface UploadedFileItem {
    uid: string; name: string; size: number; type: 'csv' | 'txt' | 'pdf' | 'word' | 'image';
    file: File; status: 'pending' | 'parsing' | 'parsed' | 'error'; recordCount?: number; errorMessage?: string;
  }
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([]);
  const [fileSubmissions, setFileSubmissions] = useState<any[]>([]);
  const [batchGrading, setBatchGrading] = useState(false);
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [batchError, setBatchError] = useState('');
  const [resultFileFilter, setResultFileFilter] = useState<string | null>(null); // 按文件筛选批改结果

  // 编辑功能
  const [editingSubmission, setEditingSubmission] = useState<{ index: number; data: any } | null>(null);
  const [editingResult, setEditingResult] = useState<{ index: number; data: any } | null>(null);

  // 答案文件
  const [answerFile, setAnswerFile] = useState<{ name: string; content: string } | null>(null);
  const [answerUploading, setAnswerUploading] = useState(false);
  // 答案文件解析后的结构化映射：题号 → { 答案, 题型 }
  interface ParsedAnswerEntry { answer: string; type: '选择题' | '判断题' | '填空题'; }
  const [answerMap, setAnswerMap] = useState<Record<number, ParsedAnswerEntry>>({});
  const [answerStats, setAnswerStats] = useState<{ choice: number; tf: number; fill: number; total: number }>({ choice: 0, tf: 0, fill: 0, total: 0 });

  const handleAnswerFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    setAnswerUploading(true);
    try {
      let text = '';
      if (ext === 'txt') {
        // TXT 文件直接读取，避免被批改 API 解析为作业提交格式
        text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('读取失败'));
          reader.readAsText(file, 'UTF-8');
        });
      } else {
        // PDF/Word 通过后端提取文本
        const res = await homeworkApi.uploadFile(file, '');
        if (res.data.success) {
          const data = res.data.data;
          // 优先取 raw_text（后端返回的原始提取文本），其次 full_text
          text = data?.raw_text || data?.full_text
            || (data?.results || []).map((r: any) => {
              const parts = [];
              if (r.question_text) parts.push(r.question_text);
              if (r.student_answer) parts.push(r.student_answer);
              return parts.join('\n');
            }).join('\n\n')
            || '';
        }
      }
      if (text.trim()) {
        setAnswerFile({ name: file.name, content: text });
        // 解析答案文件，构建题号→答案映射
        const { map, stats } = parseAnswerFileToMap(text);
        setAnswerMap(map);
        setAnswerStats(stats);
        if (stats.total > 0) {
          const parts: string[] = [];
          if (stats.choice > 0) parts.push(`${stats.choice} 道选择题`);
          if (stats.tf > 0) parts.push(`${stats.tf} 道判断题`);
          if (stats.fill > 0) parts.push(`${stats.fill} 道填空题`);
          message.success(`已加载答案文件「${file.name}」（已解析 ${stats.total} 道题：${parts.join(' + ')}）`);
        } else {
          message.success(`已加载答案文件「${file.name}」（${text.length} 字符，未能自动解析题号答案，将使用全文匹配）`);
        }
      } else {
        message.error('答案文件未能提取到文本内容');
      }
    } catch (e: any) {
      message.error('答案文件上传失败: ' + (e.message || '未知错误'));
    } finally {
      setAnswerUploading(false);
      e.target.value = '';
    }
  };

  // 历史记录侧栏
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySelectedKeys, setHistorySelectedKeys] = useState<React.Key[]>([]);

  const loadHistoryRecords = async () => {
    setHistoryLoading(true);
    try {
      const res = await homeworkApi.listGrades();
      if (res.data.success) {
        setHistoryRecords(res.data.data?.items || []);
      }
    } catch { /* ignore */ }
    finally { setHistoryLoading(false); }
  };

  const handleOpenHistory = () => {
    setHistoryVisible(true);
    loadHistoryRecords();
  };

  // 出题助手 — 动态课程/章节/知识点数据
  const [courseList, setCourseList] = useState<string[]>([]);
  const [chapterList, setChapterList] = useState<string[]>([]);
  const [kpList, setKpList] = useState<string[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [kpLoading, setKpLoading] = useState(false);
  const [chapterOpen, setChapterOpen] = useState(false);

  // ── 知识库文档管理状态 ──
  const [kbStatus, setKbStatus] = useState<any>(null);
  const [kbStatusLoading, setKbStatusLoading] = useState(false);
  const [kbStatusError, setKbStatusError] = useState('');
  const [kbDocuments, setKbDocuments] = useState<any[]>([]);
  const [kbDocsLoading, setKbDocsLoading] = useState(false);
  // 隐藏模式下过滤系统生成文件
  const displayKbDocuments = React.useMemo(() =>
    visible ? kbDocuments : kbDocuments.filter(d => d._source !== 'seed'),
  [kbDocuments, visible]);
  const [kbUploading, setKbUploading] = useState(false);
  const [kbUploadLog, setKbUploadLog] = useState<string[]>([]);
  const [kbUploadModal, setKbUploadModal] = useState(false);
  const [kbUploadForm] = Form.useForm();
  const kbStatusTimerRef = React.useRef<ReturnType<typeof setTimeout>>();

  // ── 查看文档内容 ──
  const [viewDoc, setViewDoc] = useState<{ name: string; course: string } | null>(null);
  const [viewContent, setViewContent] = useState<any>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const handleViewDocument = async (record: any) => {
    setViewDoc({ name: record.name, course: record.course || record.name });
    setViewContent(null);
    setViewLoading(true);
    try {
      const res = await knowledgeApi.getCollectionContent(record.course || record.name);
      if (res.data.success) {
        setViewContent(res.data.data);
      } else {
        setViewContent({ error: res.data.message || '获取失败' });
      }
    } catch (e: any) {
      setViewContent({ error: e.response?.data?.detail || e.message || '请求失败' });
    } finally {
      setViewLoading(false);
    }
  };

  // 加载课程列表
  useEffect(() => {
    knowledgeApi.listCourses().then(res => {
      if (res.data.success) setCourseList(res.data.data.courses);
    }).catch(() => {});
  }, []);

  // 选课 → 加载章节 + 整门课知识点
  const handleCourseChange = (course: string) => {
    exerciseForm.setFieldsValue({ chapter: undefined, knowledge_points: [] });
    setChapterList([]); setKpList([]);
    if (!course) return;
    setChaptersLoading(true);
    knowledgeApi.listChapters(course).then(res => {
      if (res.data.success) setChapterList(res.data.data.chapters);
    }).catch(() => {}).finally(() => setChaptersLoading(false));
    // 同时加载整门课的全部知识点（不依赖章节选择）
    setKpLoading(true);
    knowledgeApi.listKnowledgePoints(course).then(res => {
      if (res.data.success) setKpList(res.data.data.knowledge_points);
    }).catch(() => {}).finally(() => setKpLoading(false));
  };

  // 选章节 → 加载该章节知识点（有章节则覆盖整门课的知识点列表）
  const handleChapterChange = (chapter: string) => {
    const course = exerciseForm.getFieldValue('course_name');
    exerciseForm.setFieldsValue({ knowledge_points: [] });
    setKpList([]);
    if (!course) return;
    setKpLoading(true);
    knowledgeApi.listKnowledgePoints(course, chapter).then(res => {
      if (res.data.success) setKpList(res.data.data.knowledge_points);
    }).catch(() => {}).finally(() => setKpLoading(false));
  };

  const getFileType = (fileName: string): UploadedFileItem['type'] => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'csv') return 'csv'; if (ext === 'txt') return 'txt';
    if (ext === 'pdf') return 'pdf'; if (ext === 'docx' || ext === 'doc') return 'word';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
    return 'txt';
  };

  const getFileIcon = (type: UploadedFileItem['type']) => {
    switch (type) {
      case 'csv': return <FileTextOutlined style={{ color: '#52c41a' }} />;
      case 'txt': return <FileTextOutlined style={{ color: '#1677ff' }} />;
      case 'pdf': return <FilePdfOutlined style={{ color: '#ff4d4f' }} />;
      case 'word': return <FileWordOutlined style={{ color: '#2f54eb' }} />;
      case 'image': return <FileImageOutlined style={{ color: '#fa8c16' }} />;
    }
  };

  const parseCSVLine = (line: string): string[] => {
    const cols: string[] = []; let current = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') { if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; } else inQuotes = false; }
        else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',' || ch === '\t') { cols.push(current.trim()); current = ''; }
        else current += ch;
      }
    }
    cols.push(current.trim());
    return cols;
  };

  // 清理学生答案：从 "B. 支持向量机" / "(A)" / "答案是C" 中提取纯选项字母或判断结论
  const cleanStudentAnswer = (raw: string, qType: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    // 选择题/多选题 → 提取选项字母
    if (qType === '选择题' || qType === '多选题') {
      // "B.xxx" / "(B)" / "答案B" / "选B" → 提取字母
      const letterMatch = trimmed.match(/^([A-Da-d])\s*[.、．,，)）\]】]?\s*/);
      if (letterMatch) return letterMatch[1].toUpperCase();
      const bracketMatch = trimmed.match(/[\(（【\[]\s*([A-Da-d])\s*[\)）】\]\)]/);
      if (bracketMatch) return bracketMatch[1].toUpperCase();
      const prefixMatch = trimmed.match(/(?:答案|正确选项|选项|选|选择|填)\s*(?:是|为|：|:)?\s*([A-Da-d])/i);
      if (prefixMatch) return prefixMatch[1].toUpperCase();
      // 纯字母
      if (/^[A-Da-d]$/.test(trimmed)) return trimmed.toUpperCase();
      // 多选题字母序列
      if (qType === '多选题' && /^[A-Da-d,\s、]+$/.test(trimmed)) {
        return trimmed.toUpperCase().replace(/[,，、\s]+/g, '');
      }
    }
    // 判断题 → 统一为 正确/错误
    if (qType === '判断题') {
      if (/^(正确|对|√|✓|TRUE|T|YES|Y|是)$/i.test(trimmed)) return '正确';
      if (/^(错误|错|×|✗|FALSE|F|NO|N|否)$/i.test(trimmed)) return '错误';
    }
    return trimmed;
  };

  // ══════════════════════════════════════════════════════════
  // 答案文件解析：从答案文件文本中提取结构化题号→答案映射
  // 支持选择题（A-D）、判断题（正确/错误）、填空题（文本）
  // ══════════════════════════════════════════════════════════

  /** 判断一个字符串是否像选项标签（如 "A.xxx" / "(B)" / "C、" 等） */
  const looksLikeOptionLabel = (text: string): boolean => {
    const trimmed = text.trim();
    return /^[A-Da-d]\s*[.、．,)）\]】]/.test(trimmed)
      || /[\(（【\[]\s*[A-Da-d]\s*[\)）\]】]/.test(trimmed);
  };

  /** 判断一行文本是否是选项列表行（如 "A.xxx B.xxx C.xxx D.xxx"），不应作为答案 */
  /** 判断文本是否像题目/章节标题（非答案内容） */
  const looksLikeQuestionOrHeader = (text: string): boolean => {
    const t = text.trim();
    return /[？?]/.test(t)
      || /^(一|二|三|四|五|六|七|八|九|十)[、.．]/.test(t)
      || /^(选择题|判断题|填空题|简答题|计算题|论述题|证明题|多选题|综合题)/.test(t)
      || /^(第[一二三四五六七八九十\d]+[章节单元]|[一二三四五六七八九十\d]+[、.．])/.test(t)
      || t.length > 80;
  };

  /** 判断文本是否像简答题/论述题等主观题答案（非填空题） */
  const looksLikeSubjectiveAnswer = (text: string): boolean => {
    const t = text.trim();
    // 包含多个句子（句号、分号、换行）→ 主观题
    if ((t.match(/[。；;，,\n]/g) || []).length >= 2) return true;
    // 包含论述性关键词 → 主观题
    if (/根据|因此|所以|首先|其次|最后|综上|总之|例如|比如|因为|由于|从而|进而/.test(t)) return true;
    // 过长 → 不像填空题（填空题答案通常简短）
    if (t.length > 80) return true;
    return false;
  };

  /** 识别答案类型：选择题(A-D) / 判断题(正确/错误) / 填空题(文本) / 未知 */
  const detectAnswerType = (raw: string): '选择题' | '判断题' | '填空题' | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // 判断题（优先检测，避免"T"/"F"被当成选择题字母）
    if (/^(正确|错误|对|错|√|×|✓|✗|TRUE|FALSE|YES|NO)$/i.test(trimmed)) return '判断题';

    // 选择题：纯字母 A-D（单字母）
    if (/^[A-Da-d]$/.test(trimmed)) return '选择题';
    // 选择题：带描述 "B.xxx" / "(B)" / "B、xxx"
    if (looksLikeOptionLabel(trimmed)) return '选择题';
    // 选择题：带前缀 "答案B" / "选B"
    if (/(?:答案|正确选项|选项|选|选择)\s*(?:是|为|：|:)?\s*[A-Da-d]/i.test(trimmed)) return '选择题';
    // 多选题：多个字母
    if (/^[A-Da-d,\s、]+$/.test(trimmed) && (trimmed.match(/[A-Da-d]/gi) || []).length >= 2) return '选择题';

    // 填空题：短文本答案，排除题目/标题和明显的主观题答案
    if (trimmed.length >= 1 && !looksLikeQuestionOrHeader(trimmed) && !looksLikeSubjectiveAnswer(trimmed)) {
      return '填空题';
    }

    return null;
  };

  /** 标准化答案值：统一大小写和表述 */
  const normalizeAnswerValue = (raw: string, type: '选择题' | '判断题' | '填空题'): string => {
    if (type === '选择题') return raw.trim().toUpperCase();
    if (type === '判断题') {
      if (/^(正确|对|√|✓|TRUE|T|YES|Y|是)$/i.test(raw.trim())) return '正确';
      return '错误';
    }
    // 填空题：保留原文
    return raw.trim();
  };

  /** 从题目文本中提取题号（支持"第1题"/"1."/"1、"等格式） */
  const extractQuestionNumber = (questionText: string): number | null => {
    // 中文数字映射
    const CN_NUM: Record<string, number> = {
      '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,
      '十一':11,'十二':12,'十三':13,'十四':14,'十五':15,'十六':16,'十七':17,'十八':18,'十九':19,'二十':20,
    };
    // 格式1: "第1题" / "第 1 题" / "第一题"
    let m = questionText.match(/第\s*(\d+|[一二三四五六七八九十]+)\s*题/);
    if (m) {
      const cap = m[1];
      return CN_NUM[cap] ?? parseInt(cap);
    }
    // 格式2: "1." / "1、" / "1)" / "1题" / "1、" / "(1)" / "（1）" / "[1]"
    m = questionText.match(/^\s*[\(（\[]?\s*(\d+)\s*[\)）\]]?\s*[.、．)）题]/);
    if (m) return parseInt(m[1]);
    // 格式3: 纯数字 "1" / "01" / "001"
    m = questionText.match(/^\s*0*(\d+)\s*$/);
    if (m) return parseInt(m[1]);
    // 格式4: "Q1" / "Q.1" / "q1"
    m = questionText.match(/Q\.?\s*(\d+)/i);
    if (m) return parseInt(m[1]);
    // 格式5: "题目1" / "题目 1" / "题目一"
    m = questionText.match(/题目\s*(\d+|[一二三四五六七八九十]+)/);
    if (m) {
      const cap = m[1];
      return CN_NUM[cap] ?? parseInt(cap);
    }
    // 格式6: "(1)" / "（1）" / "[1]" 作为开头
    m = questionText.match(/^\s*[\(（\[]\s*(\d+)\s*[\)）\]]/);
    if (m) return parseInt(m[1]);
    // 格式7: 中文数字开头 "一、" / "一." / "一）" → 提取题号
    m = questionText.match(/^\s*([一二三四五六七八九十]+)\s*[.、．)）]/);
    if (m) return CN_NUM[m[1]] ?? null;
    return null;
  };

  /**
   * 解析答案文件文本，构建题号→答案映射。
   *
   * 解析策略（按可靠性排序）：
   *   1. "答案：X" 显式标记 — 最可靠，优先处理
   *   2. 逐行 "1. B" / "2) 正确" 格式
   *   3. 紧凑范围 "1-5: BCDAB"
   *   4. 空格分隔 "1B 2C"
   *   5. 纯字母序列（无题号）— 仅在其他格式无结果时使用
   *
   * ⚠️ 关键修复：过滤选项标签行（A.xxx B.xxx C.xxx D.xxx），
   *    避免被误当作答案序列。
   */
  const parseAnswerFileToMap = (text: string): {
    map: Record<number, ParsedAnswerEntry>;
    stats: { choice: number; tf: number; fill: number; total: number };
  } => {
    const map: Record<number, ParsedAnswerEntry> = {};
    const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    // ⚠️ 性能优化：超过 500 行只取前 500 行（足够覆盖几乎所有答案文件）
    const lines = rawLines.length > 500
      ? rawLines.slice(0, 500).filter(l => l.trim())
      : rawLines.filter(l => l.trim());
    if (lines.length === 0) return { map, stats: { choice: 0, tf: 0, fill: 0, total: 0 } };

    // ── 预处理：标记选项列表行（单次遍历） ──
    const optionListLines = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      const lt = lines[i].trim();
      // 选项列表行：一行含 3+ 个选项标记
      if ((lt.match(/\b([A-Da-d])\s*[.、．)]/g) || []).length >= 3) {
        optionListLines.add(i);
      }
      // 单选项描述行 "A.xxx"（非答案的选项展示）
      else if (/^[A-Da-d]\s*[.、．)]\s*\S/.test(lt) && lt.length > 4) {
        optionListLines.add(i);
      }
    }

    // ════════════════════════════════════════════════════
    // 第一步：显式答案标记 "答案：X" — 最可靠，优先处理
    // ════════════════════════════════════════════════════
    // 增强版正则：允许题号和"答案"之间有任意内容（跨选项文本）
    // 逐行解析"答案：X"标记，避免跨行全局正则导致的性能问题
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ansMatch = line.match(/(?:答案|正确选项|Answer|Ans)\s*[：:]\s*(.+)/i);
      if (!ansMatch) continue;
      const rawAnswer = ansMatch[1].trim();
      if (looksLikeQuestionOrHeader(rawAnswer)) continue;
      const type = detectAnswerType(rawAnswer);
      if (!type) continue;
      let qNum: number | null = null;
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const prevLine = lines[j].trim();
        if (optionListLines.has(j)) continue;
        const numMatch = prevLine.match(/(\d+)\s*[.、．)]?\s*/);
        if (numMatch) { qNum = parseInt(numMatch[1]); break; }
        const diMatch = prevLine.match(/第\s*(\d+)\s*题/);
        if (diMatch) { qNum = parseInt(diMatch[1]); break; }
      }
      if (qNum !== null && !map[qNum]) {
        map[qNum] = { answer: normalizeAnswerValue(rawAnswer, type), type };
      }
    }
    if (Object.keys(map).length >= 2) {
      const stats = computeAnswerStats(map);
      console.log(`答案文件解析(显式答案标记): ${stats.total} 题 (选择${stats.choice} 判断${stats.tf} 填空${stats.fill})`);
      return { map, stats };
    }

    // ════════════════════════════════════════════════════
    // 第二步：逐行格式 "1. B" / "2) 正确" / "3、支持向量机"
    // ════════════════════════════════════════════════════
    const perLineRegex = /^\s*[\(（\[]?\s*(\d+)\s*[\)）\]]?\s*[.、．)）]?\s*(.+)/;
    let perLineMatched = 0;

    for (let i = 0; i < lines.length; i++) {
      if (optionListLines.has(i)) continue; // 跳过选项行
      const line = lines[i];
      if (looksLikeQuestionOrHeader(line)) continue;

      const m = line.match(perLineRegex);
      if (!m) continue;
      const qNum = parseInt(m[1]);
      const rawAnswer = m[2].trim();

      // 跳过看起来像选项标签的答案（如 "A. 监督学习"）
      if (looksLikeOptionLabel(rawAnswer)) continue;
      if (looksLikeQuestionOrHeader(rawAnswer)) continue;

      const type = detectAnswerType(rawAnswer);
      if (!type) continue;

      perLineMatched++;
      // 不覆盖显式答案标记已设置的值
      if (!map[qNum]) {
        map[qNum] = { answer: normalizeAnswerValue(rawAnswer, type), type };
      }
    }

    if (perLineMatched >= 2) {
      const stats = computeAnswerStats(map);
      console.log(`答案文件解析(显式+逐行): ${stats.total} 题 (选择${stats.choice} 判断${stats.tf} 填空${stats.fill})`);
      if (stats.total >= 2) return { map, stats };
    }

    // ════════════════════════════════════════════════════
    // 第三步：紧凑范围格式 "1-5: BCDAB"
    // ════════════════════════════════════════════════════
    const rangeRegex = /(\d+)\s*[-~—]\s*(\d+)\s*[：:]*\s*(.+)/g;
    let rangeMatch;
    while ((rangeMatch = rangeRegex.exec(text)) !== null) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      const answersStr = rangeMatch[3].trim();
      const singleLetters = answersStr.match(/[A-Da-d]/g);
      if (singleLetters && singleLetters.length >= end - start + 1) {
        for (let i = 0; i < singleLetters.length && start + i <= end; i++) {
          if (!map[start + i]) map[start + i] = { answer: singleLetters[i].toUpperCase(), type: '选择题' };
        }
      } else {
        const boolParts = answersStr.match(/(正确|错误|对|错)/g);
        if (boolParts && boolParts.length >= end - start + 1) {
          for (let i = 0; i < boolParts.length && start + i <= end; i++) {
            if (!map[start + i]) map[start + i] = { answer: normalizeAnswerValue(boolParts[i], '判断题'), type: '判断题' };
          }
        }
      }
    }
    if (Object.keys(map).length >= 2) {
      const stats = computeAnswerStats(map);
      console.log(`答案文件解析(范围): ${stats.total} 题`);
      return { map, stats };
    }

    // ════════════════════════════════════════════════════
    // 第四步：空格分隔 "1B 2C 3D" / "1 B 2 C 3 D"
    // ════════════════════════════════════════════════════
    const spacedPairs = text.match(/(\d+)\s*([A-Da-d])\b/g);
    if (spacedPairs && spacedPairs.length >= 2) {
      for (const pair of spacedPairs) {
        const pm = pair.match(/(\d+)\s*([A-Da-d])/i);
        if (pm) {
          const qNum = parseInt(pm[1]);
          if (!map[qNum]) map[qNum] = { answer: pm[2].toUpperCase(), type: '选择题' };
        }
      }
      const stats = computeAnswerStats(map);
      if (stats.total >= 2) {
        console.log(`答案文件解析(空格分隔): ${stats.total} 题`);
        return { map, stats };
      }
    }

    // ════════════════════════════════════════════════════
    // 第五步：纯字母序列（无题号）— 最后手段，需过滤选项行
    // ════════════════════════════════════════════════════
    const bareLetters: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (optionListLines.has(i)) continue; // ⚠️ 跳过选项列表行，防止误解析
      const lt = lines[i].trim();
      if (looksLikeQuestionOrHeader(lt)) continue;
      // 单字母行（A-D），且不是选项标签格式
      if (/^[A-Da-d]$/.test(lt) && !looksLikeOptionLabel(lt)) {
        bareLetters.push(lt.toUpperCase());
      }
    }
    if (bareLetters.length >= 2) {
      for (let i = 0; i < bareLetters.length; i++) {
        if (!map[i + 1]) map[i + 1] = { answer: bareLetters[i], type: '选择题' };
      }
    }

    const stats = computeAnswerStats(map);
    if (stats.total > 0) {
      console.log(`答案文件解析(字母序列): ${stats.total} 题`);
    }
    return { map, stats };
  };

  /** 统计答案映射中的选择题/判断题/填空题数量 */
  const computeAnswerStats = (map: Record<number, ParsedAnswerEntry>) => {
    let choice = 0, tf = 0, fill = 0;
    Object.values(map).forEach(v => {
      if (v.type === '选择题') choice++;
      else if (v.type === '判断题') tf++;
      else if (v.type === '填空题') fill++;
    });
    return { choice, tf, fill, total: choice + tf + fill };
  };

  /** 从 answerMap 中查找指定题号的答案 */
  const getAnswerFromMap = (qNum: number): ParsedAnswerEntry | null => {
    return answerMap[qNum] || null;
  };

  // 解析简单文本格式的学生答案文件（如 "1. B\n2. C\n3. D"）
  const parseSimpleAnswerText = (text: string, sourceFile: string): any[] => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 1) return [];

    // 检测逐行格式: "1. B" / "1) C" / "1、D" / "1. 答案内容"
    const perLineRegex = /^\s*[\(（\[]?\s*(\d+)\s*[\)）\]]?\s*[.、．)）]?\s*(.+)/;
    let matchedCount = 0;
    const submissions: any[] = [];

    for (const line of lines) {
      const m = line.match(perLineRegex);
      if (m) {
        matchedCount++;
        const qNum = m[1];
        const rawAnswer = m[2].trim();
        const qType = /^(正确|错误|对|错|√|×|TRUE|FALSE)$/i.test(rawAnswer) ? '判断题'
          : /^[A-Da-d]$/.test(rawAnswer) ? '选择题'
          : /^[A-Da-d,\s、]+$/.test(rawAnswer) && (rawAnswer.match(/[A-Da-d]/g) || []).length >= 2 ? '多选题'
          : '主观题';
        const cleanAnswer = qType === '选择题' || qType === '多选题'
          ? rawAnswer.toUpperCase().replace(/[,，、\s]+/g, '')
          : rawAnswer;
        submissions.push({
          student_name: '未知学生', course_name: '', question_text: `第${qNum}题`,
          student_answer: cleanAnswer, reference_answer: '', question_type: qType,
          max_score: 100, _sourceFile: sourceFile,
        });
      }
    }

    // 超过一半的行匹配 → 确认为简单答案列表格式
    if (matchedCount >= lines.length * 0.5 && matchedCount >= 2) {
      console.log(`简单格式解析: ${matchedCount}/${lines.length} 行匹配 → ${submissions.length} 条记录`);
      return submissions;
    }

    // 紧凑格式检测: "1-5: BCDAB" 或 "1~5 BCDAB"
    const rangeMatch = text.trim().match(/(\d+)\s*[-~—]\s*(\d+)\s*[：:]*\s*([A-Da-d]+)/i);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      const answers = rangeMatch[3].toUpperCase();
      for (let i = 0; i < answers.length && start + i <= end; i++) {
        submissions.push({
          student_name: '未知学生', course_name: '', question_text: `${start + i}题`,
          student_answer: answers[i], reference_answer: '', question_type: '选择题',
          max_score: 100, _sourceFile: sourceFile,
        });
      }
      if (submissions.length > 0) return submissions;
    }

    // 空格分隔格式检测: "1A 2B 3C 4D"
    const spacedPairs = text.match(/(\d+)\s*([A-Da-d])\b/g);
    if (spacedPairs && spacedPairs.length >= 2) {
      for (const pair of spacedPairs) {
        const m = pair.match(/(\d+)\s*([A-Da-d])/i);
        if (m) {
          submissions.push({
            student_name: '未知学生', course_name: '', question_text: `第${m[1]}题`,
            student_answer: m[2].toUpperCase(), reference_answer: '', question_type: '选择题',
            max_score: 100, _sourceFile: sourceFile,
          });
        }
      }
      if (submissions.length > 0) return submissions;
    }

    return [];
  };

  const parseTextFile = (file: File, uid: string) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = (e.target?.result as string) || '';
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
          setUploadedFiles(prev => prev.map(f => f.uid === uid ? { ...f, status: 'error', errorMessage: '内容为空' } : f));
          message.warning(`"${file.name}" 内容为空`); return;
        }

        // ── 第1步：尝试简单答案列表格式 ──
        const simpleSubs = parseSimpleAnswerText(text, file.name);
        if (simpleSubs.length > 0) {
          setFileSubmissions(prev => [...prev, ...simpleSubs]);
          setUploadedFiles(prev => prev.map(f => f.uid === uid ? { ...f, status: 'parsed', recordCount: simpleSubs.length } : f));
          message.success(`已解析 "${file.name}"（${simpleSubs.length} 条记录 · 简单格式）`);
          return;
        }

        // ── 第2步：尝试 CSV 格式 ──
        const submissions: any[] = [];

        // 检测是否有表头
        const firstLine = lines[0].toLowerCase();
        const hasHeader = /学生姓名|姓名|题号|题目|答案|student|question|answer|name/.test(firstLine);
        const startRow = hasHeader ? 1 : 0;

        for (let i = startRow; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          const colCount = cols.filter(c => c !== '').length;

          // ── 4列以上：标准CSV格式 ──
          if (cols.length >= 4 && cols[0] && cols[2] && cols[3]) {
            const qType = cols[5] || '主观题';
            const rawAnswer = cols[3];
            const cleanAnswer = cleanStudentAnswer(rawAnswer, qType);
            if (cleanAnswer !== rawAnswer) {
              console.log(`答案清理: "${rawAnswer}" → "${cleanAnswer}" (${qType})`);
            }
            submissions.push({
              student_name: cols[0], course_name: cols[1], question_text: cols[2],
              student_answer: cleanAnswer, reference_answer: cols[4] || '', question_type: qType,
              max_score: parseFloat(cols[6]) || 100, _sourceFile: file.name,
            });
            continue;
          }

          // ── 3列格式：学生姓名, 题目, 答案 或 题号, 学生姓名, 答案 ──
          if (cols.length >= 3 && cols[2]) {
            let studentName, questionText, answer;
            if (/^\d+$/.test(cols[0].trim())) {
              // 格式: 题号, 学生姓名, 答案 或 题号, 题目, 答案
              questionText = cols[0].trim();
              studentName = cols[1].trim();
              answer = cols[2].trim();
            } else {
              // 格式: 学生姓名, 题目, 答案
              studentName = cols[0].trim();
              questionText = cols[1].trim();
              answer = cols[2].trim();
            }
            // 如果第二列看起来也像学生名 → 题号, 学生姓名, 答案
            if (/^\d+$/.test(cols[0].trim()) && !/^\d+$/.test(cols[1].trim())) {
              questionText = `第${cols[0].trim()}题`;
            }
            const qType = '主观题';
            const cleanAnswer = cleanStudentAnswer(answer, qType);
            submissions.push({
              student_name: studentName || '未知学生', course_name: '',
              question_text: questionText, student_answer: cleanAnswer, reference_answer: '',
              question_type: qType, max_score: 100, _sourceFile: file.name,
            });
            continue;
          }

          // ── 2列格式：题号, 答案 ──
          if (cols.length >= 2 && cols[0] && cols[1]) {
            if (/^\d+$/.test(cols[0].trim())) {
              // 题号, 答案
              const qType = '主观题';
              const cleanAnswer = cleanStudentAnswer(cols[1].trim(), qType);
              submissions.push({
                student_name: '未知学生', course_name: '',
                question_text: `第${cols[0].trim()}题`,
                student_answer: cleanAnswer, reference_answer: '',
                question_type: qType, max_score: 100, _sourceFile: file.name,
              });
            } else {
              // 学生姓名, 答案
              const cleanAnswer = cleanStudentAnswer(cols[1].trim(), '主观题');
              submissions.push({
                student_name: cols[0].trim(), course_name: '',
                question_text: `${i - startRow + 1}`,
                student_answer: cleanAnswer, reference_answer: '',
                question_type: '主观题', max_score: 100, _sourceFile: file.name,
              });
            }
            continue;
          }
        }

        if (submissions.length === 0) {
          setUploadedFiles(prev => prev.map(f => f.uid === uid ? { ...f, status: 'error', errorMessage: '未解析到有效记录' } : f));
          message.warning(`"${file.name}" 未能解析到有效记录，将交由后端处理`);
        } else {
          setFileSubmissions(prev => [...prev, ...submissions]);
          setUploadedFiles(prev => prev.map(f => f.uid === uid ? { ...f, status: 'parsed', recordCount: submissions.length } : f));
          message.success(`已解析 "${file.name}"（${submissions.length} 条记录）`);
        }
      } catch {
        setUploadedFiles(prev => prev.map(f => f.uid === uid ? { ...f, status: 'error', errorMessage: '编码错误' } : f));
        message.error(`"${file.name}" 读取失败`);
      }
    };
    reader.onerror = () => setUploadedFiles(prev => prev.map(f => f.uid === uid ? { ...f, status: 'error', errorMessage: '读取失败' } : f));
    reader.readAsText(file, 'UTF-8');
  };

  // 使用 customRequest 替代 beforeUpload，正确处理多文件添加
  // （已被 processBatchFiles 替代，保留以兼容旧引用）
  const handleFileAdd = (options: any): void => {
    const { file, onSuccess, onError } = options;
    processBatchFiles([file]);
    if (onSuccess) onSuccess({ uid: file.uid }, file);
  };

  const handleRemoveFile = (uid: string) => {
    const removed = uploadedFiles.find(f => f.uid === uid);
    setUploadedFiles(prev => prev.filter(f => f.uid !== uid));
    if (removed) {
      setFileSubmissions(prev => prev.filter(s => s._sourceFile !== removed.name));
      // 同步清理该文件的批改结果
      setBatchResults(prev => prev.filter(r => (r._sourceFile || r.source_file) !== removed.name));
    }
  };

  const handleClearFiles = () => { setUploadedFiles([]); setFileSubmissions([]); setBatchResults([]); setBatchError(''); setAnswerFile(null); setAnswerMap({}); setAnswerStats({ choice: 0, tf: 0, fill: 0, total: 0 }); setResultFileFilter(null); setArchived(false); };

  // ── 归档批改结果至教学台账 ──
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  const handleArchiveResults = async () => {
    if (batchResults.length === 0) { message.warning('没有可归档的批改结果'); return; }
    setArchiving(true);
    try {
      // 确保每条结果都携带来源文件信息
      const enriched = batchResults.map((r: any) => ({
        ...r,
        source_file: r._sourceFile || r.source_file || '',
        batch_id: r.batch_id || '',
      }));
      const res = await homeworkApi.archiveResults(enriched);
      if (res.data.success) {
        message.success(res.data.message || '归档成功');
        setArchived(true);
      } else {
        message.error(res.data.message || '归档失败');
      }
    } catch (e: any) {
      message.error('归档失败: ' + (e.response?.data?.detail || e.message || '未知错误'));
    }
    setArchiving(false);
  };
  const goToLedger = () => {
    window.location.href = '/lesson';
  };

  const handleBatchGrade = async () => {
    if (!canGenerate) { guard.showGuard(); return; }
    setBatchGrading(true); setBatchError(''); setResultFileFilter(null);
    // ⚠️ 不清空已有批改结果 — 仅对新文件追加批改
    const alreadyGradedFiles = new Set(batchResults.map((r: any) => r._sourceFile || r.source_file).filter(Boolean));
    const csvSubmissions = fileSubmissions.filter(
      (s: any) => !alreadyGradedFiles.has(s._sourceFile)
    );
    // 需要后端处理的文件: PDF/Word/图片 + CSV/TXT 解析失败的（跳过已批改的）
    const pendingDocFiles = uploadedFiles.filter(f =>
      ((f.type === 'pdf' || f.type === 'word' || f.type === 'image') && (f.status === 'pending' || f.status === 'error')) ||
      ((f.type === 'csv' || f.type === 'txt') && f.status === 'error')
    ).filter(f => !alreadyGradedFiles.has(f.name));
    if (csvSubmissions.length === 0 && pendingDocFiles.length === 0) {
      if (alreadyGradedFiles.size > 0) {
        message.info('所有已添加文件均已批改，无需重复批改', 3);
      } else {
        message.warning('没有可批改的作业');
      }
      setBatchGrading(false);
      return;
    }
    setBatchGrading(true); setBatchError(''); setResultFileFilter(null);
    // ⚠️ 不清空已有批改结果 — 仅对新文件追加批改
    let docResults: any[] = []; let producedResults = false;
    const docErrors: string[] = [];
    let batchErrorSet = false;  // 标记是否已设置过具体错误，防止被通用消息覆盖
    for (const item of pendingDocFiles) {
      setUploadedFiles(prev => prev.map(f => f.uid === item.uid ? { ...f, status: 'parsing' } : f));
      try {
        // 有答案文件时只用后端解析文本，不自动批改（之后统一注入答案再批改）
        const needsParseOnly = !!answerFile?.content;
        const res = await homeworkApi.uploadFile(item.file, '', needsParseOnly);
        if (res.data.success) {
          const results = res.data.data?.results || res.data.data?.submissions || [];
          const items = Array.isArray(results) ? results : [results];
          docResults = [...docResults, ...items.map((r: any) => ({ ...r, _sourceFile: item.name }))];
          setUploadedFiles(prev => prev.map(f => f.uid === item.uid ? { ...f, status: 'parsed', recordCount: items.length } : f));
          if (items.length === 0) {
            docErrors.push(`「${item.name}」未提取到作业记录`);
          }
        } else {
          const errMsg = res.data.message || '处理失败';
          setUploadedFiles(prev => prev.map(f => f.uid === item.uid ? { ...f, status: 'error', errorMessage: errMsg } : f));
          docErrors.push(`「${item.name}」${errMsg}`);
        }
      } catch (e: any) {
        const errMsg = e.response?.data?.detail || e.message || '上传失败';
        setUploadedFiles(prev => prev.map(f => f.uid === item.uid ? { ...f, status: 'error', errorMessage: errMsg } : f));
        docErrors.push(`「${item.name}」${errMsg}`);
      }
    }
    const allToGrade = [...csvSubmissions];
    const hasAnswerMap = answerMap && Object.keys(answerMap).length > 0;
    if (docResults.length > 0) {
      // 区分：有分数的直接作为批改结果展示；无分数且需要人工审核的跳过批改；无分数且无需审核的送去统一批改
      const scored = docResults.filter((r: any) => r.score !== undefined || r.percentage !== undefined);
      const needsReview = docResults.filter((r: any) => r._needs_review && r.score === undefined && r.percentage === undefined);
      const unscored = docResults.filter((r: any) => !r._needs_review && r.score === undefined && r.percentage === undefined);
      if (scored.length > 0) {
        setBatchResults(scored);
        producedResults = true;
      }
      if (unscored.length > 0) {
        allToGrade.push(...unscored.map((s: any) => ({ ...s })));
      }
      if (needsReview.length > 0) {
        // 有答案文件时，尝试将需审核项也纳入匹配批改；否则直接展示
        if (hasAnswerMap) {
          allToGrade.push(...needsReview.map((s: any) => ({ ...s })));
        } else {
          setBatchResults(prev => [...prev, ...needsReview]);
          producedResults = true;
        }
      }
    }
    if (allToGrade.length > 0) {
      // ── 参考答案注入：优先使用解析后的 answerMap，回退到全文注入 ──
      if (hasAnswerMap) {
        // ✅ 有解析好的答案映射 → 仅批改客观题，注入精确答案
        // 两轮匹配：第一轮按题号精确匹配，第二轮将未匹配的题目与未使用的答案按顺序配对

        // ── 调试：打印答案映射预览（前 10 条）──
        const sortedEntries = Object.entries(answerMap)
          .sort(([a], [b]) => parseInt(a) - parseInt(b));
        console.group('答案文件解析预览');
        console.log(`共 ${sortedEntries.length} 道题答案`);
        sortedEntries.slice(0, 10).forEach(([q, v]) => {
          console.log(`  Q${q}: ${v.answer} [${v.type}]`);
        });
        if (sortedEntries.length > 10) console.log(`  ... 还有 ${sortedEntries.length - 10} 条`);
        console.groupEnd();

        // ── 第一轮：题号匹配 ──
        const matchedSubmissions: typeof allToGrade = [];
        const unmatchedSubmissions: typeof allToGrade = [];
        let skippedNonObjective = 0;

        for (const s of allToGrade) {
          let qType = s.question_type || '主观题';
          if (qType === '主观题' || !qType) {
            const inferred = detectAnswerType(s.student_answer);
            if (inferred) qType = inferred;
          }
          s.question_type = qType;

          if (qType !== '选择题' && qType !== '判断题' && qType !== '填空题') {
            skippedNonObjective++;
            continue;
          }

          const qNum = extractQuestionNumber(s.question_text);
          const entry = qNum ? answerMap[qNum] : null;

          if (entry) {
            s.reference_answer = entry.answer;
            s._matchedQNum = qNum; // 标记已使用的答案题号
            matchedSubmissions.push(s);
          } else {
            unmatchedSubmissions.push(s);
          }
        }

        // ── 第二轮：未匹配的题目与未使用的答案按同类型顺序配对 ──
        // 收集已被第一轮用掉的答案题号
        const usedAnswerKeys = new Set(matchedSubmissions.map(s => s._matchedQNum).filter(Boolean));

        // 按类型分组未使用的答案
        const unusedByType: Record<string, [number, ParsedAnswerEntry][]> = {};
        Object.entries(answerMap).forEach(([keyStr, val]) => {
          const key = parseInt(keyStr);
          if (!usedAnswerKeys.has(key)) {
            if (!unusedByType[val.type]) unusedByType[val.type] = [];
            unusedByType[val.type].push([key, val]);
          }
        });
        // 每种类型内按题号排序
        Object.values(unusedByType).forEach(arr => arr.sort(([a], [b]) => a - b));

        // 对未匹配的题目按类型分组后顺序配对
        const stillUnmatched: typeof allToGrade = [];
        for (const s of unmatchedSubmissions) {
          const unused = unusedByType[s.question_type];
          if (unused && unused.length > 0) {
            const [matchedQNum, matchedEntry] = unused.shift()!;
            s.reference_answer = matchedEntry.answer;
            matchedSubmissions.push(s);
            console.log(`题号匹配回退(顺序): "${s.question_text}" → 答案#${matchedQNum} = ${matchedEntry.answer}`);
          } else {
            stillUnmatched.push(s);
          }
        }

        const skippedNoAnswer = stillUnmatched.length;

        // ── 填空题特殊处理：仅批改纯数字答案，文字答案跳过 ──
        const isNumeric = (val: string): boolean => {
          const t = val.trim();
          return t.length > 0 && /^-?\d+\.?\d*$/.test(t);
        };
        let skippedNonNumericFill = 0;
        const numericMatched: typeof matchedSubmissions = [];
        for (const s of matchedSubmissions) {
          if (s.question_type === '填空题') {
            if (!isNumeric(s.reference_answer || '')) {
              skippedNonNumericFill++;
              continue; // 跳过非数字的填空题，不批改
            }
          }
          numericMatched.push(s);
        }

        const totalGraded = numericMatched.length;

        // 报告过滤/跳过情况
        if (skippedNonObjective > 0) {
          message.info(`已跳过 ${skippedNonObjective} 道主观题（文件批改仅批改选择题、判断题和填空题）`, 4);
        }
        if (skippedNoAnswer > 0) {
          const msgFn = skippedNoAnswer > totalGraded * 0.3 ? message.warning : message.info;
          msgFn(`${skippedNoAnswer} 道客观题在答案文件中未找到对应答案，已跳过`, 4);
        }
        if (skippedNonNumericFill > 0) {
          message.info(`已跳过 ${skippedNonNumericFill} 道文字型填空题（仅批改纯数字答案的填空题）`, 4);
        }

        allToGrade.length = 0;
        allToGrade.push(...numericMatched);
        // ── 调试：打印匹配结果 ──
        console.group('答案匹配结果');
        console.log(`匹配成功: ${totalGraded} 题, 跳过主观题: ${skippedNonObjective}, 无答案: ${skippedNoAnswer}`);
        numericMatched.slice(0, 8).forEach((s, i) => {
          const qNum = extractQuestionNumber(s.question_text);
          console.log(`  #${i + 1} Q${qNum ?? '?'}: 学生「${s.student_answer}」 → 答案「${s.reference_answer}」[${s.question_type}]`);
        });
        if (numericMatched.length > 8) console.log(`  ... 还有 ${numericMatched.length - 8} 条`);
        if (stillUnmatched && stillUnmatched.length > 0) {
          console.warn(`未匹配的题目 (${stillUnmatched.length}):`, stillUnmatched.map((s: any) => `"${s.question_text}"`));
        }
        console.groupEnd();
      } else if (answerFile?.content) {
        // ⚠️ 有答案文件但解析失败 → 回退到全文注入（仅客观题）
        const filtered: typeof allToGrade = [];
        for (const s of allToGrade) {
          let qType = s.question_type || '主观题';
          if (qType === '主观题' || !qType) {
            const inferred = detectAnswerType(s.student_answer);
            if (inferred) qType = inferred;
            s.question_type = qType;
          }
          if (qType === '选择题' || qType === '判断题' || qType === '填空题') {
            if (!s.reference_answer) s.reference_answer = answerFile.content;
            filtered.push(s);
          }
        }
        if (filtered.length < allToGrade.length) {
          message.info(`已跳过 ${allToGrade.length - filtered.length} 道主观题（文件批改仅批改选择题、判断题和填空题）`, 4);
        }
        allToGrade.length = 0;
        allToGrade.push(...filtered);
      } else {
        // ── 无答案文件：仍仅批改客观题，不调 LLM 批改主观题 ──
        const filtered: typeof allToGrade = [];
        for (const s of allToGrade) {
          let qType = s.question_type || '主观题';
          if (qType === '主观题' || !qType) {
            const inferred = detectAnswerType(s.student_answer);
            if (inferred) qType = inferred;
            s.question_type = qType;
          }
          // 仅保留选择题、判断题、填空题
          if (qType === '选择题' || qType === '判断题' || qType === '填空题') {
            filtered.push(s);
          }
        }
        if (filtered.length < allToGrade.length) {
          message.info(`已跳过 ${allToGrade.length - filtered.length} 道主观题（文件批改仅批改选择题、判断题和填空题）`, 4);
        }
        allToGrade.length = 0;
        allToGrade.push(...filtered);
      }
      try {
        const res = await homeworkApi.batchGrade(allToGrade);
        if (res.data.success) {
          // 将批改结果与原始提交记录合并，保留学生姓名、课程等元数据用于归档
          const gradingResults = res.data.data?.results || [];
          const mergedResults = gradingResults.map((r: any, i: number) => ({
            ...r,
            student_name: allToGrade[i]?.student_name || r.student_name || '',
            course_name: allToGrade[i]?.course_name || r.course_name || '',
            chapter: allToGrade[i]?.chapter || '',
            question_text: allToGrade[i]?.question_text || r.question_text || '',
            student_answer: allToGrade[i]?.student_answer || r.student_answer || '',
            question_type: allToGrade[i]?.question_type || r.question_type || '主观题',
            reference_answer: allToGrade[i]?.reference_answer || '',
            _sourceFile: allToGrade[i]?._sourceFile || r._sourceFile || r.source_file || '',
            source_file: allToGrade[i]?._sourceFile || r._sourceFile || r.source_file || '',
          }));
          setBatchResults(prev => [...prev, ...mergedResults]);
          producedResults = true;
          message.success(`批改完成！共 ${allToGrade.length} 份`);
        } else {
          setBatchError(res.data.message || '批量批改失败');
          batchErrorSet = true;
        }
      } catch (e: any) {
        setBatchError(e.response?.data?.detail || '请求失败');
        batchErrorSet = true;
      }
    }
    // 汇总错误信息：仅在尚未设置具体错误时才显示通用消息
    if (!producedResults && !batchErrorSet) {
      if (docErrors.length > 0) {
        setBatchError(docErrors.join('；'));
      } else if (pendingDocFiles.length > 0) {
        setBatchError('文档解析失败，请确认文件包含可识别的作业内容（题目+答案），或配置 LLM API Key 后重试');
      } else {
        setBatchError('未能提取有效作业记录，请检查文件格式和内容');
      }
    } else if (docErrors.length > 0) {
      // 有部分成功也有部分失败时，给出警告提示
      message.warning(docErrors.join('；'));
    }
    setBatchGrading(false);
  };

  // Tab3：批量文件变化处理
  const handleBatchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processBatchFiles(files);
    e.target.value = '';
  };

  const processBatchFiles = (files: File[]) => {
    const ALLOWED_EXTS = ['csv', 'txt', 'pdf', 'docx', 'doc', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_EXTS.includes(ext)) { message.error(`不支持: .${ext}`); continue; }
      if (uploadedFiles.some(f => f.name === file.name && f.size === file.size)) { message.warning(`"${file.name}" 已添加`); continue; }
      const fileType = getFileType(file.name);
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setUploadedFiles(prev => [...prev, { uid, file, name: file.name, size: file.size, type: fileType, status: fileType === 'csv' || fileType === 'txt' ? 'parsing' : 'pending' }]);
      if (fileType === 'csv' || fileType === 'txt') parseTextFile(file, uid);
    }
  };

  // ── 导出报告 ──

  const exportBatchReport = (results: any[]) => {
    if (!results || results.length === 0) return;
    // 按题号排序，保证导出顺序与原始文件一致
    const sorted = [...results].sort((a: any, b: any) => {
      const na = extractQuestionNumber(a.question_text || '') ?? 9999;
      const nb = extractQuestionNumber(b.question_text || '') ?? 9999;
      return na - nb;
    });
    const rows = sorted.map((r, i) => `<tr>
<td>${extractQuestionNumber(r.question_text || "") ?? (i + 1)}</td><td>${r.student_name || '-'}</td><td>${r.score || 0}/${r.max_score || 100}</td>
<td>${r.percentage || 0}%</td><td>${(r.knowledge_points || []).join(', ') || '-'}</td>
<td style="font-size:12px">${(r.feedback || '').substring(0, 80)}</td></tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>批量批改报告</title>
<style>body{font-family:'Microsoft YaHei',sans-serif;max-width:900px;margin:30px auto;padding:20px}
h1{color:#0F52BA;border-bottom:2px solid #0F52BA;padding-bottom:8px}
.summary{display:flex;gap:20px;margin:16px 0}
.summary>div{flex:1;text-align:center;padding:12px;background:#f0f5ff;border-radius:8px}
.summary b{font-size:24px;color:#0F52BA}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #e8e8e8;padding:8px 10px;text-align:left}
th{background:#f0f5ff}
.footer{text-align:center;color:#999;margin-top:20px;font-size:11px}
</style></head><body>
<h1>📋 批量批改报告</h1>
<div class="summary">
<div>总人数<b>${results.length}</b></div>
<div>平均分<b>${(results.reduce((s, r) => s + (r.percentage || 0), 0) / results.length).toFixed(1)}%</b></div>
<div>最高<b>${Math.max(...results.map(r => r.percentage || 0)).toFixed(1)}%</b></div>
<div>通过率<b>${(results.filter(r => (r.percentage || 0) >= 60).length / results.length * 100).toFixed(1)}%</b></div>
</div>
<table><thead><tr><th>#</th><th>学生</th><th>得分</th><th>百分比</th><th>知识点</th><th>评语</th></tr></thead><tbody>${rows}</tbody></table>
<p class="footer">智教星 · 人工智能生成</p></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `批量批改报告_${new Date().toLocaleDateString()}.html`;
    a.click(); URL.revokeObjectURL(url);
    message.success('汇总报告已下载');
  };


  // ── 导出练习题 Word ──
  const handleExportExercisesWord = async () => {
    if (exercises.length === 0) {
      message.warning('没有可导出的题目，请先生成练习题');
      return;
    }
    try {
      const courseName = exerciseForm.getFieldValue('course_name') || '练习题';
      const chapter = exerciseForm.getFieldValue('chapter') || '';
      const res = await homeworkApi.exportExercisesWord({
        exercises,
        course_name: courseName,
        chapter,
      });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = `练习题_${courseName}${chapter ? '_' + chapter : ''}.docx`;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      message.success(`Word 文档「${filename}」已导出`);
    } catch (e: any) {
      const detail = e.response?.data?.detail || e.message || '未知错误';
      message.error(`导出失败: ${detail}`);
    }
  };

  const handleGenerateExercises = async (values: any) => {
    if (!canGenerate) { guard.showGuard(); return; }
    setGenerating(true); setExError(''); setExercises([]);
    try {
      const res = await homeworkApi.generateExercises({
        course_name: values.course_name, chapter: values.chapter || '',
        knowledge_points: Array.isArray(values.knowledge_points)
          ? values.knowledge_points
          : values.knowledge_points.split(/[,，、]/).filter((s: string) => s.trim()),
        difficulty: values.difficulty || '中等', count: values.count || 5,
        types: values.types || ['选择题', '填空题', '简答题'],
      });
      if (res.data.success) { setExercises(res.data.data.exercises || []); message.success(`已生成 ${res.data.data.total} 道练习题！`); }
      else setExError(res.data.message || '生成失败');
    } catch (e: any) { setExError(e.response?.data?.detail || '请求失败'); }
    finally { setGenerating(false); }
  };

  // ── 出题助手：保存到题库、发布、撤销 ──
  const loadPublishedExercises = async () => {
    setPubExLoading(true);
    try {
      const res = await materialApi.listPublished();
      if (res.data.success) {
        // 只显示出题助手关联的发布（通过 course 匹配）
        const course = exerciseForm.getFieldValue('course_name');
        const items = (res.data.data.items || []).filter((item: any) =>
          !course || item.course === course
        );
        setPublishedExList(items);
      }
    } catch { /* ignore */ }
    finally { setPubExLoading(false); }
  };

  const handleSaveToBank = async () => {
    if (exercises.length === 0) { message.warning('没有可保存的题目'); return; }
    setSavingToBank(true);
    try {
      const course = exerciseForm.getFieldValue('course_name') || '未分类';
      const chapter = exerciseForm.getFieldValue('chapter') || '';
      const res = await materialApi.saveExercises(course, chapter, exercises);
      if (res.data.success) {
        const questions = res.data.data.questions || [];
        setSavedQuestions(questions);
        setExercises([]);  // 清空临时列表
        message.success(res.data.message || `已保存 ${questions.length} 道题目到题库`);
        loadPublishedExercises();
      } else message.error(res.data.message || '保存失败');
    } catch (e: any) { message.error(e.response?.data?.detail || '保存失败'); }
    finally { setSavingToBank(false); }
  };

  // ── 出题助手：保存并直接发布（像资料题库AI出题一样出完即可发布） ──
  const handleSaveAndPublish = async () => {
    if (exercises.length === 0) { message.warning('没有可发布的题目'); return; }
    setSavingToBank(true);
    try {
      const course = exerciseForm.getFieldValue('course_name') || '未分类';
      const chapter = exerciseForm.getFieldValue('chapter') || '';
      const res = await materialApi.saveExercises(course, chapter, exercises);
      if (res.data.success) {
        const questions = res.data.data.questions || [];
        setSavedQuestions(questions);
        setExercises([]);
        setPublishExTitle(`${course} · ${chapter || '练习题'}`);
        setPublishExDeadline('');
        setPublishExModalOpen(true);
        message.success(res.data.message || `已保存 ${questions.length} 道题目，请确认发布`);
        loadPublishedExercises();
      } else message.error(res.data.message || '保存失败');
    } catch (e: any) { message.error(e.response?.data?.detail || '保存失败'); }
    finally { setSavingToBank(false); }
  };

  const handlePublishExercises = async () => {
    const ids = selectedExIds.length > 0 ? selectedExIds : savedQuestions.map(q => q.id);
    if (ids.length === 0) { message.warning('请先保存题目到题库'); return; }
    const course = exerciseForm.getFieldValue('course_name') || '';
    const title = publishExTitle || `${course} · 练习题`;
    setPublishingEx(true);
    try {
      const res = await materialApi.publish(ids, course, title, publishExDeadline);
      if (res.data.success) {
        message.success(`已发布 ${res.data.data.question_count} 道题`);
        setPublishExModalOpen(false);
        setSelectedExIds([]);
        setPublishExTitle('');
        setPublishExDeadline('');
        // 从本地已保存列表中移除已发布的题目
        setSavedQuestions(prev => prev.filter(q => !ids.includes(q.id)));
        loadPublishedExercises();
      } else message.error(res.data.message || '发布失败');
    } catch (e: any) { message.error(e.response?.data?.detail || '发布失败'); }
    finally { setPublishingEx(false); }
  };

  const handleUnpublishExercise = async (publishId: string) => {
    Modal.confirm({
      title: '撤销发布', content: '确认撤销此发布？所有题目将恢复为草稿状态。',
      onOk: async () => {
        try {
          const res = await materialApi.unpublish(publishId);
          if (res.data.success) { message.success(res.data.message); loadPublishedExercises(); }
          else message.error(res.data.message || '撤销失败');
        } catch (e: any) { message.error(e.response?.data?.detail || '撤销失败'); }
      },
    });
  };

  const handleViewPublishedQuestions = async (publishId: string) => {
    try {
      const res = await materialApi.getPublishedQuestions(publishId);
      if (res.data.success) {
        const questions = res.data.data.questions || [];
        Modal.info({
          title: res.data.data.title || '已发布题目',
          width: 700,
          content: (
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {questions.map((q: any, idx: number) => (
                <Card key={idx} size="small" style={{ marginBottom: 8, borderRadius: 6 }}>
                  <Space><Tag color="blue">{idx + 1}</Tag><Text strong>[{q.type}]</Text><Tag>{q.difficulty}</Tag></Space>
                  <Paragraph style={{ marginTop: 4, fontSize: 12 }}>{q.question}</Paragraph>
                  {q.options?.length > 0 && <Paragraph style={{ fontSize: 11, color: '#666' }}>{q.options.join('  ')}</Paragraph>}
                  <Text type="secondary" style={{ fontSize: 11 }}>答案：{q.answer}</Text>
                </Card>
              ))}
            </div>
          ),
        });
      }
    } catch { message.error('加载失败'); }
  };

  // ── 知识库文档管理 ──
  const loadKbStatus = () => {
    setKbStatusLoading(true); setKbStatusError('');
    if (kbStatusTimerRef.current) clearTimeout(kbStatusTimerRef.current);
    kbStatusTimerRef.current = setTimeout(() => { setKbStatusLoading(false); setKbStatusError('后端服务响应超时'); setKbStatus(null); }, 35000);
    knowledgeApi.status().then(res => {
      clearTimeout(kbStatusTimerRef.current);
      if (res.data?.success) { setKbStatus(res.data.data); setKbStatusError(''); }
      else { setKbStatusError(res.data?.message || '获取状态失败'); setKbStatus(null); }
    }).catch((e) => {
      clearTimeout(kbStatusTimerRef.current);
      setKbStatusError(e.response?.data?.detail || e.message || '无法连接后端服务');
      setKbStatus(null);
    }).finally(() => setKbStatusLoading(false));
  };

  const loadKbDocuments = () => {
    setKbDocsLoading(true);
    Promise.all([
      knowledgeApi.collections().catch(() => ({ data: { data: [] } })),
      knowledgeApi.status().catch(() => ({ data: { data: { total_chunks: 0, total_documents: 0, courses: [] } } })),
    ]).then(([colRes, statusRes]) => {
      const collections = colRes.data?.data || [];
      const docs: any[] = [];
      if (Array.isArray(collections)) {
        collections.forEach((c: any, idx: number) => {
          const meta = c.metadata || {};
          const sizeBytes = meta.total_size || 0;
          const sizeStr = sizeBytes > 0
            ? sizeBytes < 1024 ? `${sizeBytes} B`
            : sizeBytes < 1048576 ? `${(sizeBytes / 1024).toFixed(1)} KB`
            : `${(sizeBytes / 1048576).toFixed(1)} MB`
            : '-';
          docs.push({
            id: `col_${idx}`,
            name: c.name || c,
            course: c.collection_name || c.name || c,
            chapter: '-', chunks: c.count || 0,
            size: sizeStr,
            created_at: meta.uploaded_at || meta.created_at || '',
            _source: c._source || 'knowledge_base',
          });
        });
      }
      setKbDocuments(docs);
    }).catch(() => {}).finally(() => setKbDocsLoading(false));
  };

  useEffect(() => {
    if (kbDocuments.length === 0 && !kbDocsLoading) { loadKbStatus(); loadKbDocuments(); }
    loadPublishedExercises();
    return () => { if (kbStatusTimerRef.current) clearTimeout(kbStatusTimerRef.current); };
  }, []);

  const handleKbUpload = async (options: any) => {
    const { file, onSuccess, onError } = options;
    const courseVal = kbUploadForm.getFieldValue('course');
    const course = Array.isArray(courseVal) ? courseVal[0] : (courseVal || '默认课程');
    const chapter = kbUploadForm.getFieldValue('chapter') || '';
    setKbUploading(true); setKbUploadModal(true); setKbUploadLog([`开始导入: ${file.name}`]);
    try {
      const res = await knowledgeApi.upload(file, course, chapter);
      if (res.data.success) {
        setKbUploadLog(prev => [...prev, `✅ 导入成功: ${file.name}`]);
        message.success(res.data.message || '上传成功'); loadKbStatus(); loadKbDocuments();
        onSuccess(res.data, file);
      } else {
        setKbUploadLog(prev => [...prev, `❌ 导入失败: ${res.data.message || '未知错误'}`]);
        message.error(res.data.message || '上传失败');
        onError(new Error(res.data.message || '未知错误'));
      }
    } catch (e: any) {
      setKbUploadLog(prev => [...prev, `❌ 导入失败: ${e.response?.data?.detail || e.message}`]);
      message.error(e.response?.data?.detail || '上传失败');
      onError(e);
    } finally { setKbUploading(false); kbUploadForm.resetFields(); }
  };

  const courseOptions = [
    { value: '机器学习', label: '机器学习' }, { value: '深度学习', label: '深度学习' },
    { value: '自然语言处理', label: '自然语言处理' }, { value: '计算机视觉', label: '计算机视觉' },
  ];

  return (
    <div className="page-enter" style={{ position: 'relative' }}>
      {/* API Key 横幅 */}
      {!canGenerate && <ApiKeyBanner onGoSettings={guard.goToSettings} />}

      {/* 页面头部 */}
      <div style={{ marginBottom: 16 }}>
        <Space align="center" size={10}>
          <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }}
            style={{ width: 32, height: 32, display: 'inline-flex', animation: 'logoPulse 0.8s ease-out' }} />
          <div>
            <Title level={4} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: BRAND.colors.textPrimary }}>
              智教星 · 作业智能辅批
            </Title>
            <Text type="secondary" style={{ fontSize: 11 }}>AI 分层出题 · 批量文件批改 · 知识库文档管理</Text>
          </div>
        </Space>
      </div>

      <Tabs defaultActiveKey="exercise" style={{ background: '#fff', borderRadius: 12, padding: '4px 16px 16px', boxShadow: CARD_SPECS.shadow }}
        tabBarExtraContent={
          <Button icon={<HistoryOutlined />} type="text" onClick={handleOpenHistory}
            style={{ color: BRAND.colors.primary }}>批改记录</Button>
        }
        items={[
          // ═══════════════════════════════════════════════════
          // Tab 1: 出题助手
          // ═══════════════════════════════════════════════════
          {
            key: 'exercise',
            label: <span><FileAddOutlined style={{ color: BRAND.colors.purple }} />出题助手</span>,
            children: (
              <Row gutter={20}>
                <Col xs={24} lg={8}>
                  <Card className="brand-card" bodyStyle={{ padding: '16px 20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', top: 8, right: 10, color: BRAND.colors.purple, opacity: 0.3 }}><BrandBadge size={16} color={BRAND.colors.purple} /></span>
                    <Space style={{ marginBottom: 12 }}>
                      <BookOutlined style={{ color: BRAND.colors.purple }} />
                      <Text strong style={{ fontSize: 14 }}>AI 分层出题</Text>
                    </Space>
                    <Form form={exerciseForm} layout="vertical" onFinish={handleGenerateExercises}
                      initialValues={{ difficulty: '中等', count: 5, types: ['选择题', '填空题', '简答题'] }} size="middle">
                      <Form.Item name="course_name" label="课程" rules={[{ required: true }]}>
                        <Select
                          style={{ borderRadius: 8 }}
                          options={courseList.map(c => ({ value: c, label: c }))}
                          onChange={(v) => handleCourseChange(v)}
                          showSearch
                          placeholder="选择课程"
                          notFoundContent="加载中..."
                        />
                      </Form.Item>
                      <Form.Item name="chapter" label="章节">
                        <AutoComplete
                          style={{ width: '100%' }}
                          options={chapterList.map(ch => ({ value: ch, label: ch }))}
                          open={chapterOpen}
                          onFocus={() => { if (chapterList.length > 0) setChapterOpen(true); }}
                          onBlur={() => setChapterOpen(false)}
                          onSelect={(v) => { handleChapterChange(v); setChapterOpen(false); }}
                          onChange={(v) => { if (!v) { handleChapterChange(''); setChapterOpen(false); } }}
                          placeholder={chaptersLoading ? '加载章节中...' : chapterList.length > 0 ? '点击选择或输入章节' : '先选择课程'}
                          filterOption={(inputValue, option) =>
                            option!.value.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                          }
                        />
                        {chaptersLoading && <Text type="secondary" style={{ fontSize: 11 }}>加载中...</Text>}
                      </Form.Item>
                      <Form.Item name="knowledge_points" label="知识点" rules={[{ required: true }]}
                        help={kpList.length > 0 ? `共 ${kpList.length} 个建议知识点，可多选或自行输入` : '选择课程后自动加载知识点建议'}>
                        <Select
                          mode="tags"
                          style={{ borderRadius: 8 }}
                          placeholder={kpLoading ? '加载知识点中...' : kpList.length > 0 ? '选择或输入知识点' : '先选择课程'}
                          options={kpList.map(kp => ({ value: kp, label: kp }))}
                          maxTagCount={8}
                          loading={kpLoading}
                          filterOption={(inputValue, option) =>
                            option!.label.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                          }
                        />
                      </Form.Item>
                      <Row gutter={12}>
                        <Col span={12}>
                          <Form.Item name="difficulty" label="难度">
                            <Select style={{ borderRadius: 8 }} options={difficultyOptions} />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item name="count" label="数量">
                            <InputNumber min={1} max={50} style={{ width: '100%', borderRadius: 8 }} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item name="types" label="题型">
                        <Select mode="multiple" style={{ borderRadius: 8 }} options={questionTypeOptions.slice(0, 6)} />
                      </Form.Item>
                      <Form.Item style={{ marginBottom: 0 }}>
                        {canGenerate ? (
                          <Button type="primary" htmlType="submit" loading={generating} icon={<ThunderboltOutlined />} block
                            style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, height: 40 }}>
                            {generating ? 'AI 出题中...' : '生成题目'}
                          </Button>
                        ) : (
                          <DisabledAIButton label="AI 出题已锁定" icon={<KeyOutlined />} />
                        )}
                      </Form.Item>
                    </Form>
                    {exError && <Alert message={exError} type="error" showIcon style={{ marginTop: 12, borderRadius: 8 }} />}
                  </Card>
                </Col>
                <Col xs={24} lg={16}>
                  {generating && (
                    <Card className="brand-card" bodyStyle={{ padding: 40, textAlign: 'center' }}>
                      <div style={{ animation: 'logoGlow 1.5s ease-in-out infinite' }}>
                        <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 48, height: 48, display: 'inline-block' }} />
                      </div>
                      <Spin style={{ marginTop: 12 }} />
                      <Paragraph style={{ marginTop: 8, color: BRAND.colors.textSecondary, fontSize: 12 }}>AI 正在分层出题...</Paragraph>
                    </Card>
                  )}
                  {exercises.length > 0 && !generating && (
                    <Card className="brand-card"
                      title={<Space><BrandBadge color={BRAND.colors.purple} /><FileAddOutlined style={{ color: BRAND.colors.purple }} /><Text strong>共 {exercises.length} 道练习题（待保存）</Text></Space>}
                      bodyStyle={{ padding: '12px 16px' }}
                      extra={
                        <Space>
                          <Button icon={<DownloadOutlined />} size="small" onClick={handleExportExercisesWord}
                            style={{ borderRadius: 6, borderColor: BRAND.colors.green, color: BRAND.colors.green }}>导出 Word</Button>
                          <Button icon={<SaveOutlined />} size="small" onClick={handleSaveToBank} loading={savingToBank}
                            type="primary" style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>
                            保存至题库
                          </Button>
                          <Button icon={<SendOutlined />} size="small" onClick={handleSaveAndPublish} loading={savingToBank}
                            style={{ borderRadius: 6, border: 'none', background: `linear-gradient(135deg, ${BRAND.colors.purple}, ${BRAND.colors.primary})`, color: '#fff' }}>
                            发布
                          </Button>
                        </Space>
                      }
                    >
                      <Space style={{ marginBottom: 12 }}>
                        <Text strong style={{ fontSize: 12 }}>难度分布：</Text>
                        {['简单', '中等', '困难'].map(d => { const c = exercises.filter(e => e.difficulty === d).length; return c > 0 ? <Tag key={d} style={{ borderRadius: 6 }}>{d}: {c}题</Tag> : null; })}
                      </Space>
                      {exercises.map((ex, idx) => (
                        <Card key={idx} size="small" style={{ marginBottom: 8, borderRadius: 8 }}
                          title={<Space><Tag style={{ borderRadius: 6 }}>#{idx + 1}</Tag><Text strong style={{ fontSize: 13 }}>[{ex.type}]</Text></Space>}
                          extra={<Tag color={ex.difficulty === '简单' ? 'green' : ex.difficulty === '困难' ? 'red' : 'orange'} style={{ borderRadius: 6 }}>{ex.difficulty}</Tag>}>
                          <Paragraph><Text strong>{ex.question}</Text></Paragraph>
                          {ex.options?.length > 0 && <div style={{ marginLeft: 16, marginBottom: 8 }}>{ex.options.map((opt: string, oi: number) => <Paragraph key={oi} style={{ margin: 0, fontSize: 12 }}>{opt}</Paragraph>)}</div>}
                          <Space><Tag style={{ borderRadius: 6, background: `${BRAND.colors.primary}10`, color: BRAND.colors.primary, border: 'none' }}>{ex.knowledge_point}</Tag><Text type="secondary" style={{ fontSize: 11 }}>预计 {ex.estimated_time} 分钟</Text></Space>
                          <Collapse items={[{ key: 'a', label: '查看答案与解析', children: <div><Text strong>答案：</Text><Paragraph>{ex.answer}</Paragraph><Text strong>解析：</Text><Paragraph>{ex.explanation}</Paragraph></div> }]} style={{ marginTop: 6, borderRadius: 8 }} />
                        </Card>
                      ))}
                    </Card>
                  )}

                  {/* 已保存到题库的题目 — 可发布 */}
                  {savedQuestions.length > 0 && !generating && (
                    <Card className="brand-card" style={{ marginTop: 12 }}
                      title={<Space><CheckCircleOutlined style={{ color: BRAND.colors.green }} /><Text strong>已保存 {savedQuestions.length} 道题（草稿）</Text></Space>}
                      bodyStyle={{ padding: '10px 16px' }}
                      extra={
                        <Space>
                          <Button icon={<SendOutlined />} size="small" type="primary"
                            onClick={() => setPublishExModalOpen(true)}
                            style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>
                            发布
                          </Button>
                        </Space>
                      }>
                      {savedQuestions.map((q, idx) => (
                        <Card key={q.id} size="small" style={{ marginBottom: 4, borderRadius: 6 }}
                          title={<Space size={4}><Tag color="blue" style={{ borderRadius: 6 }}>#{idx + 1}</Tag><Text style={{ fontSize: 12 }}>[{q.type}]</Text><Tag>{q.difficulty}</Tag></Space>}>
                          <Paragraph ellipsis={{ rows: 1 }} style={{ margin: 0, fontSize: 12 }}>{q.question}</Paragraph>
                        </Card>
                      ))}
                    </Card>
                  )}

                  {/* 已发布列表 */}
                  {publishedExList.length > 0 && (
                    <Card className="brand-card" style={{ marginTop: 12 }}
                      title={<Space><SendOutlined style={{ color: BRAND.colors.primary }} /><Text strong>已发布作业</Text></Space>}
                      bodyStyle={{ padding: '8px 16px' }}
                      extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadPublishedExercises} loading={pubExLoading} style={{ borderRadius: 6 }}>刷新</Button>}>
                      <List dataSource={publishedExList} renderItem={(item: any) => (
                        <List.Item actions={[
                          <Button key="view" type="link" size="small" onClick={() => handleViewPublishedQuestions(item.id)}>查看题目</Button>,
                          <Button key="unpub" type="link" size="small" danger onClick={() => handleUnpublishExercise(item.id)}>撤销发布</Button>,
                        ]}>
                          <List.Item.Meta
                            title={<Text strong>{item.title}</Text>}
                            description={<Space><Tag color="blue" style={{ borderRadius: 6 }}>{item.course}</Tag><Text type="secondary" style={{ fontSize: 11 }}>{item.question_count} 道题 · {item.created_at}</Text></Space>}
                          />
                        </List.Item>
                      )} />
                    </Card>
                  )}
                  {exercises.length === 0 && !generating && (
                    <Card className="brand-card" bodyStyle={{ padding: 60, textAlign: 'center' }}>
                      <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 48, height: 48, display: 'inline-block', opacity: 0.3 }} />
                      <Paragraph style={{ marginTop: 8, color: BRAND.colors.textTertiary, fontSize: 13 }}>设置参数后开始 AI 出题</Paragraph>
                    </Card>
                  )}
                </Col>
              </Row>
            ),
          },
          // ═══════════════════════════════════════════════════
          // Tab 3: 文件批改
          // ═══════════════════════════════════════════════════
          {
            key: 'file',
            label: <span><UploadOutlined style={{ color: BRAND.colors.green }} />文件批改</span>,
            children: (
              <Row gutter={20}>
                <Col xs={24} lg={10}>
                  <Card className="brand-card" bodyStyle={{ padding: '16px 20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', top: 8, right: 10, color: BRAND.colors.green, opacity: 0.3 }}><BrandBadge size={16} color={BRAND.colors.green} /></span>
                    <Space style={{ marginBottom: 12 }}>
                      <InboxOutlined style={{ color: BRAND.colors.green, fontSize: 18 }} />
                      <Text strong style={{ fontSize: 14 }}>上传作业文件</Text>
                    </Space>
                    <Alert message="支持 CSV / TXT / PDF / Word / 图片（JPG/PNG）格式" type="info" showIcon style={{ borderRadius: 8, marginBottom: 8, fontSize: 11 }} />
                    <Alert message="只批改选择题、判断题和答案为数字的填空题" type="warning" showIcon style={{ borderRadius: 8, marginBottom: 12, fontSize: 11 }} />
                    {/* 答案文件上传 */}
                    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fffbe6', borderRadius: 8, border: '1px solid #ffe58f' }}>
                      <Space direction="vertical" style={{ width: '100%' }} size={4}>
                        <Text strong style={{ fontSize: 12, color: BRAND.colors.orange }}>
                          <FileTextOutlined style={{ marginRight: 4 }} />参考答案文件（可选）
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          上传包含标准答案的 PDF / Word / TXT 文件，AI 将参照答案进行批改
                        </Text>
                        <label style={{ display: 'inline-block', cursor: answerUploading ? 'wait' : 'pointer', marginTop: 4 }}>
                          <input
                            type="file"
                            accept=".pdf,.docx,.doc,.txt"
                            onChange={handleAnswerFileUpload}
                            style={{ display: 'none' }}
                            disabled={answerUploading}
                          />
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 12px', height: 28, fontSize: 12,
                            border: `1px solid ${BRAND.colors.orange}`, borderRadius: 6,
                            color: BRAND.colors.orange, background: '#fff',
                            cursor: 'pointer',
                          }}>
                            <UploadOutlined />
                            {answerUploading ? '解析中...' : answerFile ? `更换答案文件` : '上传答案文件'}
                          </span>
                        </label>
                        {answerFile && (
                          <Tag color="orange" style={{ borderRadius: 6, marginLeft: 0 }}>
                            ✅ 已加载「{answerFile.name}」
                            {answerStats.total > 0 && (
                              <span style={{ marginLeft: 2 }}>
                                （{answerStats.total} 题：{[
                                  answerStats.choice > 0 ? `${answerStats.choice}选择` : '',
                                  answerStats.tf > 0 ? `${answerStats.tf}判断` : '',
                                  answerStats.fill > 0 ? `${answerStats.fill}填空` : '',
                                ].filter(Boolean).join(' + ')}）
                              </span>
                            )}
                            <Button type="text" size="small" style={{ fontSize: 10, color: '#ff4d4f', padding: 0, marginLeft: 4 }}
                              onClick={() => { setAnswerFile(null); setAnswerMap({}); setAnswerStats({ choice: 0, tf: 0, fill: 0, total: 0 }); }}>移除</Button>
                          </Tag>
                        )}
                      </Space>
                    </div>
                    {/* 答题卡提示 */}
                    <Alert message="提交的文件是只有题号和答案的答题卡" type="info" showIcon style={{ borderRadius: 8, marginBottom: 12, fontSize: 11 }} />
                    {/* 自定义拖拽上传区域，用 label 包裹确保浏览器不拦截 click */}
                    <label style={{ display: 'block', cursor: 'pointer' }}>
                      <input
                        type="file"
                        multiple
                        accept=".csv,.txt,.pdf,.docx,.doc,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                        onChange={handleBatchFileChange}
                        style={{ display: 'none' }}
                      />
                      <div
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDrop={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          const files = Array.from(e.dataTransfer.files);
                          processBatchFiles(files);
                        }}
                        style={{
                          border: '2px dashed #d9d9d9', borderRadius: 8, padding: '24px 16px',
                          textAlign: 'center', background: '#fafafa',
                          transition: 'border-color 0.3s', cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = BRAND.colors.primary; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d9d9d9'; }}
                      >
                        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                        <p className="ant-upload-text">点击或拖拽文件</p>
                        <p className="ant-upload-hint">支持 PDF / Word / CSV / TXT / 图片</p>
                      </div>
                    </label>
                    {uploadedFiles.length > 0 && (
                      <Card size="small" style={{ marginTop: 12, borderRadius: 8 }}
                        title={<Space><span>已添加 {uploadedFiles.length} 个文件</span>
                          {!batchGrading && <Button type="link" size="small" danger onClick={handleClearFiles}>清空</Button>}</Space>}>
                        <List size="small" dataSource={uploadedFiles} renderItem={(item) => {
                          const tagColor = item.type === 'csv' ? 'green' : item.type === 'txt' ? 'blue' : item.type === 'pdf' ? 'red' : item.type === 'image' ? 'orange' : 'geekblue';
                          return (
                            <List.Item actions={[<Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => handleRemoveFile(item.uid)} disabled={batchGrading} />]}>
                              <List.Item.Meta
                                avatar={getFileIcon(item.type)}
                                title={<Space><Text ellipsis={{ tooltip: item.name }} style={{ maxWidth: 180 }}>{item.name}</Text><Tag color={tagColor} style={{ fontSize: 10 }}>{item.type.toUpperCase()}</Tag></Space>}
                                description={<Space size={8}>
                                  <Text style={{ fontSize: 11 }}>{(item.size / 1024).toFixed(1)} KB</Text>
                                  {item.status === 'parsing' && <Tag color="processing" style={{ fontSize: 10 }}>解析中...</Tag>}
                                  {item.status === 'parsed' && <Tag color="success" style={{ fontSize: 10 }}>{item.recordCount} 条</Tag>}
                                  {item.status === 'error' && <Tag color="error" style={{ fontSize: 10 }}>{item.errorMessage || '失败'}</Tag>}
                                  {item.status === 'pending' && <Tag style={{ fontSize: 10 }}>待处理</Tag>}
                                </Space>}
                              />
                            </List.Item>
                          );
                        }} />
                      </Card>
                    )}
                    {fileSubmissions.length > 0 && <Tag color="blue" style={{ marginTop: 8 }}>共 {fileSubmissions.length} 条待批改</Tag>}
                    {answerStats.total > 0 && fileSubmissions.length > 0 && (
                      <Alert
                        type="info" showIcon
                        message={`将仅批改选择题、判断题和填空题（答案文件已解析 ${answerStats.total} 道题答案）`}
                        style={{ marginTop: 8, borderRadius: 8, fontSize: 12 }}
                      />
                    )}
                    <div style={{ marginTop: 12 }}>
                      {canGenerate ? (
                        <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleBatchGrade} loading={batchGrading} size="large" block
                          disabled={fileSubmissions.length === 0 && !uploadedFiles.some(f => (f.type === 'pdf' || f.type === 'word' || f.type === 'image') && (f.status === 'pending' || f.status === 'error'))}
                          style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, height: 44 }}>
                          {batchGrading ? 'AI 批量批改中...' : '开始批量批改'}
                        </Button>
                      ) : (
                        <DisabledAIButton label="批量批改已锁定" icon={<KeyOutlined />} />
                      )}
                    </div>
                    {batchError && <Alert message={batchError} type="error" showIcon closable style={{ marginTop: 8, borderRadius: 8 }} />}
                  </Card>
                </Col>
                <Col xs={24} lg={14}>
                  {fileSubmissions.length > 0 && !batchGrading && (
                    <Card title={<Space><BrandBadge />📋 待批改列表（{fileSubmissions.length} 份）</Space>} size="small" className="brand-card">
                      <Table dataSource={fileSubmissions} rowKey={(_, i) => String(i)} size="small" pagination={false} scroll={{ y: 400 }}
                        columns={[
                          { title: '学生', dataIndex: 'student_name', width: 70 },
                          { title: '课程', dataIndex: 'course_name', width: 80 },
                          { title: '题目', dataIndex: 'question_text', ellipsis: true, width: 180 },
                          { title: '答案', dataIndex: 'student_answer', ellipsis: true, width: 130 },
                          { title: '来源', dataIndex: '_sourceFile', width: 100, ellipsis: true, render: (v: string) => v ? <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text> : '-' },
                          { title: '操作', width: 60, render: (_: any, __: any, idx: number) => (
                            <Button type="link" size="small" icon={<EditOutlined />} style={{ fontSize: 11 }}
                              onClick={() => setEditingSubmission({ index: idx, data: { ...fileSubmissions[idx] } })}>编辑</Button>
                          )},
                        ]} />
                    </Card>
                  )}
                  {batchGrading && (
                    <Card className="brand-card" bodyStyle={{ padding: 40, textAlign: 'center' }}>
                      <div style={{ animation: 'logoGlow 1.5s ease-in-out infinite' }}>
                        <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 48, height: 48, display: 'inline-block' }} />
                      </div>
                      <Spin style={{ marginTop: 12 }} />
                      <Paragraph style={{ marginTop: 8, color: BRAND.colors.textSecondary, fontSize: 12 }}>AI 批量批改中...</Paragraph>
                    </Card>
                  )}
                  {batchResults.length > 0 && !batchGrading && (() => {
                    // ── 收集所有不重复的文件名 ──
                    const allFileNames = [...new Set(batchResults.map((r: any) => r._sourceFile || r.source_file || '未知文件'))];

                    // ── 辅助：从结果中提取排序用的题号 ──
                    const getSortKey = (r: any): number => {
                      const qNum = extractQuestionNumber(r.question_text || '');
                      if (qNum !== null) return qNum;
                      // 回退：尝试从 student_answer 或 question_type 推断
                      return 9999; // 无法提取题号的放到最后
                    };

                    // ── 按文件筛选结果 ──
                    const filteredResults = resultFileFilter
                      ? batchResults.filter((r: any) => (r._sourceFile || r.source_file || '未知文件') === resultFileFilter)
                      : batchResults;

                    // 按来源文件分组（使用筛选后的结果）
                    const groupMap: Record<string, any[]> = {};
                    filteredResults.forEach((r: any) => {
                      const key = r._sourceFile || r.source_file || '未知文件';
                      if (!groupMap[key]) groupMap[key] = [];
                      groupMap[key].push(r);
                    });
                    // ⚠️ 每个文件组内按题号排序，保持与原始文件一致
                    Object.values(groupMap).forEach(items => {
                      items.sort((a, b) => getSortKey(a) - getSortKey(b));
                    });
                    const groups = Object.entries(groupMap);
                    const gradedForStats = filteredResults.filter((r: any) => !r._needs_review);
                    const needsReviewCount = filteredResults.filter((r: any) => r._needs_review).length;
                    const overallAvg = gradedForStats.length > 0
                      ? (gradedForStats.reduce((s: number, r: any) => s + (r.percentage || 0), 0) / gradedForStats.length).toFixed(1)
                      : '—';
                    const overallPass = gradedForStats.length > 0
                      ? (gradedForStats.filter((r: any) => (r.percentage || 0) >= 60).length / gradedForStats.length * 100).toFixed(1)
                      : '—';

                    return (
                    <div>
                      {/* 文件筛选按钮 */}
                      {allFileNames.length > 1 && (
                        <div style={{ marginBottom: 12 }}>
                          <Space wrap size={[4, 4]}>
                            <Button
                              size="small"
                              type={!resultFileFilter ? 'primary' : 'default'}
                              onClick={() => setResultFileFilter(null)}
                              style={{ borderRadius: 6, fontSize: 12 }}
                            >
                              全部文件（{batchResults.length}）
                            </Button>
                            {allFileNames.map(fn => {
                              const count = batchResults.filter((r: any) => (r._sourceFile || r.source_file || '未知文件') === fn).length;
                              return (
                                <Button
                                  key={fn}
                                  size="small"
                                  type={resultFileFilter === fn ? 'primary' : 'default'}
                                  onClick={() => setResultFileFilter(fn)}
                                  style={{ borderRadius: 6, fontSize: 12 }}
                                >
                                  <FileTextOutlined style={{ marginRight: 4 }} />
                                  {fn.length > 20 ? fn.slice(0, 19) + '…' : fn}（{count}）
                                </Button>
                              );
                            })}
                          </Space>
                        </div>
                      )}

                      {/* 总体统计 */}
                      <Card className="brand-card" style={{ marginBottom: 12 }}
                        title={<Space><CheckCircleOutlined style={{ color: BRAND.colors.green }} /><Text strong>批改结果汇总（{filteredResults.length} 份 · {groups.length} 个文件）{resultFileFilter ? <Tag color="blue" style={{ borderRadius: 6, fontSize: 11 }}>筛选：{resultFileFilter.length > 15 ? resultFileFilter.slice(0, 14) + '…' : resultFileFilter}</Tag> : null}</Text></Space>}
                        bodyStyle={{ padding: '10px 16px' }}
                        extra={<Button icon={<DownloadOutlined />} size="small" onClick={() => exportBatchReport(filteredResults)} style={{ borderRadius: 6, borderColor: BRAND.colors.primary, color: BRAND.colors.primary }}>导出当前报告</Button>}>
                        <Row gutter={12}>
                          <Col span={6}><Statistic title="平均分" value={overallAvg} suffix={overallAvg !== '—' ? '%' : ''} valueStyle={{ fontSize: 18, fontWeight: 600 }} /></Col>
                          <Col span={6}><Statistic title="通过率" value={overallPass} suffix={overallPass !== '—' ? '%' : ''} valueStyle={{ fontSize: 18, fontWeight: 600 }} /></Col>
                          <Col span={6}><Statistic title="已批改" value={gradedForStats.length} suffix="份" valueStyle={{ fontSize: 18, fontWeight: 600, color: BRAND.colors.green }} /></Col>
                          <Col span={6}><Statistic title="待处理" value={needsReviewCount} suffix="份" valueStyle={{ fontSize: 18, fontWeight: 600, color: needsReviewCount > 0 ? BRAND.colors.orange : BRAND.colors.textSecondary }} /></Col>
                        </Row>
                      </Card>

                      {/* 按文件分组展示 */}
                      {groups.map(([fileName, items], gi) => {
                        const needsReviewItems = items.filter((r: any) => r._needs_review);
                        const gradedItems = items.filter((r: any) => !r._needs_review);
                        const fAvg = gradedItems.length > 0
                          ? (gradedItems.reduce((s: number, r: any) => s + (r.percentage || 0), 0) / gradedItems.length).toFixed(1)
                          : '—';
                        const fMax = gradedItems.length > 0
                          ? Math.max(...gradedItems.map((r: any) => r.percentage || 0)).toFixed(1)
                          : '—';
                        const fMin = gradedItems.length > 0
                          ? Math.min(...gradedItems.map((r: any) => r.percentage || 0)).toFixed(1)
                          : '—';
                        const fPass = gradedItems.length > 0
                          ? (gradedItems.filter((r: any) => (r.percentage || 0) >= 60).length / gradedItems.length * 100).toFixed(1)
                          : '—';
                        return (
                          <Card key={fileName} className="brand-card" style={{ marginBottom: 12 }}
                            title={<Space><FileTextOutlined style={{ color: BRAND.colors.primary }} /><Text strong>{fileName}</Text><Tag style={{ borderRadius: 8 }}>{items.length} 份</Tag></Space>}
                            bodyStyle={{ padding: '8px 16px' }}>
                            {gradedItems.length > 0 && (
                              <Row gutter={12} style={{ marginBottom: 8, padding: '8px 12px', background: '#fafafa', borderRadius: 6 }}>
                                <Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>均分</Text><br/><Text strong style={{ fontSize: 14 }}>{fAvg}%</Text></Col>
                                <Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>最高</Text><br/><Text strong style={{ fontSize: 14, color: BRAND.colors.green }}>{fMax}%</Text></Col>
                                <Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>最低</Text><br/><Text strong style={{ fontSize: 14, color: BRAND.colors.error }}>{fMin}%</Text></Col>
                                <Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>通过率</Text><br/><Text strong style={{ fontSize: 14 }}>{fPass}%</Text></Col>
                              </Row>
                            )}
                            {/* 需要人工审核的项目：文档解析失败但提取了文本 */}
                            {needsReviewItems.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <Alert type="warning" showIcon
                                  message={`${needsReviewItems.length} 条记录需人工处理`}
                                  description={needsReviewItems[0]?.feedback || '文档内容已提取但未能自动解析作业结构，请手动拆分为题目和答案'}
                                  style={{ borderRadius: 8, marginBottom: 8, fontSize: 12 }} />
                                {needsReviewItems.map((item: any, nri: number) => (
                                  <Card key={`review-${nri}`} size="small" style={{ marginBottom: 4, borderRadius: 6, borderColor: '#faad14' }}>
                                    <Space direction="vertical" style={{ width: '100%' }} size={4}>
                                      <Space><Tag color="warning" style={{ borderRadius: 6 }}>待处理</Tag>
                                        <Text strong style={{ fontSize: 12 }}>{item.student_name || '未知学生'}</Text>
                                        <Text type="secondary" style={{ fontSize: 11 }}>— {item.source_file || fileName}</Text>
                                      </Space>
                                      {item.question_text && (
                                        <div style={{ maxHeight: 120, overflow: 'auto', background: '#fafafa', padding: 8, borderRadius: 4 }}>
                                          <Text style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#666' }}>{item.question_text.substring(0, 500)}</Text>
                                        </div>
                                      )}
                                      {item.suggestions?.length > 0 && (
                                        <Space size={4} wrap>
                                          {item.suggestions.map((s: string, si: number) => (
                                            <Tag key={si} color="processing" style={{ fontSize: 10, borderRadius: 4 }}>{s}</Tag>
                                          ))}
                                        </Space>
                                      )}
                                    </Space>
                                  </Card>
                                ))}
                              </div>
                            )}
                            <List dataSource={gradedItems} renderItem={(item: any, idx: number) => {
                              const displayNum = extractQuestionNumber(item.question_text || '') ?? (idx + 1);
                              return (
                              <Card size="small" style={{ marginBottom: 4, borderRadius: 6 }} key={idx}
                                title={<Space size={4}><Text strong style={{ fontSize: 12 }}>第{displayNum}题</Text>{item.student_name && <Tag color="blue" style={{ borderRadius: 6, fontSize: 11 }}>{item.student_name}</Tag>}<Progress type="circle" percent={item.percentage || 0} size={28} status={(item.percentage || 0) >= 60 ? 'success' : 'exception'} /></Space>}
                                extra={<Button type="link" size="small" icon={<EditOutlined />} onClick={() => setEditingResult({ index: batchResults.indexOf(item), data: { ...item } })} style={{ fontSize: 11 }}>编辑</Button>}>
                                <Descriptions column={2} size="small">
                                  <Descriptions.Item label="得分">{item.score} / {item.max_score}</Descriptions.Item>
                                  <Descriptions.Item label="知识点">{item.knowledge_points?.join(', ') || '-'}</Descriptions.Item>
                                </Descriptions>
                                {item.feedback && <Paragraph type="secondary" style={{ fontSize: 11, margin: 0 }}>{item.feedback}</Paragraph>}
                              </Card>
                              );
                            }} />
                          </Card>
                        );
                      })}

                      {/* 操作按钮 */}
                      <div style={{ textAlign: 'center', marginTop: 12 }}>
                        <Space>
                          <Button icon={<HistoryOutlined />} loading={archiving} onClick={handleArchiveResults}
                            style={{ borderRadius: 8, borderColor: BRAND.colors.purple, color: BRAND.colors.purple }}
                            disabled={archived}>归入教学台账</Button>
                          {archived && (
                            <Button icon={<HistoryOutlined />} onClick={goToLedger}
                              style={{ borderRadius: 8, border: 'none', background: BRAND.colors.primaryGradient, color: '#fff' }}>查看台账记录</Button>
                          )}
                        </Space>
                      </div>
                    </div>
                    );
                  })()}
                  {!batchGrading && batchResults.length === 0 && fileSubmissions.length === 0 && uploadedFiles.length === 0 && (
                    <Card className="brand-card" bodyStyle={{ padding: 60, textAlign: 'center' }}>
                      <span dangerouslySetInnerHTML={{ __html: BRAND.logoSvg }} style={{ width: 48, height: 48, display: 'inline-block', opacity: 0.3 }} />
                      <Paragraph style={{ marginTop: 8, color: BRAND.colors.textTertiary, fontSize: 13 }}>上传文件开始批量批改</Paragraph>
                    </Card>
                  )}
                </Col>
              </Row>
            ),
          },
          // ═══════════════════════════════════════════════════
          // Tab 4: 知识库文档管理
          // ═══════════════════════════════════════════════════
          {
            key: 'knowledge',
            label: <span><DatabaseOutlined style={{ color: BRAND.colors.primary }} />知识库文档管理</span>,
            children: (
              <div>
                {/* 知识库状态 */}
                <Card className="brand-card" style={{ marginBottom: 16 }}
                  title={<Space><DatabaseOutlined style={{ color: BRAND.colors.primary }} /><Text strong>知识库状态</Text></Space>}
                  extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadKbStatus} loading={kbStatusLoading} style={{ borderRadius: 6 }}>刷新</Button>}>
                  {kbStatusLoading ? <Spin><div style={{ padding: 24 }} /></Spin> : kbStatusError ? (
                    <div style={{ textAlign: 'center', padding: 16 }}><Text type="danger" style={{ fontSize: 12 }}>{kbStatusError}</Text><br /><Button type="link" size="small" onClick={loadKbStatus} style={{ marginTop: 4 }}>重试</Button></div>
                  ) : (
                    <Row gutter={[12, 12]}>
                      <Col xs={12} sm={6}><Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px' }}>
                        <Statistic title="文档总数" value={displayKbDocuments.length} suffix="份" valueStyle={{ fontSize: 20, fontWeight: 700, color: BRAND.colors.primary }} /></Card></Col>
                      <Col xs={12} sm={6}><Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px' }}>
                        <Statistic title="向量切片" value={displayKbDocuments.reduce((s, d) => s + (d.chunks || 0), 0)} suffix="段" valueStyle={{ fontSize: 20, fontWeight: 700, color: BRAND.colors.purple }} /></Card></Col>
                      <Col xs={12} sm={6}><Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px' }}>
                        <Statistic title="关联课程" value={[...new Set(displayKbDocuments.map(d => d.name))].length} suffix="门" valueStyle={{ fontSize: 20, fontWeight: 700, color: BRAND.colors.green }} /></Card></Col>
                      <Col xs={12} sm={6}><Card size="small" className="brand-card" bodyStyle={{ padding: '10px 14px' }}>
                        <Statistic title="存储占用" value={kbStatus?.storage || '—'} valueStyle={{ fontSize: 18, fontWeight: 700, color: BRAND.colors.orange }} /></Card></Col>
                    </Row>
                  )}
                  {displayKbDocuments.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Text style={{ fontSize: 11, color: BRAND.colors.textSecondary }}>已有课程：</Text>
                      <Space wrap style={{ marginTop: 2 }}>
                        {[...new Set(displayKbDocuments.map(d => d.name))].map((c, i) => <Tag key={i} style={{ borderRadius: 6, fontSize: 10 }}>{c}</Tag>)}
                      </Space>
                    </div>
                  )}
                </Card>

                <Row gutter={16}>
                  {/* 导入教材 */}
                  <Col xs={24} lg={8}>
                    <Card className="brand-card" style={{ marginBottom: 16 }}
                      title={<Space><UploadOutlined style={{ color: BRAND.colors.green }} /><Text strong>导入教材</Text></Space>}>
                      <Form form={kbUploadForm} layout="vertical" size="small">
                        <Form.Item name="course" label="所属课程" rules={[{ required: true, message: '请输入或选择课程' }]}>
                          <Select mode="tags" maxCount={1} style={{ borderRadius: 8 }} placeholder="输入或选择课程" options={courseOptions} />
                        </Form.Item>
                        <Form.Item name="chapter" label="章节（可选）">
                          <Input placeholder="例：第三章 决策树" style={{ borderRadius: 8 }} />
                        </Form.Item>
                        <Form.Item style={{ marginBottom: 0 }}>
                          <Upload.Dragger accept=".pdf,.txt,.docx,.doc" customRequest={handleKbUpload} showUploadList={false} disabled={kbUploading} style={{ borderRadius: 8 }}>
                            {kbUploading ? <Spin tip="导入中..." /> : <div style={{ padding: 12 }}><InboxOutlined style={{ fontSize: 28, color: BRAND.colors.primary }} /><Paragraph style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>点击或拖拽文件</Paragraph><Text type="secondary" style={{ fontSize: 11 }}>PDF / Word / TXT</Text></div>}
                          </Upload.Dragger>
                        </Form.Item>
                      </Form>
                    </Card>
                  </Col>

                  {/* 文档列表 */}
                  <Col xs={24} lg={16}>
                    <Card className="brand-card" style={{ marginBottom: 16 }}
                      title={<Space><FileTextOutlined style={{ color: BRAND.colors.primary }} /><Text strong>知识库文档列表</Text></Space>}
                      bodyStyle={{ padding: '12px 16px' }}
                      extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadKbDocuments} loading={kbDocsLoading} style={{ borderRadius: 6 }}>刷新</Button>}>
                      <Table dataSource={displayKbDocuments} rowKey="id" size="small" pagination={{ pageSize: 8 }}
                        loading={kbDocsLoading}
                        locale={{ emptyText: '暂无知识库文档，请通过左侧「导入教材」上传 PDF 文件' }}
                        columns={[
                          { title: '文档名称', dataIndex: 'name', key: 'name', ellipsis: true,
                            render: (v: string) => <Space><FileTextOutlined style={{ color: BRAND.colors.primary }} /><Text style={{ fontSize: 12 }}>{v}</Text></Space> },
                          { title: '课程', dataIndex: 'course', key: 'course', width: 100,
                            render: (v: string) => <Tag style={{ borderRadius: 6, fontSize: 10 }}>{v}</Tag> },
                          { title: '切片数', dataIndex: 'chunks', key: 'chunks', width: 70,
                            render: (v: number) => <Text style={{ color: v > 0 ? BRAND.colors.green : '#999' }}>{v || 0}</Text> },
                          { title: '大小', dataIndex: 'size', key: 'size', width: 70 },
                          { title: '上传时间', dataIndex: 'created_at', key: 'created_at', width: 100 },
                          { title: '操作', key: 'action', width: 160,
                            render: (_: any, record: any) => (
                              <Space size={0}>
                                <Button type="link" size="small" icon={<EyeOutlined />} style={{ fontSize: 11, color: BRAND.colors.primary }}
                                  onClick={() => handleViewDocument(record)}>查看</Button>
                                <Popconfirm title="确认删除此知识库？" onConfirm={() => {
                                  knowledgeApi.deleteCollection(record.course || record.name).then(() => { message.success('已删除'); loadKbDocuments(); loadKbStatus(); }).catch(() => message.error('删除失败'));
                                }}><Button type="link" size="small" danger style={{ fontSize: 11 }}>删除</Button></Popconfirm>
                              </Space>
                            ) },
                        ]} />
                    </Card>
                  </Col>
                </Row>

                {/* 查看文档内容弹窗 */}
                <Modal title={<Space><FileTextOutlined style={{ color: BRAND.colors.primary }} />{viewDoc?.name || '文档内容'}</Space>}
                  open={!!viewDoc} onCancel={() => { setViewDoc(null); setViewContent(null); }} width={750}
                  footer={<Button onClick={() => { setViewDoc(null); setViewContent(null); }} style={{ borderRadius: 6 }}>关闭</Button>}>
                  {viewLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /><Paragraph style={{ marginTop: 8, color: BRAND.colors.textSecondary }}>加载文档内容...</Paragraph></div>
                  ) : viewContent?.error ? (
                    <Alert type="error" message={viewContent.error} showIcon />
                  ) : viewContent ? (
                    <div>
                      <Row gutter={12} style={{ marginBottom: 12 }}>
                        <Col span={8}><Card size="small"><Statistic title="文档名称" value={viewDoc?.name || '-'} valueStyle={{ fontSize: 14 }} /></Card></Col>
                        <Col span={8}><Card size="small"><Statistic title="切片总数" value={viewContent.total || 0} suffix="段" valueStyle={{ fontSize: 14, color: BRAND.colors.primary }} /></Card></Col>
                        <Col span={8}><Card size="small"><Statistic title="当前显示" value={viewContent.chunks?.length || 0} suffix="段" valueStyle={{ fontSize: 14 }} /></Card></Col>
                      </Row>
                      {viewContent.chunks && viewContent.chunks.length > 0 ? (
                        <div style={{ maxHeight: 420, overflow: 'auto', background: '#fafafa', borderRadius: 8, padding: 12 }}>
                          {viewContent.chunks.map((chunk: any, i: number) => (
                            <Card key={i} size="small" style={{ marginBottom: 8, borderRadius: 6 }}
                              title={<Space><Tag color="blue" style={{ borderRadius: 6 }}>#{i + 1}</Tag>
                                {chunk.chapter && <Tag style={{ borderRadius: 6, fontSize: 10 }}>{chunk.chapter}</Tag>}
                                {chunk.source && <Text type="secondary" style={{ fontSize: 10 }}>{chunk.source}</Text>}</Space>}>
                              <Paragraph style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{chunk.content}</Paragraph>
                            </Card>
                          ))}
                        </div>
                      ) : (
                        <Empty description="该文档暂无内容切片，请先导入教材文件" />
                      )}
                    </div>
                  ) : null}
                </Modal>

                {/* 导入进度弹窗 */}
                <Modal title="导入进度" open={kbUploadModal} onCancel={() => { if (!kbUploading) setKbUploadModal(false); }} footer={null} closable={!kbUploading} width={450}>
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    {kbUploading && <Progress percent={50} status="active" />}
                    <div style={{ maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 6 }}>
                      {kbUploadLog.map((log, i) => (
                        <Text key={i} style={{ display: 'block', fontSize: 11, fontFamily: 'monospace', color: log.includes('✅') ? BRAND.colors.green : log.includes('❌') ? BRAND.colors.error : '#333' }}>
                          {log}
                        </Text>
                      ))}
                    </div>
                    {!kbUploading && <Button type="primary" onClick={() => setKbUploadModal(false)} style={{ borderRadius: 6, background: BRAND.colors.primaryGradient, border: 'none' }}>完成</Button>}
                  </Space>
                </Modal>
              </div>
            ),
          },
        ]}
      />

      {/* 编辑待批改作业弹窗 */}
      <Modal title="编辑作业内容" open={!!editingSubmission} onCancel={() => setEditingSubmission(null)} width={600}
        footer={[
          <Button key="cancel" onClick={() => setEditingSubmission(null)} style={{ borderRadius: 6 }}>取消</Button>,
          <Button key="save" type="primary" onClick={() => {
            if (editingSubmission) {
              setFileSubmissions(prev => prev.map((s, i) => i === editingSubmission.index ? editingSubmission.data : s));
              setEditingSubmission(null);
              message.success('已更新');
            }
          }} style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>保存</Button>,
        ]}>
        {editingSubmission && (
          <Form layout="vertical" size="small">
            <Form.Item label="学生姓名">
              <Input value={editingSubmission.data.student_name} onChange={e => setEditingSubmission({ ...editingSubmission, data: { ...editingSubmission.data, student_name: e.target.value } })} style={{ borderRadius: 6 }} />
            </Form.Item>
            <Form.Item label="课程">
              <Input value={editingSubmission.data.course_name} onChange={e => setEditingSubmission({ ...editingSubmission, data: { ...editingSubmission.data, course_name: e.target.value } })} style={{ borderRadius: 6 }} />
            </Form.Item>
            <Form.Item label="题目内容">
              <TextArea rows={3} value={editingSubmission.data.question_text} onChange={e => setEditingSubmission({ ...editingSubmission, data: { ...editingSubmission.data, question_text: e.target.value } })} style={{ borderRadius: 6 }} />
            </Form.Item>
            <Form.Item label="学生答案">
              <TextArea rows={4} value={editingSubmission.data.student_answer} onChange={e => setEditingSubmission({ ...editingSubmission, data: { ...editingSubmission.data, student_answer: e.target.value } })} style={{ borderRadius: 6 }} />
            </Form.Item>
            <Form.Item label="参考答案">
              <TextArea rows={2} value={editingSubmission.data.reference_answer || ''} onChange={e => setEditingSubmission({ ...editingSubmission, data: { ...editingSubmission.data, reference_answer: e.target.value } })} style={{ borderRadius: 6 }} />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 编辑批改结果弹窗 */}
      <Modal title="编辑批改结果" open={!!editingResult} onCancel={() => setEditingResult(null)} width={600}
        footer={[
          <Button key="cancel" onClick={() => setEditingResult(null)} style={{ borderRadius: 6 }}>取消</Button>,
          <Button key="save" type="primary" onClick={() => {
            if (editingResult) {
              // 重新计算百分比
              const data = { ...editingResult.data };
              data.percentage = data.max_score > 0 ? Math.round(data.score / data.max_score * 100 * 10) / 10 : 0;
              setBatchResults(prev => prev.map((r, i) => i === editingResult.index ? data : r));
              setEditingResult(null);
              message.success('批改结果已更新');
            }
          }} style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>保存</Button>,
        ]}>
        {editingResult && (
          <Form layout="vertical" size="small">
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="得分">
                  <InputNumber min={0} max={editingResult.data.max_score || 100} value={editingResult.data.score} onChange={v => setEditingResult({ ...editingResult, data: { ...editingResult.data, score: v || 0 } })} style={{ width: '100%', borderRadius: 6 }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="满分">
                  <InputNumber min={1} value={editingResult.data.max_score} onChange={v => setEditingResult({ ...editingResult, data: { ...editingResult.data, max_score: v || 100 } })} style={{ width: '100%', borderRadius: 6 }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="综合评语">
              <TextArea rows={3} value={editingResult.data.feedback || ''} onChange={e => setEditingResult({ ...editingResult, data: { ...editingResult.data, feedback: e.target.value } })} style={{ borderRadius: 6 }} />
            </Form.Item>
            <Form.Item label="知识点（逗号分隔）">
              <Input value={(editingResult.data.knowledge_points || []).join(', ')} onChange={e => setEditingResult({ ...editingResult, data: { ...editingResult.data, knowledge_points: e.target.value.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean) } })} style={{ borderRadius: 6 }} />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 出题助手 — 发布弹窗 */}
      <Modal title="发布练习题" open={publishExModalOpen} onCancel={() => setPublishExModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setPublishExModalOpen(false)} style={{ borderRadius: 6 }}>取消</Button>,
          <Button key="publish" type="primary" onClick={handlePublishExercises} loading={publishingEx}
            style={{ borderRadius: 6, border: 'none', background: BRAND.colors.primaryGradient }}>确认发布</Button>,
        ]}>
        <Form layout="vertical" size="small">
          <Form.Item label="作业标题">
            <Input value={publishExTitle} onChange={e => setPublishExTitle(e.target.value)}
              placeholder={exerciseForm.getFieldValue('course_name') + ' · 练习题'} style={{ borderRadius: 6 }} />
          </Form.Item>
          <Form.Item label="截止日期（可选）">
            <Input value={publishExDeadline} onChange={e => setPublishExDeadline(e.target.value)}
              placeholder="如：2026-07-25" style={{ borderRadius: 6 }} />
          </Form.Item>
          <Alert message={`将发布 ${savedQuestions.length} 道题目`} type="info" showIcon style={{ borderRadius: 8, fontSize: 12 }} />
        </Form>
      </Modal>

      {/* 历史记录弹窗 */}
      <Modal title="批改历史记录" open={historyVisible} onCancel={() => setHistoryVisible(false)} footer={null} width={800}>
        {historyLoading ? <Spin style={{ display: 'block', padding: 40, textAlign: 'center' }} /> :
         historyRecords.length === 0 ? <Empty description="暂无批改记录" /> : (
          <div>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>共 {historyRecords.length} 条记录</Text>
              <Space>
                {historySelectedKeys.length > 0 && (
                  <Popconfirm title={`删除选中的 ${historySelectedKeys.length} 条记录？`} onConfirm={async () => {
                    for (const id of historySelectedKeys) {
                      try { await homeworkApi.deleteGrade(String(id)); } catch {}
                    }
                    message.success(`已删除 ${historySelectedKeys.length} 条记录`);
                    setHistorySelectedKeys([]);
                    loadHistoryRecords();
                  }} okText="删除" cancelText="取消">
                    <Button danger size="small" style={{ borderRadius: 6 }}>批量删除 ({historySelectedKeys.length})</Button>
                  </Popconfirm>
                )}
                <Popconfirm
                  title="确定要删除全部批改记录吗？此操作不可撤销。"
                  onConfirm={async () => {
                    const ids = historyRecords.map((r: any) => r.id);
                    for (const id of ids) {
                      try { await homeworkApi.deleteGrade(String(id)); } catch {}
                    }
                    message.success(`已删除 ${ids.length} 条记录`);
                    setHistorySelectedKeys([]);
                    loadHistoryRecords();
                  }}
                  okText="确认删除" cancelText="取消"
                  disabled={historyRecords.length === 0}
                >
                  <Button danger size="small" style={{ borderRadius: 6 }} disabled={historyRecords.length === 0}>删除全部</Button>
                </Popconfirm>
                <Button size="small" icon={<ReloadOutlined />} onClick={loadHistoryRecords} style={{ borderRadius: 6 }}>刷新</Button>
              </Space>
            </div>
            <Table
              dataSource={historyRecords}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 8 }}
              rowSelection={{
                selectedRowKeys: historySelectedKeys,
                onChange: (keys) => setHistorySelectedKeys(keys),
              }}
              columns={[
                { title: '文件名', dataIndex: 'source_file', width: 120, render: (v: string) => v ? <Tag style={{ borderRadius: 6, fontSize: 11 }}>{v.length > 15 ? v.slice(0, 14) + '…' : v}</Tag> : <Text type="secondary">-</Text> },
                { title: '学生', dataIndex: 'student_name', width: 80 },
                { title: '课程', dataIndex: 'course_name', width: 100, ellipsis: true },
                { title: '得分', dataIndex: 'score', width: 80, render: (v: number, r: any) => <Text strong style={{ color: (r.percentage || 0) >= 60 ? BRAND.colors.green : BRAND.colors.error }}>{v} / {r.max_score || 100}</Text> },
                { title: '题型', dataIndex: 'question_type', width: 70 },
                { title: '时间', dataIndex: 'created_at', width: 130, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-' },
                { title: '操作', width: 80, render: (_: any, r: any) => (
                  <Popconfirm title="删除此记录？" onConfirm={async () => {
                    try { await homeworkApi.deleteGrade(r.id); message.success('已删除'); loadHistoryRecords(); }
                    catch { message.error('删除失败'); }
                  }} okText="删除" cancelText="取消">
                    <Button type="link" danger size="small" icon={<DeleteOutlined />} style={{ fontSize: 11 }}>删除</Button>
                  </Popconfirm>
                )},
              ]}
            />
          </div>
        )}
      </Modal>

      {/* 品牌水印 */}
      <div className="brand-watermark">Edu-TA 教学数据 · 批改可追溯</div>

      {/* API Key 弹窗 */}
      <ApiKeyGuardModal visible={guard.modalVisible} onClose={guard.hideGuard} onGoSettings={guard.goToSettings} />
      <SettingsModal open={guard.settingsVisible} onClose={() => guard.setSettingsVisible(false)} />
    </div>
  );
};

export default HomeworkGrading;
