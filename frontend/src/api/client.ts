/**
 * API 客户端 — 封装所有后端接口调用。
 *
 * 自动从 localStorage 读取 LLM 供应商配置，
 * 以 HTTP 头形式发送给后端，实现「每人独立配置」。
 */

import axios from 'axios';
import { getActiveModel } from '../utils/providerStorage';
import { API_BASE_URL, apiUrl } from './base';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,  // LLM 生成可能较慢
  headers: { 'Content-Type': 'application/json' },
});

// ── 自动携带 LLM 配置（多模型版） ─────────────────────
// 每次请求自动携带当前激活供应商的默认模型配置
api.interceptors.request.use((config) => {
  const active = getActiveModel();
  if (active) {
    config.headers['X-LLM-Api-Key'] = active.model.api_key;
    config.headers['X-LLM-Base-Url'] = active.provider.base_url;
    config.headers['X-LLM-Model-Name'] = active.model.model_name;
  }
  return config;
});

// ── 智能备课 ──────────────────────────────────────────

export interface LessonPlanRequest {
  course_name: string;
  chapter: string;
  textbook_content?: string;
  teaching_hours?: number;
  additional_requirements?: string;
}

export const lessonApi = {
  generate: (data: LessonPlanRequest) => api.post('/lesson/generate', data, { timeout: 300000 }),
  list: (course?: string) => api.get('/lesson/plans', { params: { course } }).then(res => {
    // 兼容新旧格式：APIResponse.data.plans 或 旧 LessonPlanListResponse.plans
    if (res.data?.data?.plans) {
      return { data: { ...res.data, plans: res.data.data.plans, total: res.data.data.total } };
    }
    return res;
  }),
  get: (id: string) => api.get(`/lesson/plans/${id}`),
  /** 更新已生成的教案 */
  update: (id: string, data: any) => api.put(`/lesson/plans/${id}`, data),
  delete: (id: string) => api.delete(`/lesson/plans/${id}`),
  /** 导出完整教案为 Word */
  exportWord: (plan: any) => api.post('/lesson/export-word', { plan }, { responseType: 'blob' }),
  /** 导出单个教学流程为 Word */
  exportSegmentWord: (session: any, courseName: string, chapter: string) =>
    api.post('/lesson/export-segment-word', { session, course_name: courseName, chapter }, { responseType: 'blob' }),
};

// ── 作业批改 ──────────────────────────────────────────

export interface HomeworkSubmission {
  student_name: string;
  course_name: string;
  chapter?: string;
  question_text: string;
  student_answer: string;
  reference_answer?: string;
  question_type?: string;
  max_score?: number;
}

export interface ExerciseRequest {
  course_name: string;
  chapter?: string;
  knowledge_points: string[];
  difficulty?: string;
  count?: number;
  types?: string[];
}

export const homeworkApi = {
  grade: (data: HomeworkSubmission) => api.post('/homework/grade', data),
  batchGrade: (submissions: HomeworkSubmission[]) =>
    api.post('/homework/batch-grade', { submissions }),
  generateExercises: (data: ExerciseRequest) =>
    api.post('/homework/exercises', data),
  /** 上传单个 PDF/Word 文件，后端负责文本提取 + 批改 */
  uploadFile: (file: File, course = '', parseOnly = false) => {
    const form = new FormData();
    form.append('file', file);
    form.append('course', course);
    form.append('parse_only', String(parseOnly));
    return api.post('/homework/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
  },
  /** 将练习题导出为 Word 文档 */
  exportExercisesWord: (data: { exercises: any[]; course_name: string; chapter?: string }) =>
    api.post('/homework/exercises/export-word', data, { responseType: 'blob' }),
  /** 获取已批改的历史记录列表 */
  listGrades: (course?: string, archived?: boolean) => api.get('/homework/grades', { params: { course: course || '', ...(archived !== undefined ? { archived } : {}) } }),
  /** 将批改结果归档至教学台账 */
  archiveResults: (results: any[]) => api.post('/homework/archive', { results }),
  /** 删除批改记录 */
  deleteGrade: (id: string) => api.delete(`/homework/grades/${id}`),
	  listBatches: (course?: string) => api.get('/homework/batches', { params: { course: course || '' } }),
	  getBatch: (batchId: string) => api.get(`/homework/batches/${batchId}`),
	  deleteBatch: (batchId: string) => api.delete(`/homework/batches/${batchId}`),
  /** 批量上传 PDF/Word 文件，后端负责文本提取 + 批改 */
  uploadFiles: (files: File[], course = '') => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    form.append('course', course);
    return api.post('/homework/batch-upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
    });
  },
};

