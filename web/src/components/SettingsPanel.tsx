import { useState, useEffect, useCallback } from 'react'
import {
  Search, X, Palette, Bot, Sliders, Keyboard, Puzzle, Info,
  ChevronRight, Plus, Pencil, Trash2, ExternalLink
} from 'lucide-react'
import { sendRpc } from '../store/ws'

// ─── Types ───
export type Lang = 'zh' | 'en'
export type Theme = 'dark' | 'light' | 'auto'

export interface CustomProviderInfo {
  name: string
  protocol?: string
  sdk?: string
  baseUrl?: string
  hasApiKey: boolean
  models: string[]
}

interface SettingsSection {
  id: string
  icon: React.ReactNode
  label: string
  description: string
}

// ─── Translations ───
const translations: Record<Lang, Record<string, string>> = {
  zh: {
    settings: '设置',
    search: '搜索设置...',
    general: '通用',
    generalDesc: '语言、主题、界面显示等基础配置',
    model: '模型',
    modelDesc: 'AI 模型选择与参数微调',
    appearance: '外观',
    appearanceDesc: '字体、布局、显示效果',
    keybindings: '快捷键',
    keybindingsDesc: '键盘快捷键配置',
    mcp: 'MCP & 扩展',
    mcpDesc: 'MCP 服务器管理与扩展配置',
    about: '关于',
    aboutDesc: '版本信息与相关链接',
    language: '语言',
    theme: '主题',
    dark: '深色',
    light: '浅色',
    auto: '跟随系统',
    fontSize: '字体大小',
    compactMessages: '紧凑消息',
    showReasoning: '显示思考过程',
    standard: '标准',
    readOnly: '只读',
    toolPolicy: '工具策略',
    standardMode: '标准模式：所有工具均可执行',
    readOnlyMode: '只读模式：修改类工具被阻止，仅允许安全读取操作',
    // Model
    activeModel: '当前模型',
    customApi: '自定义 API',
    addProvider: '添加 Provider',
    editProvider: '编辑',
    deleteProvider: '删除',
    providerName: 'Provider 名称',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    models: '模型列表',
    modelsPlaceholder: '用逗号分隔多个模型',
    cancel: '取消',
    save: '保存',
    // Fine-tune
    temperature: 'Temperature',
    temperatureDesc: '控制输出的随机性',
    maxTokens: 'Max Tokens',
    maxTokensDesc: '单次响应的最大 token 数',
    topP: 'Top-P',
    topPDesc: '核采样概率阈值',
    conservative: '精确',
    balanced: '平衡',
    creative: '创意',
    // About
    version: '版本',
    homepage: '项目主页',
    documentation: '文档',
  },
  en: {
    settings: 'Settings',
    search: 'Search settings...',
    general: 'General',
    generalDesc: 'Language, theme, and basic preferences',
    model: 'Models',
    modelDesc: 'AI model selection and fine-tuning',
    appearance: 'Appearance',
    appearanceDesc: 'Font, layout, and display options',
    keybindings: 'Keybindings',
    keybindingsDesc: 'Keyboard shortcuts configuration',
    mcp: 'MCP & Extensions',
    mcpDesc: 'MCP server management and extensions',
    about: 'About',
    aboutDesc: 'Version info and related links',
    language: 'Language',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    auto: 'Auto',
    fontSize: 'Font Size',
    compactMessages: 'Compact Messages',
    showReasoning: 'Show Reasoning Process',
    standard: 'Standard',
    readOnly: 'Read-Only',
    toolPolicy: 'Tool Policy',
    standardMode: 'Standard mode: All tools are available for execution',
    readOnlyMode: 'Read-only mode: Modifying tools are blocked. Only safe read operations are allowed.',
    // Model
    activeModel: 'Active Model',
    customApi: 'Custom API',
    addProvider: 'Add Provider',
    editProvider: 'Edit',
    deleteProvider: 'Delete',
    providerName: 'Provider Name',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    models: 'Models',
    modelsPlaceholder: 'Comma-separated list of models',
    cancel: 'Cancel',
    save: 'Save',
    // Fine-tune
    temperature: 'Temperature',
    temperatureDesc: 'Controls randomness of output',
    maxTokens: 'Max Tokens',
    maxTokensDesc: 'Maximum tokens per response',
    topP: 'Top-P',
    topPDesc: 'Nucleus sampling probability threshold',
    conservative: 'Precise',
    balanced: 'Balanced',
    creative: 'Creative',
    // About
    version: 'Version',
    homepage: 'Homepage',
    documentation: 'Documentation',
  },
}

