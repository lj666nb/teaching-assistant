/**
 * LLM 供应商配置 — 浏览器本地存储（多模型版）。
 *
 * 每个供应商可配置多条模型，每条模型独立 API Key + model name。
 * 兼容迁移旧版单模型配置。
 */

export interface ModelItem {
  id: string;
  name: string;
  api_key: string;
  model_name: string;
  is_default: boolean;
  test_status?: 'untested' | 'success' | 'fail';
  test_message?: string;
}

export interface ProviderWithModels {
  id: string;
  name: string;
  base_url: string;
  models: ModelItem[];
}

const STORAGE_KEY = 'edu_ta_providers_v2';
const ACTIVE_KEY = 'edu_ta_active_provider';
const OLD_STORAGE_KEY = 'edu_ta_providers';

/** 生成简短唯一 ID */
export function genId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** 兼容迁移：将旧版单模型配置升级为多模型格式 */
function migrateOldConfig(): void {
  try {
    const oldData = localStorage.getItem(OLD_STORAGE_KEY);
    if (!oldData) return;
    const oldProviders = JSON.parse(oldData);
    if (!Array.isArray(oldProviders) || oldProviders.length === 0) return;
    // 检查是否已有新版数据
    const newData = localStorage.getItem(STORAGE_KEY);
    if (newData) return; // 已迁移过

    const migrated: ProviderWithModels[] = oldProviders.map((old: any) => ({
      id: old.id || genId(),
      name: old.name || '迁移配置',
      base_url: old.base_url || 'https://api.openai.com/v1',
      models: [{
        id: genId(),
        name: old.model_name || 'default',
        api_key: old.api_key || '',
        model_name: old.model_name || 'gpt-4o-mini',
        is_default: true,
        test_status: 'untested' as const,
      }],
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    // 迁移激活ID
    const oldActive = localStorage.getItem(OLD_STORAGE_KEY + '_active');
    if (oldActive) {
      // 旧 active 存的是 provider id，直接复用
    }
    localStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    // 迁移失败忽略
  }
}

/** 获取所有供应商 */
export function getProviders(): ProviderWithModels[] {
  migrateOldConfig();
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

/** 保存供应商 */
export function saveProvider(p: ProviderWithModels): void {
  const providers = getProviders();
  const idx = providers.findIndex(x => x.id === p.id);
  if (idx >= 0) providers[idx] = p;
  else providers.push(p);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
}

/** 删除供应商 */
export function deleteProvider(id: string): void {
  const providers = getProviders().filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
  if (getActiveProviderId() === id) localStorage.removeItem(ACTIVE_KEY);
}

export function getActiveProviderId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveProviderId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

/** 获取当前激活供应商的默认模型 */
export function getActiveModel(): { provider: ProviderWithModels; model: ModelItem } | null {
  const id = getActiveProviderId();
  if (!id) return null;
  const provider = getProviders().find(p => p.id === id);
  if (!provider) return null;
  const model = provider.models.find(m => m.is_default) || provider.models[0];
  if (!model) return null;
  return { provider, model };
}

export function clearAll(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(ACTIVE_KEY);
}

// ════════════════════════════════════════════════════════
// 三层全局状态（核心）
// ════════════════════════════════════════════════════════

/**
 * LLM 全局状态
 * - state=1: 空配置（供应商总数=0）
 * - state=2: 存在供应商，但无全局激活服务商
 * - state=3: 存在全局激活服务商
 */
export interface LLMStatus {
  state: 1 | 2 | 3;
  providerCount: number;
  hasActive: boolean;
  activeModel: { provider: ProviderWithModels; model: ModelItem } | null;
  /** 激活模型是否已测试 */
  activeTested: boolean;
  /** 激活模型测试是否连通成功 */
  activeTestOk: boolean;
}

/** 获取三层全局状态 */
export function getLLMStatus(): LLMStatus {
  const providers = getProviders();
  const activeId = getActiveProviderId();
  const providerCount = providers.length;

  // 状态1：空配置
  if (providerCount === 0) {
    return { state: 1, providerCount: 0, hasActive: false, activeModel: null, activeTested: false, activeTestOk: false };
  }

  // 状态2：有供应商，但无全局激活
  const hasActive = !!activeId && providers.some(p => p.id === activeId);
  if (!hasActive) {
    return { state: 2, providerCount, hasActive: false, activeModel: null, activeTested: false, activeTestOk: false };
  }

  // 状态2B：有激活 ID 但找不到对应模型
  const activeModel = getActiveModel();
  if (!activeModel) {
    return { state: 2, providerCount, hasActive: true, activeModel: null, activeTested: false, activeTestOk: false };
  }

  // 状态2C：有激活厂商但模型明确测试失败
  const activeTested = activeModel.model.test_status !== 'untested';
  const activeTestOk = activeModel.model.test_status === 'success';
  const activeTestFail = activeModel.model.test_status === 'fail';

  if (activeTestFail) {
    return { state: 2, providerCount, hasActive: true, activeModel, activeTested: true, activeTestOk: false };
  }

  // 状态3：全局激活 + (测试连通成功 或 尚未测试)
  // 未测试的模型也允许使用，实际连通性在使用时由后端验证
  return { state: 3, providerCount, hasActive: true, activeModel, activeTested, activeTestOk: activeTestOk };
}