// ── 学情洞察 ──────────────────────────────────────────

export interface PerformanceRecord {
  date?: string;
  exam_name?: string;
  score: number;
  total_score?: number;
  category?: string;
}

export interface StudentInsightRequest {
  student_id: string;
  student_name?: string;
  course_name: string;
  records?: PerformanceRecord[];
}

export const insightApi = {
  analyzeStudent: (data: StudentInsightRequest) =>
    api.post('/insight/student', data),
  analyzeClass: (students: StudentInsightRequest[]) =>
    api.post('/insight/class', { course_name: students[0]?.course_name || '', students }),
  /** 获取学情分析历史记录 */
  listReports: () => api.get('/insight/reports'),
  /** 删除学情报告 */
  deleteReport: (id: string) => api.delete(`/insight/reports/${id}`),
};

// ── 知识库 ────────────────────────────────────────────

export const knowledgeApi = {
  search: (query: string, course_name = '', top_k = 5) =>
    api.post('/knowledge/search', { query, course_name, top_k }),
  upload: (file: File, course = 'default', chapter = '') => {
    const form = new FormData();
    form.append('file', file);
    form.append('course', course);
    form.append('chapter', chapter);
    return api.post('/knowledge/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  status: () => api.get('/knowledge/status', { timeout: 30000 }),
  collections: () => api.get('/knowledge/collections', { timeout: 30000 }),
  deleteCollection: (course: string) => api.delete(`/knowledge/collections/${course}`, { timeout: 30000 }),
  getCollectionContent: (course: string, limit = 200) =>
    api.get(`/knowledge/collections/${course}/content`, { params: { limit }, timeout: 30000 }),
  /** 获取所有课程列表 */
  listCourses: () => api.get('/knowledge/courses'),
  /** 获取指定课程的章节列表 */
  listChapters: (course: string) => api.get('/knowledge/chapters', { params: { course } }),
  /** 获取指定课程/章节的知识点列表 */
  listKnowledgePoints: (course: string, chapter?: string) =>
    api.get('/knowledge/knowledge-points', { params: { course, chapter: chapter || '' } }),
};

// ── 教学资料与题库 ─────────────────────────────────────

export const materialApi = {
  /** 上传PDF教学资料 */
  upload: (file: File, course = '', chapter = '') => {
    const form = new FormData();
    form.append('file', file);
    form.append('course', course);
    form.append('chapter', chapter);
    return api.post('/materials/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  /** 批量上传多个教学资料 */
  uploadBatch: (files: File[], course = '', chapter = '') => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    form.append('course', course);
    form.append('chapter', chapter);
    return api.post('/materials/upload-batch', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
    });
  },
  /** 资料列表 */
  list: (course = '') => api.get('/materials/list', { params: { course } }),
  /** 资料详情 */
  detail: (id: string) => api.get(`/materials/detail/${id}`),
  /** 删除资料 */
  delete: (id: string) => api.delete(`/materials/delete/${id}`),
  /** AI 生成题目 */
  generateQuestions: (materialId: string, count = 5, difficulty = '中等', types = ['选择题', '填空题', '简答题']) =>
    api.post('/materials/generate-questions', { material_id: materialId, count, difficulty, types }),
  /** 下载文件 */
  download: (materialId: string) => apiUrl(`materials/download/${materialId}`),
  /** 插入备课 — 从资源创建教案记录 */
  toLesson: (materialId: string) => api.post(`/materials/${materialId}/to-lesson`),
  /** 题目列表 */
  listQuestions: (materialId = '', status = '', course = '') =>
    api.get('/materials/questions', { params: { material_id: materialId, status, course } }),
  /** 更新题目 */
  updateQuestion: (data: any) => api.post('/materials/questions/update', data),
  /** 发布题目 */
  publish: (questionIds: string[], course: string, title: string, deadline = '') =>
    api.post('/materials/publish', { question_ids: questionIds, course, title, deadline }),
  /** 已发布列表 */
  listPublished: () => api.get('/materials/publish/list'),
  /** 撤销发布 */
  unpublish: (publishId: string) => api.post('/materials/questions/unpublish', { publish_id: publishId }),
  /** 获取已发布题目详情 */
  getPublishedQuestions: (publishId: string) => api.get(`/materials/publish/${publishId}/questions`),
  /** 导出题目为 Word */
  exportWord: (questionIds: string[], title: string) => api.post('/materials/questions/export-word', { question_ids: questionIds, title }),
  /** 将出题助手生成的练习题保存到题库 */
  saveExercises: (courseName: string, chapter: string, exercises: any[]) =>
    api.post('/materials/save-exercises', { course_name: courseName, chapter, exercises }),
  /** 清空孤立题目 / 全部草稿题目 */
  clearOrphanedQuestions: (allDrafts = false) => api.post('/materials/questions/clear-orphaned', { all_drafts: allDrafts }),
};

// ── 消息通知 ─────────────────────────────────────────

export const notificationApi = {
  list: () => api.get('/notifications/list'),
  readAll: () => api.post('/notifications/read-all'),
  markRead: (id: string) => api.put(`/notifications/${id}/read`),
  delete: (id: string) => api.delete(`/notifications/${id}`),
  batchDelete: (ids: string[]) => api.post('/notifications/batch-delete', { ids }),
};

// ── 系统设置（多供应商） ───────────────────────────────

export interface ProviderConfig {
  id?: string;
  name: string;
  api_key?: string;
  base_url: string;
  model_name: string;
  is_active?: boolean;
}

export const settingsApi = {
  /** 获取所有供应商配置 */
  listProviders: () => api.get('/settings/providers'),
  /** 新增供应商 */
  addProvider: (data: ProviderConfig) => api.post('/settings/providers', data),
  /** 更新供应商 */
  updateProvider: (id: string, data: Partial<ProviderConfig>) => api.put(`/settings/providers/${id}`, data),
  /** 删除供应商 */
  deleteProvider: (id: string) => api.delete(`/settings/providers/${id}`),
  /** 切换激活 */
  activateProvider: (id: string) => api.post(`/settings/providers/${id}/activate`),
  /** 获取当前激活的供应商 */
  getActive: () => api.get('/settings/active'),
  /** 测试连接 */
  test: (data?: Partial<ProviderConfig>) => api.post('/settings/test', data || {}),
};

// ── 课程管理 ─────────────────────────────────────────

export const courseMgmtApi = {
  /** 获取枚举配置 */
  getEnums: () => api.get('/course-mgmt/enums'),
  /** 获取教师列表 */
  listTeachers: () => api.get('/course-mgmt/teachers'),
  /** 新增教师 */
  addTeacher: (name: string, title?: string) => api.post('/course-mgmt/teachers', { name, title }),
  /** 删除教师 */
  deleteTeacher: (id: string) => api.delete(`/course-mgmt/teachers/${id}`),
  /** 课程列表 */
  listCourses: (semester?: string) => api.get('/course-mgmt/courses', { params: { semester } }),
  /** 课程详情 */
  getCourse: (id: string) => api.get(`/course-mgmt/courses/${id}`),
  /** 新增课程 */
  createCourse: (data: any) => api.post('/course-mgmt/courses', data),
  /** 更新课程 */
  updateCourse: (id: string, data: any) => api.put(`/course-mgmt/courses/${id}`, data),
  /** 删除课程 */
  deleteCourse: (id: string) => api.delete(`/course-mgmt/courses/${id}`),
  /** 新增课时 */
  addSession: (id: string) => api.post(`/course-mgmt/courses/${id}/add-session`),
  listSessions: (cid: string) => api.get(`/course-mgmt/courses/${cid}/sessions`),
  createSession: (cid: string, data: any) => api.post(`/course-mgmt/courses/${cid}/sessions`, data),
  updateSession: (cid: string, sid: string, data: any) => api.put(`/course-mgmt/courses/${cid}/sessions/${sid}`, data),
  deleteSession: (cid: string, sid: string) => api.delete(`/course-mgmt/courses/${cid}/sessions/${sid}`),
  batchSessions: (cid: string, items: any[]) => api.post(`/course-mgmt/courses/${cid}/sessions/batch`, { items }),
  listStudents: (cid: string, search = '') => api.get(`/course-mgmt/courses/${cid}/students`, { params: { search } }),
  addStudent: (cid: string, data: { name: string; student_id: string; class_name?: string }) => api.post(`/course-mgmt/courses/${cid}/students`, data),
  removeStudent: (cid: string, sid: string) => api.delete(`/course-mgmt/courses/${cid}/students/${sid}`),
  /** 导出课程列表为 Word */
  exportCourses: (courseIds: string[]) => api.post('/course-mgmt/export', { course_ids: courseIds }, { responseType: 'blob' }),
};

// ── 成绩管理（统一数据源） ─────────────────────────

export const gradeApi = {
  /** 课程成绩统计（Dashboard / 学情分析 / 成绩管理共用） */
  stats: () => api.get('/grades/stats'),
  /** 成绩列表 */
  list: (course?: string, search?: string) => api.get('/grades/list', { params: { course: course || '', search: search || '' } }),
  /** 手动添加/归档成绩 */
  add: (data: any) => api.post('/grades/add', data),
  /** 删除单条成绩 */
  delete: (id: string) => api.delete(`/grades/${id}`),
  /** 批量删除成绩 */
  batchDelete: (ids: string[]) => api.post('/grades/batch-delete', { ids }),
  /** 删除班级全部成绩 */
  deleteClass: (course: string, className: string) => api.delete('/grades/class', { params: { course, class_name: className } }),
  /** 知识薄弱点 */
  weakPoints: (course?: string) => api.get('/grades/weak-points', { params: { course: course || '' } }),
  /** 学生列表（含知识点掌握情况） */
  students: (course?: string) => api.get('/grades/students', { params: { course: course || '' } }),
};

// ── 审计日志 ─────────────────────────────────────────

export const auditApi = {
  /** 查询审计日志 */
  query: (params?: { plan_id?: string; operator?: string; operation?: string; course?: string; sort_order?: string; role?: string; limit?: number }) =>
    api.get('/audit/logs', { params }),
  /** 清空所有审计日志 */
  clear: () => api.delete('/audit/logs'),
  /** 审计统计 */
  stats: () => api.get('/audit/stats'),
  /** 版本快照列表 */
  snapshots: (planId: string) => api.get(`/audit/snapshots/${planId}`),
  /** 删除版本快照 */
  deleteSnapshot: (planId: string, version: number) => api.delete(`/audit/snapshots/${planId}/${version}`),
  /** 还原版本 */
  restore: (planId: string, version: number, operator: string = '教师') =>
    api.post(`/audit/snapshots/${planId}/restore/${version}`, null, { params: { operator } }),
  /** 版本对比 */
  compare: (planId: string, v1?: number, v2?: number) =>
    api.get(`/audit/compare/${planId}`, { params: { v1: v1 || 0, v2: v2 || 0 } }),
  /** 导出日志 */
  export: (format: 'excel' | 'word' = 'excel', planId?: string) =>
    api.get('/audit/export', { params: { format, plan_id: planId || '' }, responseType: 'blob' }),
};

// ── 通用资源导出 ───────────────────────────────────────

export const resourcesApi = {
  /** 通用 Word 导出 — 接受 title + content 文本，返回 .docx blob */
  exportWord: (data: { title: string; content: string; filename?: string }) =>
    api.post('/resources/export-word', data, { responseType: 'blob' }),
};

// ── Agent 编排 ─────────────────────────────────────────

export const agentApi = {
  /** 获取预置工作流类型列表 */
  listTypes: () => api.get('/agent/workflows/types'),
  /** 启动工作流 */
  startWorkflow: (workflow_type: string, params: Record<string, any>) =>
    api.post('/agent/workflow/start', { workflow_type, params }),
  /** SSE 实时进度 */
  progressUrl: (workflowId: string) => `${api.defaults.baseURL}/agent/workflow/${workflowId}/progress`,
  /** 获取工作流结果 */
  getResult: (workflowId: string) => api.get(`/agent/workflow/${workflowId}/result`),
  /** 历史列表 */
  listHistory: (limit = 50) => api.get('/agent/workflows', { params: { limit } }),
  /** 删除记录 */
  delete: (workflowId: string) => api.delete(`/agent/workflow/${workflowId}`),
};

export default api;