// ─── Toggle Component ───
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
    </label>
  )
}

// ─── Slider Component ───
function Slider({
  value, min, max, step = 1,
  onChange, label, valueLabel,
  hints
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  label: string
  valueLabel: string
  hints?: { left: string; right?: string; center?: string }
}) {
  return (
    <div className="settings-slider">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(typeof step === 'number' && step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
      />
      {hints && (
        <div className="slider-hints">
          <span>{hints.left}</span>
          {hints.center && <span>{hints.center}</span>}
          {hints.right && <span>{hints.right}</span>}
        </div>
      )}
    </div>
  )
}

// ─── Main Settings Component ───
export function SettingsPanel({
  lang, setLang,
  theme, setTheme,
  fontSize, setFontSize,
  compactMessages, setCompactMessages,
  showReasoning, setShowReasoning,
  modelProviders, modelLoading, activeModel, onModelSelect,
  fineTuneTemp, setFineTuneTemp,
  fineTuneMaxTokens, setFineTuneMaxTokens,
  fineTuneTopP, setFineTuneTopP,
  onClose,
  onRefreshModels,
}: {
  lang: Lang
  setLang: (l: Lang) => void
  theme: Theme
  setTheme: (t: Theme) => void
  fontSize: number
  setFontSize: (s: number) => void
  compactMessages: boolean
  setCompactMessages: (c: boolean) => void
  showReasoning: boolean
  setShowReasoning: (s: boolean) => void
  modelProviders: Record<string, { protocol: string; models: string[] }>
  modelLoading: boolean
  activeModel: string
  onModelSelect: (modelId: string) => void
  fineTuneTemp: number
  setFineTuneTemp: (v: number) => void
  fineTuneMaxTokens: number
  setFineTuneMaxTokens: (v: number) => void
  fineTuneTopP: number
  setFineTuneTopP: (v: number) => void
  onClose: () => void
  onRefreshModels: () => void
}) {
  const [activeSection, setActiveSection] = useState('general')
  const [searchQuery, setSearchQuery] = useState('')

  const t = useCallback((key: string): string => {
    return translations[lang]?.[key] || key
  }, [lang])

  const sections: SettingsSection[] = [
    { id: 'general', icon: <Sliders size={18} />, label: t('general'), description: t('generalDesc') },
    { id: 'model', icon: <Bot size={18} />, label: t('model'), description: t('modelDesc') },
    { id: 'appearance', icon: <Palette size={18} />, label: t('appearance'), description: t('appearanceDesc') },
    { id: 'keybindings', icon: <Keyboard size={18} />, label: t('keybindings'), description: t('keybindingsDesc') },
    { id: 'mcp', icon: <Puzzle size={18} />, label: t('mcp'), description: t('mcpDesc') },
    { id: 'about', icon: <Info size={18} />, label: t('about'), description: t('aboutDesc') },
  ]

  const handleLangSwitch = (l: Lang) => {
    setLang(l)
    localStorage.setItem('meshy-lang', l)
  }

  const handleThemeSwitch = (t: Theme) => {
    setTheme(t)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-header">
          <div className="settings-title">
            <span className="settings-icon">⚙️</span>
            <span>{t('settings')}</span>
          </div>
          <button className="settings-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-body">
          {/* Sidebar */}
          <nav className="settings-sidebar">
            {/* Search */}
            <div className="settings-search">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder={t('search')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="search-clear" onClick={() => setSearchQuery('')}>
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Navigation */}
            <div className="settings-nav">
              {sections.map(section => (
                <button
                  key={section.id}
                  className={`nav-item ${activeSection === section.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(section.id)}
                >
                  <span className="nav-icon">{section.icon}</span>
                  <span className="nav-label">{section.label}</span>
                  <ChevronRight size={14} className="nav-arrow" />
                </button>
              ))}
            </div>
          </nav>

          {/* Content */}
          <div className="settings-content">
            <div className="settings-section-header">
              <h2>{sections.find(s => s.id === activeSection)?.label}</h2>
              <p>{sections.find(s => s.id === activeSection)?.description}</p>
            </div>

            <div className="settings-section-content">
              {/* General */}
              {activeSection === 'general' && (
                <GeneralSection
                  lang={lang} onLangSwitch={handleLangSwitch}
                  theme={theme} onThemeSwitch={handleThemeSwitch}
                  t={t}
                />
              )}

              {/* Model */}
              {activeSection === 'model' && (
                <ModelSection
                  modelProviders={modelProviders}
                  modelLoading={modelLoading}
                  activeModel={activeModel}
                  onModelSelect={onModelSelect}
                  fineTuneTemp={fineTuneTemp} setFineTuneTemp={setFineTuneTemp}
                  fineTuneMaxTokens={fineTuneMaxTokens} setFineTuneMaxTokens={setFineTuneMaxTokens}
                  fineTuneTopP={fineTuneTopP} setFineTuneTopP={setFineTuneTopP}
                  t={t}
                  onRefreshModels={onRefreshModels}
                />
              )}

              {/* Appearance */}
              {activeSection === 'appearance' && (
                <AppearanceSection
                  fontSize={fontSize} setFontSize={setFontSize}
                  compactMessages={compactMessages} setCompactMessages={setCompactMessages}
                  showReasoning={showReasoning} setShowReasoning={setShowReasoning}
                  t={t}
                />
              )}

              {/* Keybindings */}
              {activeSection === 'keybindings' && (
                <KeybindingsSection />
              )}

              {/* MCP */}
              {activeSection === 'mcp' && (
                <MCPSection />
              )}

              {/* About */}
              {activeSection === 'about' && (
                <AboutSection t={t} lang={lang} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── General Section ───
function GeneralSection({
  lang, onLangSwitch,
  theme, onThemeSwitch,
  t,
}: {
  lang: Lang
  onLangSwitch: (l: Lang) => void
  theme: Theme
  onThemeSwitch: (t: Theme) => void
  t: (k: string) => string
}) {
  const [policyMode, setPolicyMode] = useState<'standard' | 'read_only'>('standard')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    sendRpc<{ mode: string }>('tool:policy:get')
      .then(res => {
        if (res?.mode === 'read_only' || res?.mode === 'standard') {
          setPolicyMode(res.mode)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleTogglePolicy = async () => {
    const newMode = policyMode === 'standard' ? 'read_only' : 'standard'
    const res = await sendRpc<{ success: boolean; mode?: string; error?: string }>('tool:policy:set', { mode: newMode })
    if (res?.success && res.mode) {
      setPolicyMode(res.mode as 'standard' | 'read_only')
    }
  }

  return (
    <div className="settings-group">
      {/* Language */}
      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">🌐</div>
          <div className="item-info">
            <label>{t('language')}</label>
            <p>{lang === 'zh' ? '选择界面显示语言' : 'Choose your preferred language'}</p>
          </div>
        </div>
        <div className="item-control">
          <div className="segment-control">
            <button
              className={`segment-btn ${lang === 'zh' ? 'active' : ''}`}
              onClick={() => onLangSwitch('zh')}
            >
              🇨🇳 中文
            </button>
            <button
              className={`segment-btn ${lang === 'en' ? 'active' : ''}`}
              onClick={() => onLangSwitch('en')}
            >
              🇺🇸 English
            </button>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">🎨</div>
          <div className="item-info">
            <label>{t('theme')}</label>
            <p>{lang === 'zh' ? '选择界面颜色方案' : 'Choose your color scheme'}</p>
          </div>
        </div>
        <div className="item-control">
          <div className="segment-control theme-seg">
            {(['dark', 'light', 'auto'] as Theme[]).map(th => (
              <button
                key={th}
                className={`segment-btn ${theme === th ? 'active' : ''}`}
                onClick={() => onThemeSwitch(th)}
              >
                {th === 'dark' ? '🌑' : th === 'light' ? '☀️' : '🔄'}
                {t(th)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tool Policy */}
      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">🔧</div>
          <div className="item-info">
            <label>{t('toolPolicy')}</label>
            <p>{policyMode === 'standard' ? t('standardMode') : t('readOnlyMode')}</p>
          </div>
        </div>
        <div className="item-control">
          {loading ? (
            <span className="loading-text">Loading...</span>
          ) : (
            <div className="policy-toggle">
              <span className={`policy-badge ${policyMode}`}>
                {policyMode === 'standard' ? '🔓 ' + t('standard') : '🔒 ' + t('readOnly')}
              </span>
              <Toggle checked={policyMode === 'read_only'} onChange={handleTogglePolicy} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Model Section ───
function ModelSection({
  modelProviders,
  modelLoading,
  activeModel,
  onModelSelect,
  fineTuneTemp, setFineTuneTemp,
  fineTuneMaxTokens, setFineTuneMaxTokens,
  fineTuneTopP, setFineTuneTopP,
  t,
  onRefreshModels,
}: {
  modelProviders: Record<string, { protocol: string; models: string[] }>
  modelLoading: boolean
  activeModel: string
  onModelSelect: (modelId: string) => void
  fineTuneTemp: number
  setFineTuneTemp: (v: number) => void
  fineTuneMaxTokens: number
  setFineTuneMaxTokens: (v: number) => void
  fineTuneTopP: number
  setFineTuneTopP: (v: number) => void
  t: (k: string) => string
  onRefreshModels: () => void
}) {
  const [customProviders, setCustomProviders] = useState<CustomProviderInfo[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formBaseUrl, setFormBaseUrl] = useState('')
  const [formApiKey, setFormApiKey] = useState('')
  const [formProtocol, setFormProtocol] = useState('openai')
  const [formSdk, setFormSdk] = useState('')
  const [formModels, setFormModels] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    sendRpc<{ providers: CustomProviderInfo[] }>('provider:list')
      .then(res => {
        if (res?.providers) setCustomProviders(res.providers)
      })
      .catch(() => {})
  }, [])

  const resetForm = () => {
    setFormName('')
    setFormBaseUrl('')
    setFormApiKey('')
    setFormProtocol('openai')
    setFormSdk('')
    setFormModels('')
    setEditingProvider(null)
    setShowAddForm(false)
    setFormError('')
  }

  const openAddForm = () => {
    resetForm()
    setShowAddForm(true)
  }

  const openEditForm = (p: CustomProviderInfo) => {
    setFormName(p.name)
    setFormBaseUrl(p.baseUrl || '')
    setFormApiKey('')
    setFormProtocol(p.protocol || 'openai')
    setFormSdk(p.sdk || '')
    setFormModels((p.models || []).join(', '))
    setEditingProvider(p.name)
    setShowAddForm(true)
    setFormError('')
  }

  const handleSaveProvider = async () => {
    setFormError('')
    if (!formName.trim()) {
      setFormError('Provider name is required.')
      return
    }
    if (!formBaseUrl.trim()) {
      setFormError('Base URL is required.')
      return
    }

    setFormBusy(true)
    try {
      const modelList = formModels.split(',').map(m => m.trim()).filter(Boolean)
      const isEditing = !!editingProvider
      const method = isEditing ? 'provider:update' : 'provider:add'
      const params: Record<string, any> = {
        name: formName.trim(),
        baseUrl: formBaseUrl.trim(),
        apiKey: formApiKey.trim(),
        protocol: formProtocol,
        models: modelList,
      }
      if (formSdk.trim()) params.sdk = formSdk.trim()

      if (isEditing && editingProvider !== formName.trim()) {
        await sendRpc('provider:remove', { name: editingProvider })
        const res = await sendRpc<{ success: boolean; error?: string }>('provider:add', params)
        if (!res.success) throw new Error(res.error)
      } else {
        const res = await sendRpc<{ success: boolean; error?: string }>(method, params)
        if (!res.success) throw new Error(res.error)
      }

      const listRes = await sendRpc<{ providers: CustomProviderInfo[] }>('provider:list')
      if (listRes?.providers) setCustomProviders(listRes.providers)
      resetForm()
      onRefreshModels()
    } catch (err: any) {
      setFormError(err.message || 'Failed to save provider.')
    } finally {
      setFormBusy(false)
    }
  }

  const handleDeleteProvider = async (name: string) => {
    if (!window.confirm(`Remove provider "${name}"?`)) return
    try {
      const res = await sendRpc<{ success: boolean; error?: string }>('provider:remove', { name })
      if (!res.success) throw new Error(res.error)
      setCustomProviders(prev => prev.filter(p => p.name !== name))
      onRefreshModels()
    } catch (err: any) {
      alert(`Failed: ${err.message}`)
    }
  }

  return (
    <div className="settings-group">
      {/* Active Model */}
      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">🤖</div>
          <div className="item-info">
            <label>{t('activeModel')}</label>
            <p>{t('modelDesc')}</p>
          </div>
        </div>
        <div className="item-control full-width">
          {modelLoading ? (
            <span className="loading-text">Loading...</span>
          ) : (
            <select
              value={activeModel}
              onChange={e => onModelSelect(e.target.value)}
              className="model-select"
            >
              {Object.entries(modelProviders).map(([providerName, group]) => (
                <optgroup key={providerName} label={`${providerName} (${group.protocol})`}>
                  {group.models.map(modelId => (
                    <option key={`${providerName}/${modelId}`} value={`${providerName}/${modelId}`}>
                      {modelId}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Fine-tune Parameters */}
      <div className="settings-group-title">
        <span>🌡️ {t('temperature').split(' ')[0]} 参数</span>
      </div>

      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">🌡️</div>
          <div className="item-info">
            <label>{t('temperature')}</label>
            <p>{t('temperatureDesc')}</p>
          </div>
        </div>
        <div className="item-control">
          <Slider
            value={fineTuneTemp}
            min={0}
            max={2}
            step={0.1}
            onChange={v => {
              setFineTuneTemp(v)
              sendRpc('model:fine-tune:set', { temperature: v }).catch(() => {})
            }}
            label=""
            valueLabel={fineTuneTemp.toFixed(1)}
            hints={{ left: t('conservative'), right: t('creative') }}
          />
        </div>
      </div>

      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">📏</div>
          <div className="item-info">
            <label>{t('maxTokens')}</label>
            <p>{t('maxTokensDesc')}</p>
          </div>
        </div>
        <div className="item-control">
          <Slider
            value={fineTuneMaxTokens}
            min={512}
            max={32768}
            step={512}
            onChange={v => {
              setFineTuneMaxTokens(v)
              sendRpc('model:fine-tune:set', { maxTokens: v }).catch(() => {})
            }}
            label=""
            valueLabel={fineTuneMaxTokens.toString()}
          />
        </div>
      </div>

      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">🎯</div>
          <div className="item-info">
            <label>{t('topP')}</label>
            <p>{t('topPDesc')}</p>
          </div>
        </div>
        <div className="item-control">
          <Slider
            value={fineTuneTopP}
            min={0.1}
            max={1}
            step={0.1}
            onChange={v => {
              setFineTuneTopP(v)
              sendRpc('model:fine-tune:set', { topP: v }).catch(() => {})
            }}
            label=""
            valueLabel={fineTuneTopP.toFixed(1)}
            hints={{ left: t('conservative'), right: t('creative') }}
          />
        </div>
      </div>

      {/* Custom API Providers */}
      <div className="settings-group-title">
        <span>🔌 {t('customApi')}</span>
        <button className="add-btn" onClick={openAddForm}>
          <Plus size={14} /> {t('addProvider')}
        </button>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="provider-form">
          <div className="form-row">
            <input
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder={t('providerName')}
              className="form-input"
            />
            <select
              value={formProtocol}
              onChange={e => setFormProtocol(e.target.value)}
              className="form-select"
            >
              <option value="openai">OpenAI</option>
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="deepseek">DeepSeek</option>
              <option value="__custom__">Custom SDK...</option>
            </select>
          </div>
          {formProtocol === '__custom__' && (
            <input
              value={formSdk}
              onChange={e => setFormSdk(e.target.value)}
              placeholder="SDK package name (e.g. @ai-sdk/anthropic)"
              className="form-input"
            />
          )}
          <input
            value={formBaseUrl}
            onChange={e => setFormBaseUrl(e.target.value)}
            placeholder={t('baseUrl') + ' (e.g. https://api.openai.com/v1)'}
            className="form-input"
          />
          <div className="form-row">
            <input
              value={formApiKey}
              onChange={e => setFormApiKey(e.target.value)}
              placeholder={editingProvider ? `${t('apiKey')} (leave blank to keep)` : t('apiKey')}
              type="password"
              className="form-input"
            />
            <input
              value={formModels}
              onChange={e => setFormModels(e.target.value)}
              placeholder={t('modelsPlaceholder')}
              className="form-input"
            />
          </div>
          {formError && <div className="form-error">{formError}</div>}
          <div className="form-actions">
            <button className="btn-cancel" onClick={resetForm}>{t('cancel')}</button>
            <button className="btn-save" onClick={handleSaveProvider} disabled={formBusy}>
              {formBusy ? 'Saving...' : editingProvider ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Provider List */}
      {customProviders.length > 0 && (
        <div className="provider-list">
          {customProviders.map(p => (
            <div key={p.name} className="provider-item">
              <div className="provider-info">
                <div className="provider-name">
                  {p.name}
                  <span className="provider-badge">{p.sdk || p.protocol || 'openai'}</span>
                  <span className={`api-key-badge ${p.hasApiKey ? 'has-key' : ''}`}>
                    {p.hasApiKey ? '🔑' : '🔓'}
                  </span>
                </div>
                {p.baseUrl && <div className="provider-url">{p.baseUrl}</div>}
              </div>
              <div className="provider-actions">
                <button className="icon-btn" onClick={() => openEditForm(p)} title={t('editProvider')}>
                  <Pencil size={14} />
                </button>
                <button className="icon-btn danger" onClick={() => handleDeleteProvider(p.name)} title={t('deleteProvider')}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {customProviders.length === 0 && !showAddForm && (
        <div className="empty-state">
          <p>No custom providers configured.</p>
          <button className="add-btn" onClick={openAddForm}>
            <Plus size={14} /> {t('addProvider')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Appearance Section ───
function AppearanceSection({
  fontSize, setFontSize,
  compactMessages, setCompactMessages,
  showReasoning, setShowReasoning,
  t,
}: {
  fontSize: number
  setFontSize: (s: number) => void
  compactMessages: boolean
  setCompactMessages: (c: boolean) => void
  showReasoning: boolean
  setShowReasoning: (s: boolean) => void
  t: (k: string) => string
}) {
  return (
    <div className="settings-group">
      {/* Font Size */}
      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">🔤</div>
          <div className="item-info">
            <label>{t('fontSize')}</label>
            <p>{fontSize}px</p>
          </div>
        </div>
        <div className="item-control">
          <Slider
            value={fontSize}
            min={12}
            max={20}
            step={1}
            onChange={setFontSize}
            label=""
            valueLabel={`${fontSize}px`}
          />
        </div>
      </div>

      {/* Compact Messages */}
      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">📦</div>
          <div className="item-info">
            <label>{t('compactMessages')}</label>
            <p>{compactMessages ? 'Less space between messages' : 'Normal spacing'}</p>
          </div>
        </div>
        <div className="item-control">
          <Toggle checked={compactMessages} onChange={() => setCompactMessages(!compactMessages)} />
        </div>
      </div>

      {/* Show Reasoning */}
      <div className="settings-item">
        <div className="item-header">
          <div className="item-icon">🧠</div>
          <div className="item-info">
            <label>{t('showReasoning')}</label>
            <p>{showReasoning ? 'Show AI thinking process' : 'Hide thinking process'}</p>
          </div>
        </div>
        <div className="item-control">
          <Toggle checked={showReasoning} onChange={() => setShowReasoning(!showReasoning)} />
        </div>
      </div>
    </div>
  )
}

// ─── Keybindings Section ───
function KeybindingsSection() {
  const keybindings = [
    { action: 'Send Message', shortcut: 'Ctrl + Enter' },
    { action: 'New Session', shortcut: 'Ctrl + Shift + N' },
    { action: 'Open Settings', shortcut: 'Ctrl + ,' },
    { action: 'Toggle Sidebar', shortcut: 'Ctrl + B' },
    { action: 'Search Sessions', shortcut: 'Ctrl + K' },
  ]

  return (
    <div className="settings-group">
      <div className="keybindings-list">
        {keybindings.map((kb, i) => (
          <div key={i} className="keybinding-item">
            <span className="keybind-action">{kb.action}</span>
            <div className="keybind-keys">
              {kb.shortcut.split(' + ').map((key, j) => (
                <kbd key={j}>{key}</kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="coming-soon-notice">
        <p>More customizable keybindings coming soon...</p>
      </div>
    </div>
  )
}

// ─── MCP Section ───
function MCPSection() {
  return (
    <div className="settings-group">
      <div className="mcp-placeholder">
        <Puzzle size={48} className="placeholder-icon" />
        <h3>MCP & Extensions</h3>
        <p>MCP server management and extension configuration coming soon.</p>
        <div className="feature-preview">
          <div className="feature-item">🔌 MCP Servers</div>
          <div className="feature-item">🧩 Extensions</div>
          <div className="feature-item">⚡ Plugins</div>
        </div>
      </div>
    </div>
  )
}

// ─── About Section ───
function AboutSection({ t, lang }: { t: (k: string) => string; lang: Lang }) {
  return (
    <div className="settings-group">
      <div className="about-section">
        <div className="about-logo">
          <span className="logo-text">Meshy</span>
          <span className="version-badge">v1.0.0</span>
        </div>
        <p className="about-desc">
          {lang === 'zh' ? 'Meshy - AI 驱动的代码助手，让编程更高效' : 'Meshy - AI-powered coding assistant for more efficient programming'}
        </p>

        <div className="about-links">
          <a href="#" className="about-link">
            <ExternalLink size={14} /> {t('homepage')}
          </a>
          <a href="#" className="about-link">
            <ExternalLink size={14} /> {t('documentation')}
          </a>
        </div>

        <div className="about-tech">
          <h4>Built with</h4>
          <div className="tech-stack">
            <span className="tech-badge">React</span>
            <span className="tech-badge">TypeScript</span>
            <span className="tech-badge">WebSocket</span>
            <span className="tech-badge">Node.js</span>
          </div>
        </div>
      </div>
    </div>
  )
}
