import { useState, useCallback, useEffect } from 'react'
import {
  useWebSocket,
  useEvent,
  sendRpc,
  clearPolicyDecisionTimeline,
  clearPolicyDecisionHistory,
  getPolicyDecisionHistory,
  getPolicyDecisionTimeline,
  replacePolicyDecisionTimeline,
  replacePolicyDecisionHistory,
  type ChatMessage,
  type RpcMessage,
  type PolicyDecisionEvent,
} from './store/ws'
import { attachToolError, upsertToolCallById } from './store/tool-call-linking'
import { hydrateReplayView } from './store/replay-hydration'
import { mergePolicyDecision } from './store/policy-decision-ui.js'
import type { ReplayExport } from '../../src/shared/replay-contract.js'
import { LeftSidebar } from './components/LeftSidebar'
import { ChatPanel } from './components/ChatPanel'
import { RightPanel } from './components/RightPanel'
import { InputArea } from './components/InputArea'

// ─── 国际化翻译 ───
export type Lang = 'zh' | 'en'

const translations: Record<Lang, Record<string, string>> = {
  zh: {
    settings: '设置',
    toolPolicy: '工具策略模式',
    standardMode: '标准模式：所有工具均可执行。',
    readOnlyMode: '只读模式：修改类工具被阻止，仅允许安全读取操作。',
    language: '语言 / Language',
    theme: '主题',
    dark: '深色',
    light: '浅色',
    auto: '跟随系统',
    fontSize: '字体大小',
    compactMessages: '紧凑消息',
    showReasoning: '显示思考过程',
    moreSettings: '更多设置即将推出...',
    standard: '标准',
    readOnly: '只读',
  },
  en: {
    settings: 'Settings',
    toolPolicy: 'Tool Policy Mode',
    standardMode: 'Standard mode: All tools are available for execution.',
    readOnlyMode: 'Read-only mode: Modifying tools are blocked. Only safe read operations are allowed.',
    language: 'Language',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    auto: 'Auto',
    fontSize: 'Font Size',
    compactMessages: 'Compact Messages',
    showReasoning: 'Show Reasoning',
    moreSettings: 'More settings coming soon...',
    standard: 'Standard',
    readOnly: 'Read-Only',
  },
}

// 从 localStorage 加载保存的语言偏好
function loadLang(): Lang {
  const saved = localStorage.getItem('meshy-lang')
  return saved === 'en' ? 'en' : 'zh'
}

// 从 localStorage 加载保存的主题偏好
type Theme = 'dark' | 'light' | 'auto'
function loadTheme(): Theme {
  const saved = localStorage.getItem('meshy-theme')
  return saved === 'light' ? 'light' : saved === 'auto' ? 'auto' : 'dark'
}

function App() {
  const { connected } = useWebSocket()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [bbOpen, setBbOpen] = useState(false)
  const [bbGoal, setBbGoal] = useState('')
  const [bbTasks, setBbTasks] = useState<Array<{ id: string; description: string; status: string }>>([])
  const [agentStreaming, setAgentStreaming] = useState(false)
  const [activeSession, setActiveSession] = useState<{ id: string; title?: string } | null>(null)
  const [policyDecisions, setPolicyDecisions] = useState<PolicyDecisionEvent[]>(() => getPolicyDecisionTimeline())
  const [policyDecisionHistory, setPolicyDecisionHistory] = useState<PolicyDecisionEvent[]>(() => getPolicyDecisionHistory())
  const [showSettings, setShowSettings] = useState(false)
  // 模型列表状态
  const [modelProviders, setModelProviders] = useState<Record<string, { protocol: string; models: string[] }>>({})
  const [modelLoading, setModelLoading] = useState(true)
  const [activeModel, setActiveModel] = useState<string>('')

  // 获取模型列表
  useEffect(() => {
    sendRpc<{ providers: Record<string, { protocol: string; models: string[] }>; defaultModel: string }>('model:list')
      .then(res => {
        if (res?.providers) {
          setModelProviders(res.providers)
        }
        if (res?.defaultModel) {
          setActiveModel(res.defaultModel)
        }
        setModelLoading(false)
      })
      .catch(err => {
        console.error('[Settings] Failed to load models:', err)
        setModelLoading(false)
      })
  }, [])

  // 页面加载时自动加载当前 session 的历史消息
  useEffect(() => {
    sendRpc<{ sessionId: string; replay?: ReplayExport }>('session:get')
      .then(res => {
        if (res?.replay) {
          const hydrated = hydrateReplayView(res.replay)
          setMessages(hydrated.messages)
          setActiveSession({ id: res.sessionId, title: res.replay.session.title || '' })
          setBbGoal(res.replay.blackboard.currentGoal)
          setBbTasks(res.replay.blackboard.tasks)
          replacePolicyDecisionTimeline(hydrated.policyDecisions)
          replacePolicyDecisionHistory(hydrated.policyDecisions)
          setPolicyDecisions(getPolicyDecisionTimeline())
          setPolicyDecisionHistory(getPolicyDecisionHistory())
        }
      })
      .catch(err => console.warn('[App] Failed to load session on startup:', err))
  }, [])

  // 处理模型选择
  const handleModelSelect = async (modelId: string) => {
    const res = await sendRpc<{ success: boolean; error?: string }>('model:switch', { model: modelId })
    if (res?.success) {
      setActiveModel(modelId)
    } else {
      alert(`Failed to switch model: ${res?.error || 'Unknown error'}`)
    }
  }


  // 语言、主题、字体等设置状态
  const [lang, setLang] = useState<Lang>(loadLang)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('meshy-font-size')
    return saved ? parseInt(saved, 10) : 14
  })
  const [compactMessages, setCompactMessages] = useState<boolean>(() => {
    return localStorage.getItem('meshy-compact') === 'true'
  })
  const [showReasoning, setShowReasoning] = useState<boolean>(() => {
    return localStorage.getItem('meshy-show-reasoning') !== 'false'
  })
  // 模型微调参数
  const [fineTuneTemp, setFineTuneTemp] = useState(0.7)
  const [fineTuneMaxTokens, setFineTuneMaxTokens] = useState(4096)
  const [fineTuneTopP, setFineTuneTopP] = useState(1.0)

  // 应用主题
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    } else {
      root.setAttribute('data-theme', theme)
    }
    localStorage.setItem('meshy-theme', theme)
  }, [theme])

  // 应用字体大小
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`)
    localStorage.setItem('meshy-font-size', String(fontSize))
  }, [fontSize])

  // 应用紧凑消息模式
  useEffect(() => {
    document.body.classList.toggle('compact-messages', compactMessages)
    localStorage.setItem('meshy-compact', String(compactMessages))
  }, [compactMessages])

  // 应用显示思考过程
  useEffect(() => {
    localStorage.setItem('meshy-show-reasoning', String(showReasoning))
  }, [showReasoning])

  const handleSettingsOpen = useCallback(() => setShowSettings(true), [])

  // 模型列表版本号 —— 用于触发 InputArea 重新拉取
  const [modelListVersion, setModelListVersion] = useState(0)

  // 刷新模型列表（settings 关闭时自动调用）
  const refreshModelList = useCallback(() => {
    sendRpc<{ providers: Record<string, { protocol: string; models: string[] }>; defaultModel: string }>('model:list')
      .then(res => {
        if (res?.providers) setModelProviders(res.providers)
        if (res?.defaultModel) setActiveModel(res.defaultModel)
        setModelListVersion(v => v + 1)
      })
      .catch(() => {})
  }, [])

  // 翻译辅助函数（使用当前 lang 状态）
  const t = (key: string): string => {
    return translations[lang]?.[key] || key
  }

  // 确保存在当前轮次的 Agent 消息容器，用于挂载 toolCalls / 错误等状态
  const ensureAgentContainer = useCallback((prev: ChatMessage[]): { list: ChatMessage[]; agent: ChatMessage } => {
    const list = [...prev]
    let last = list[list.length - 1]
    if (!last || last.role !== 'agent') {
      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: '',
        timestamp: Date.now(),
        toolCalls: [],
      }
      list.push(agentMsg)
      last = agentMsg
    } else if (!last.toolCalls) {
      last = { ...last, toolCalls: [] }
      list[list.length - 1] = last
    }
    return { list, agent: last }
  }, [])

  // 接收 Agent 流式文本
  useEvent('agent:text', (msg: RpcMessage) => {
    const chunk = msg.data as { text: string; id: string; replace?: boolean }
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'agent' && last.id === chunk.id) {
        // replace=true 表示累积流，直接替换全部内容；否则追加 delta
        const newContent = chunk.replace ? chunk.text : last.content + chunk.text
        return [...prev.slice(0, -1), { ...last, content: newContent }]
      }
      return [...prev, { id: chunk.id, role: 'agent', content: chunk.text, timestamp: Date.now() }]
    })
    setAgentStreaming(true)
  })

  // 接收 Agent 思考过程 (DeepSeek R1)
  useEvent('agent:reasoning', (msg: RpcMessage) => {
    const chunk = msg.data as { text: string; id: string }
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'agent' && last.id === chunk.id) {
        const currentReasoning = last.reasoningContent || ''
        return [...prev.slice(0, -1), { ...last, reasoningContent: currentReasoning + chunk.text }]
      }
      return [...prev, { id: chunk.id, role: 'agent', content: '', reasoningContent: chunk.text, timestamp: Date.now() }]
    })
    setAgentStreaming(true)
  })

  // Agent 完成
  useEvent('agent:done', (msg: RpcMessage) => {
    setAgentStreaming(false)
    setMessages((prev) => {
      const data = msg.data as { id?: string; finalContent?: string } | undefined
      const finalContent = data?.finalContent || ''
      const last = prev[prev.length - 1]

      // 已有 agent 消息且有内容 → 用 finalContent 覆盖（因 SSE 可能丢包导致内容残缺）
      if (last?.role === 'agent' && last.content) {
        if (finalContent && finalContent.length > last.content.length) {
          return [...prev.slice(0, -1), { ...last, content: finalContent }]
        }
        return prev
      }

      // agent 消息存在但仅有 reasoningContent
      if (last?.role === 'agent' && !last.content && last.reasoningContent) {
        return [...prev.slice(0, -1), { ...last, content: last.reasoningContent }]
      }

      // SSE 断连导致 agent 消息缺失 → 用 finalContent 补建
      if (finalContent && (!last || last.role !== 'agent')) {
        return [...prev, {
          id: data?.id || `agent-${Date.now()}`,
          role: 'agent',
          content: finalContent,
          timestamp: Date.now(),
        }]
      }

      return prev
    })
  })

  // Session 被后端系统指令重置/切换
  useEvent('agent:session_changed', (msg: RpcMessage) => {
    const data = msg.data as { sessionId: string }
    if (data.sessionId === 'archived') {
      setMessages([])
      setActiveSession(null)
      setBbGoal('')
      setBbTasks([])
      clearPolicyDecisionTimeline()
      clearPolicyDecisionHistory()
      setPolicyDecisions([])
      setPolicyDecisionHistory([])
    } else if (data.sessionId !== activeSession?.id) {
      handleSessionSwitch(data.sessionId)
    }
  })

  // Tool Call 通知
  useEvent('agent:tool_call', (msg: RpcMessage) => {
    const data = msg.data as { name: string; args: string; id: string }
    setMessages((prev) => {
      const { list, agent } = ensureAgentContainer(prev)
      const existingToolCalls = agent.toolCalls || []
      const newToolCalls = upsertToolCallById(existingToolCalls, {
        id: data.id,
        name: data.name,
        args: data.args || '',
        status: 'running',
      })

      list[list.length - 1] = { ...agent, toolCalls: newToolCalls }
      return list
    })
  })

  // Tool Call 结果
  useEvent('agent:tool_result', (msg: RpcMessage) => {
    const data = msg.data as {
      id: string;
      name?: string;
      tool?: string;
      result?: string;
      isError?: boolean;
      success?: boolean;
      policyDecision?: {
        decision: 'allow' | 'deny';
        mode: string;
        permissionClass: string;
        reason: string;
        timestamp?: string | number;
      };
    }
    const toolName = data.name || data.tool || 'unknown_tool'
    const isError = data.isError ?? (data.success === false)
    const resultText = data.result ?? (isError ? 'Tool execution failed.' : 'Tool execution completed.')

    setMessages((prev) => {
      const { list, agent } = ensureAgentContainer(prev)
      const existingToolCalls = agent.toolCalls || []
      const existingPolicyDecision = existingToolCalls.find((toolCall) => toolCall.id === data.id)?.policyDecision
      const finalToolCalls = upsertToolCallById(existingToolCalls, {
        id: data.id,
        name: toolName,
        result: resultText,
        status: (isError ? 'error' : 'done') as 'error' | 'done',
        policyDecision: mergePolicyDecision(data.policyDecision, existingPolicyDecision),
      })

      list[list.length - 1] = { ...agent, toolCalls: finalToolCalls }
      return list
    })
  })

  // 错误通知（Sandbox 拒绝 / 工具执行失败）
  useEvent('agent:error', (msg: RpcMessage) => {
    const data = msg.data as {
      id?: string;
      tool?: string;
      error?: string;
      reason?: string;
      policyDecision?: {
        decision: 'allow' | 'deny';
        mode: string;
        permissionClass: string;
        reason: string;
        timestamp?: string | number;
      };
    }
    const errorText = data.reason || data.error || 'Unknown error'
    setMessages((prev) => {
      const { list, agent } = ensureAgentContainer(prev)
      const existingToolCalls = agent.toolCalls || []
      const existingPolicyDecision = data.id
        ? existingToolCalls.find((toolCall) => toolCall.id === data.id)?.policyDecision
        : undefined
      const { list: finalToolCalls } = attachToolError(existingToolCalls, {
        id: data.id,
        tool: data.tool,
        errorText,
        policyDecision: mergePolicyDecision(data.policyDecision, existingPolicyDecision),
      })

      list[list.length - 1] = { ...agent, toolCalls: finalToolCalls }
      return list
    })
  })

  // 自动审批通知（AI Secondary Reviewer）
  useEvent('agent:approve', (msg: RpcMessage) => {
    const data = msg.data as { id?: string; tool: string; reason: string }
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'agent') {
        const toolCalls = (last.toolCalls || []).map((tc) =>
          (data.id ? tc.id === data.id : tc.name === data.tool) && tc.status === 'running'
            ? { ...tc, approvalReason: data.reason }
            : tc,
        )
        return [...prev.slice(0, -1), { ...last, toolCalls }]
      }
      return prev
    })
  })

  // 审批请求
  useEvent('approval:request', (msg: RpcMessage) => {
    const data = msg.data as { id: string; question: string; context?: string }
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'agent') {
        return [...prev.slice(0, -1), { ...last, approval: { ...data, resolved: false } }]
      }
      return [
        ...prev,
        { id: `approval-${data.id}`, role: 'agent', content: '', timestamp: Date.now(), approval: { ...data, resolved: false } },
      ]
    })
  })

  useEvent('agent:policy_decision', () => {
    setPolicyDecisions(getPolicyDecisionTimeline())
    setPolicyDecisionHistory(getPolicyDecisionHistory())
  })

  useEvent('agent:policy_decision', (msg: RpcMessage) => {
    const data = msg.data as {
      id?: string;
      tool?: string;
      decision?: 'allow' | 'deny';
      mode?: string;
      permissionClass?: string;
      reason?: string;
      timestamp?: string | number;
    }

    if (!data.id || !data.tool || !data.decision || !data.mode || !data.permissionClass || !data.reason) {
      return
    }

    const decision = data.decision
    const mode = data.mode
    const permissionClass = data.permissionClass
    const reason = data.reason
    const toolName = data.tool
    const toolCallId = data.id

    setMessages((prev) => {
      const list = [...prev]
      let matchedIndex = -1

      for (let i = list.length - 1; i >= 0; i--) {
        const msgItem = list[i]
        if (msgItem?.toolCalls?.some((tc) => tc.id === data.id)) {
          matchedIndex = i
          break
        }
      }

      const policyDecision = mergePolicyDecision({
        decision,
        mode,
        permissionClass,
        reason,
        timestamp: data.timestamp,
      })

      if (matchedIndex >= 0) {
        const target = list[matchedIndex]
        const nextCalls = upsertToolCallById(target.toolCalls || [], {
          id: toolCallId,
          name: toolName,
          policyDecision,
        })
        list[matchedIndex] = { ...target, toolCalls: nextCalls }
        return list
      }

      const { list: ensuredList, agent } = ensureAgentContainer(list)
      const nextCalls = upsertToolCallById(agent.toolCalls || [], {
        id: toolCallId,
        name: toolName,
        policyDecision,
      })
      ensuredList[ensuredList.length - 1] = { ...agent, toolCalls: nextCalls }
      return ensuredList
    })
  })

  // 发送消息
  const handleSend = useCallback(
    (text: string, mode: string, attachments?: { name: string; type: string; data: string }[]) => {
      if (!text.trim() && (!attachments || attachments.length === 0)) return

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
        attachments,
      }
      setMessages((prev) => [...prev, userMsg])

      // 立即进入持续执行状态，触发显示暂停按钮
      setAgentStreaming(true)

      // 通过 RPC 提交任务（附带模型微调参数）
      sendRpc('task:submit', { prompt: text, mode, attachments, temperature: fineTuneTemp, maxTokens: fineTuneMaxTokens, topP: fineTuneTopP })
    },
    [],
  )

  // 审批回复
  const handleApproval = useCallback((approvalId: string, approved: boolean) => {
    sendRpc('approval:response', { id: approvalId, approved })
    setMessages((prev) =>
      prev.map((m) =>
        m.approval?.id === approvalId ? { ...m, approval: { ...m.approval, resolved: true } } : m,
      ),
    )
  }, [])

  // Session 切换：加载历史消息
  const handleSessionSwitch = useCallback((sessionId: string, title?: string) => {
    setActiveSession({ id: sessionId, title })
    sendRpc<{ success: boolean; replay?: ReplayExport }>('session:switch', { sessionId }).then((res) => {
      if (res?.success && res.replay) {
        const hydrated = hydrateReplayView(res.replay)
        setMessages(hydrated.messages)
        setBbGoal(res.replay.blackboard.currentGoal)
        setBbTasks(res.replay.blackboard.tasks)
        replacePolicyDecisionTimeline(hydrated.policyDecisions)
        replacePolicyDecisionHistory(hydrated.policyDecisions)
        setPolicyDecisions(getPolicyDecisionTimeline())
        setPolicyDecisionHistory(getPolicyDecisionHistory())
      } else {
        // 新 session，清空消息
        setMessages([])
        setBbGoal('')
        setBbTasks([])
        clearPolicyDecisionTimeline()
        clearPolicyDecisionHistory()
        setPolicyDecisions([])
        setPolicyDecisionHistory([])
      }
    })
  }, [])

  const handleSessionAction = useCallback((action: 'rename' | 'delete' | 'compact', payload?: any) => {
    if (!activeSession) return

    if (action === 'delete') {
      sendRpc<{ success: boolean; activeSessionId?: string }>('session:delete', { id: activeSession.id }).then(res => {
        if (res?.success) {
          if (res.activeSessionId) {
            handleSessionSwitch(res.activeSessionId)
          } else {
            setMessages([])
            setActiveSession(null)
            clearPolicyDecisionTimeline()
            clearPolicyDecisionHistory()
            setPolicyDecisions([])
            setPolicyDecisionHistory([])
          }
        }
      })
    } else if (action === 'rename' && payload?.title) {
      sendRpc<{ success: boolean; replay?: ReplayExport }>('session:rename', { id: activeSession.id, title: payload.title }).then(res => {
        if (res?.success) {
          setActiveSession(prev => prev ? { ...prev, title: payload.title } : null)
        }
      })
    } else if (action === 'compact') {
      sendRpc<{ success: boolean; replay?: ReplayExport }>('session:compact', { id: activeSession.id }).then(res => {
        if (res?.success && res.replay) {
          const hydrated = hydrateReplayView(res.replay)
          setMessages(hydrated.messages)
          replacePolicyDecisionTimeline(hydrated.policyDecisions)
          replacePolicyDecisionHistory(hydrated.policyDecisions)
          setPolicyDecisions(getPolicyDecisionTimeline())
          setPolicyDecisionHistory(getPolicyDecisionHistory())
        }
      })
    }
  }, [activeSession])

  return (
    <div className="app-layout">
      <LeftSidebar
        connected={connected}
        activeSessionId={activeSession?.id || null}
        onSessionSwitch={handleSessionSwitch}
        onSettingsOpen={handleSettingsOpen}
      />
      <div className="center-panel">
        <ChatPanel
          messages={messages}
          onApproval={handleApproval}
          activeSession={activeSession}
          onSessionAction={handleSessionAction}
          showReasoning={showReasoning}
          agentStreaming={agentStreaming}
        />

        {/* Blackboard — 放于 ChatPanel 与 InputArea 之间，流式推送而非遮盖 */}
        <div className={`bb-drawer ${bbOpen ? 'open' : ''}`}>
          <div className="bb-drawer-inner">
            <h3 className="bb-title">Blackboard</h3>
            {bbGoal ? (
              <>
                <p className="bb-goal">🎯 {bbGoal}</p>
                {bbTasks.map((t) => (
                  <div className="bb-task" key={t.id}>
                    <input type="checkbox" checked={t.status === 'completed'} readOnly />
                    <span className={t.status === 'completed' ? 'bb-task-done' : ''}>
                      {t.description}
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <p className="bb-empty">Goal and task status will appear here during active sessions.</p>
            )}
          </div>
        </div>

        <InputArea
          onSend={handleSend}
          disabled={agentStreaming}
          bbOpen={bbOpen}
          onToggleBb={() => setBbOpen(!bbOpen)}
          modelListVersion={modelListVersion}
        />
      </div>
      <RightPanel policyDecisions={policyDecisions} policyDecisionHistory={policyDecisionHistory} />

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          lang={lang} setLang={setLang}
          theme={theme} setTheme={setTheme}
          fontSize={fontSize} setFontSize={setFontSize}
          compactMessages={compactMessages} setCompactMessages={setCompactMessages}
          showReasoning={showReasoning} setShowReasoning={setShowReasoning}
          t={t}
          modelProviders={modelProviders}
          modelLoading={modelLoading}
          activeModel={activeModel}
          onModelSelect={handleModelSelect}
          onClose={() => { setShowSettings(false); refreshModelList(); }}
          fineTuneTemp={fineTuneTemp} setFineTuneTemp={setFineTuneTemp}
          fineTuneMaxTokens={fineTuneMaxTokens} setFineTuneMaxTokens={setFineTuneMaxTokens}
          fineTuneTopP={fineTuneTopP} setFineTuneTopP={setFineTuneTopP}
        />
      )}
    </div>
  )
}

// ─── Settings Modal ───
interface CustomProviderInfo {
  name: string;
  protocol?: string;
  sdk?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  models: string[];
}

function SettingsModal({
  lang, setLang, setTheme, fontSize, setFontSize,
  compactMessages, setCompactMessages, showReasoning, setShowReasoning,
  t, onClose,
  modelProviders, modelLoading, activeModel, onModelSelect,
  fineTuneTemp, setFineTuneTemp, fineTuneMaxTokens, setFineTuneMaxTokens, fineTuneTopP, setFineTuneTopP,
}: {
  lang: Lang; setLang: (l: Lang) => void;
  theme: Theme; setTheme: (t: Theme) => void;
  fontSize: number; setFontSize: (s: number) => void;
  compactMessages: boolean; setCompactMessages: (c: boolean) => void;
  showReasoning: boolean; setShowReasoning: (s: boolean) => void;
  t: (key: string) => string;
  onClose: () => void;
  modelProviders: Record<string, { protocol: string; models: string[] }>;
  modelLoading: boolean;
  activeModel: string;
  onModelSelect: (modelId: string) => void;
  fineTuneTemp: number; setFineTuneTemp: (v: number) => void;
  fineTuneMaxTokens: number; setFineTuneMaxTokens: (v: number) => void;
  fineTuneTopP: number; setFineTuneTopP: (v: number) => void;
}) {
  const [policyMode, setPolicyMode] = useState<'standard' | 'read_only'>('standard')
  const [loading, setLoading] = useState(true)

  // ─── 自定义 Provider 状态 ───
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
  const [customProvError, setCustomProvError] = useState('')

  // 加载自定义 Provider 列表
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
    setCustomProvError('')
  }

  const openAddForm = () => {
    resetForm()
    setShowAddForm(true)
  }

  const openEditForm = (p: CustomProviderInfo) => {
    setFormName(p.name)
    setFormBaseUrl(p.baseUrl || '')
    setFormApiKey('') // 不预填已存储的 key
    setFormProtocol(p.protocol || 'openai')
    setFormSdk(p.sdk || '')
    setFormModels((p.models || []).join(', '))
    setEditingProvider(p.name)
    setShowAddForm(true)
    setCustomProvError('')
  }

  const handleSaveProvider = async () => {
    setCustomProvError('')
    if (!formName.trim()) {
      setCustomProvError('Provider name is required.')
      return
    }
    if (!formBaseUrl.trim()) {
      setCustomProvError('Base URL is required.')
      return
    }

    setFormBusy(true)
    try {
      const modelList = formModels
        .split(',')
        .map(m => m.trim())
        .filter(Boolean)

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

      // 如果是编辑且修改了名称，先删旧再加新
      if (isEditing && editingProvider !== formName.trim()) {
        await sendRpc('provider:remove', { name: editingProvider })
        const res = await sendRpc<{ success: boolean; error?: string }>('provider:add', params)
        if (!res.success) throw new Error(res.error)
      } else {
        const res = await sendRpc<{ success: boolean; error?: string }>(method, params)
        if (!res.success) throw new Error(res.error)
      }

      // 刷新列表
      const listRes = await sendRpc<{ providers: CustomProviderInfo[] }>('provider:list')
      if (listRes?.providers) setCustomProviders(listRes.providers)
      resetForm()
    } catch (err: any) {
      setCustomProvError(err.message || 'Failed to save provider.')
    } finally {
      setFormBusy(false)
    }
  }

  const handleDeleteProvider = async (name: string) => {
    if (!window.confirm(`Are you sure you want to remove provider "${name}"?`)) return
    try {
      const res = await sendRpc<{ success: boolean; error?: string }>('provider:remove', { name })
      if (!res.success) throw new Error(res.error)
      setCustomProviders(prev => prev.filter(p => p.name !== name))
    } catch (err: any) {
      alert(`Failed to remove provider: ${err.message}`)
    }
  }

  // Load current policy mode
  useEffect(() => {
    sendRpc<{ mode: string }>('tool:policy:get')
      .then(res => {
        if (res?.mode === 'read_only' || res?.mode === 'standard') {
          setPolicyMode(res.mode)
        }
        setLoading(false)
      })
      .catch(err => {
        console.error('[Settings] Failed to load policy mode:', err)
        setLoading(false)
      })
  }, [])

  const handleTogglePolicy = async () => {
    const newMode = policyMode === 'standard' ? 'read_only' : 'standard'
    const res = await sendRpc<{ success: boolean; mode?: string; error?: string }>('tool:policy:set', { mode: newMode })
    if (res?.success && res.mode) {
      setPolicyMode(res.mode as 'standard' | 'read_only')
    } else {
      alert(`Failed to switch policy mode: ${res?.error || 'Unknown error'}`)
    }
  }

  const handleLangSwitch = (l: Lang) => {
    setLang(l)
    localStorage.setItem('meshy-lang', l)
  }

  const handleThemeSwitch = (t: Theme) => {
    setTheme(t)
  }

  // ─── 内联样式常量 ───
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px', borderRadius: 5, fontSize: 12,
    border: '1px solid var(--border, #444)', background: 'var(--bg-secondary)',
    color: 'var(--text, #eee)', fontFamily: 'var(--font-sans)', outline: 'none',
  };
  const btnSec: React.CSSProperties = {
    padding: '5px 12px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
    border: '1px solid var(--border, #444)', background: 'transparent',
    color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
  };
  const btnPrim: React.CSSProperties = {
    padding: '5px 12px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
    border: 'none', background: 'var(--accent, #4ade80)',
    color: '#000', fontWeight: 600, fontFamily: 'var(--font-sans)',
  };
  const btnMini: React.CSSProperties = {
    padding: '1px 7px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
    border: '1px solid var(--border, #444)', background: 'transparent',
    color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
  };

  function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: () => void }) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text, #eee)' }}>{label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{desc}</div>
        </div>
        <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={checked} onChange={onChange} style={{ opacity: 0, width: 0, height: 0 }} />
          <span style={{
            position: 'absolute', inset: 0, borderRadius: 10,
            background: checked ? 'var(--accent, #6366f1)' : 'var(--border, #444)',
            transition: 'background 0.2s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: checked ? 18 : 2,
              width: 16, height: 16, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s',
            }} />
          </span>
        </label>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary, #1e1e2e)',
          border: '1px solid var(--border, #333)',
          borderRadius: 12, padding: 24, width: 500, maxWidth: '92vw', maxHeight: '85vh', overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text, #eee)', display: 'flex', alignItems: 'center', gap: 6 }}>
            ⚙️ {t('settings')}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted, #888)',
              cursor: 'pointer', fontSize: 20, padding: 4, display: 'flex', alignItems: 'center'
            }}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>Loading...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* ── Language ── */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #eee)', marginBottom: 10 }}>
                🌐 {t('language')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['zh', 'en'] as Lang[]).map(l => (
                  <button
                    key={l}
                    onClick={() => handleLangSwitch(l)}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                      border: lang === l ? '2px solid var(--accent, #6366f1)' : '1px solid var(--border, #444)',
                      background: lang === l ? 'var(--accent-dim)' : 'transparent',
                      color: lang === l ? 'var(--accent)' : 'var(--text-muted)',
                      fontWeight: lang === l ? 600 : 400,
                      transition: 'all 0.2s',
                    }}
                  >
                    {l === 'zh' ? '🇨🇳 中文' : '🇺🇸 English'}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Theme ── */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #eee)', marginBottom: 10 }}>
                🎨 {t('theme')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['dark', 'light', 'auto'] as Theme[]).map(theme => (
                  <button
                    key={theme}
                    onClick={() => handleThemeSwitch(theme)}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                      border: theme === theme ? '2px solid var(--accent, #6366f1)' : '1px solid var(--border, #444)',
                      background: theme === theme ? 'var(--accent-dim)' : 'transparent',
                      color: theme === theme ? 'var(--accent)' : 'var(--text-muted)',
                      fontWeight: theme === theme ? 600 : 400,
                      transition: 'all 0.2s',
                    }}
                  >
                    {theme === 'dark' ? '🌑 ' + t('dark') : theme === 'light' ? '☀️ ' + t('light') : '🔄 ' + t('auto')}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Model ── */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #eee)', marginBottom: 12 }}>
                🤖 Model
              </div>

              {/* 当前模型选择 —— 下拉框 */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Active Model</label>
                {modelLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading...</div>
                ) : (
                  <select
                    value={activeModel}
                    onChange={e => onModelSelect(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13,
                      border: '1px solid var(--border, #444)', background: 'var(--bg-tertiary)',
                      color: 'var(--text, #eee)', fontFamily: 'var(--font-mono)', outline: 'none',
                      cursor: 'pointer',
                    }}
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

              {/* 分隔线 + 自定义 API */}
              <div style={{
                borderTop: '1px solid var(--border, #333)', paddingTop: 12,
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>🔌 Custom API</span>
                  {!showAddForm && (
                    <button onClick={openAddForm} style={{
                      padding: '3px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
                      border: '1px solid var(--accent, #6366f1)', background: 'var(--accent-dim)',
                      color: 'var(--accent)', fontWeight: 600, fontFamily: 'var(--font-sans)',
                    }}>
                      + Add
                    </button>
                  )}
                </div>

                {/* 添加/编辑表单 */}
                {showAddForm && (
                  <div style={{
                    padding: 12, borderRadius: 8, border: '1px solid var(--border, #333)',
                    background: 'var(--bg-tertiary)', display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <input value={formName} onChange={e => setFormName(e.target.value)}
                          placeholder="Provider name"
                          style={inputStyle} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <select value={formProtocol} onChange={e => setFormProtocol(e.target.value)} style={inputStyle}>
                          <option value="openai">OpenAI</option>
                          <option value="openai-compatible">OpenAI Compatible</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="deepseek">DeepSeek</option>
                          <option value="__custom__">Custom SDK...</option>
                        </select>
                      </div>
                    </div>
                    {formProtocol === '__custom__' && (
                      <input value={formSdk} onChange={e => setFormSdk(e.target.value)}
                        placeholder="SDK package name (e.g. @ai-sdk/anthropic)" style={inputStyle} />
                    )}
                    <input value={formBaseUrl} onChange={e => setFormBaseUrl(e.target.value)}
                      placeholder="Base URL (e.g. https://api.openai.com/v1)" style={inputStyle} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={formApiKey} onChange={e => setFormApiKey(e.target.value)}
                        placeholder={editingProvider ? 'API Key (leave blank to keep)' : 'API Key (optional)'}
                        type="password" style={{ ...inputStyle, flex: 1 }} />
                      <input value={formModels} onChange={e => setFormModels(e.target.value)}
                        placeholder="Models (comma-sep)" style={{ ...inputStyle, flex: 1 }} />
                    </div>
                    {customProvError && <div style={{ fontSize: 12, color: 'var(--error, #f87171)' }}>{customProvError}</div>}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={resetForm} disabled={formBusy} style={btnSec}>Cancel</button>
                      <button onClick={handleSaveProvider} disabled={formBusy}
                        style={{ ...btnPrim, opacity: formBusy ? 0.6 : 1 }}>
                        {formBusy ? 'Saving...' : editingProvider ? 'Update' : 'Add'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 已有自定义 Provider 列表 */}
                {customProviders.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {customProviders.map(p => (
                      <div key={p.name} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 8px', borderRadius: 5, border: '1px solid var(--border, #333)',
                        background: 'var(--bg-tertiary)', fontSize: 12,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--text, #eee)', marginBottom: 1 }}>
                            {p.name}
                            <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                              {p.sdk || p.protocol || 'openai'}
                            </span>
                            <span style={{ marginLeft: 4, fontSize: 10, color: p.hasApiKey ? 'var(--accent)' : 'var(--text-muted)' }}>
                              {p.hasApiKey ? '🔑' : '🔓'}
                            </span>
                          </div>
                          {p.baseUrl && <div style={{ color: 'var(--text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.baseUrl}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 8 }}>
                          <button onClick={() => openEditForm(p)} style={btnMini}>Edit</button>
                          <button onClick={() => handleDeleteProvider(p.name)} style={{ ...btnMini, color: 'var(--error, #f87171)', borderColor: 'rgba(248,113,113,0.3)' }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {customProviders.length === 0 && !showAddForm && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No custom providers.</div>
                )}
              </div>
            </div>

            {/* ── Display ── */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #eee)', marginBottom: 12 }}>
                🎨 Display
              </div>

              {/* Font Size */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>🔤 Font Size</span>
                  <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 8px', borderRadius: 4 }}>
                    {fontSize}px
                  </span>
                </div>
                <input type="range" min={12} max={20} value={fontSize}
                  onChange={e => setFontSize(parseInt(e.target.value, 10))}
                  style={{ width: '100%', accentColor: 'var(--accent, #6366f1)', cursor: 'pointer' }} />
              </div>

              {/* Toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ToggleRow label="📦 Compact Messages" desc={compactMessages ? 'Less space between messages' : 'Normal spacing'}
                  checked={compactMessages} onChange={() => setCompactMessages(!compactMessages)} />
                <ToggleRow label="🧠 Show Reasoning" desc={showReasoning ? 'Show AI thinking process' : 'Hide thinking process'}
                  checked={showReasoning} onChange={() => setShowReasoning(!showReasoning)} />
              </div>
            </div>

            {/* ── 模型微调参数 ── */}
            <div style={{ borderTop: '1px solid var(--border, #333)', paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #eee)', marginBottom: 12 }}>
                🌡️ Model Fine-Tune
              </div>
              {/* Temperature */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Temperature</span>
                  <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 8px', borderRadius: 4 }}>{fineTuneTemp.toFixed(1)}</span>
                </div>
                <input type="range" min={0} max={2} step={0.1} value={fineTuneTemp}
                  onChange={e => { const v = parseFloat(e.target.value); setFineTuneTemp(v); sendRpc('model:fine-tune:set', { temperature: v }).catch(() => {}); }}
                  style={{ width: '100%', accentColor: 'var(--accent, #6366f1)', cursor: 'pointer' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  <span>精确 (0)</span>
                  <span>平衡 (0.7)</span>
                  <span>创意 (2.0)</span>
                </div>
              </div>
              {/* Max Tokens */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Max Tokens</span>
                  <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 8px', borderRadius: 4 }}>{fineTuneMaxTokens}</span>
                </div>
                <input type="range" min={512} max={32768} step={512} value={fineTuneMaxTokens}
                  onChange={e => { const v = parseInt(e.target.value, 10); setFineTuneMaxTokens(v); sendRpc('model:fine-tune:set', { maxTokens: v }).catch(() => {}); }}
                  style={{ width: '100%', accentColor: 'var(--accent, #6366f1)', cursor: 'pointer' }} />
              </div>
              {/* Top-P */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Top-P</span>
                  <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 8px', borderRadius: 4 }}>{fineTuneTopP.toFixed(1)}</span>
                </div>
                <input type="range" min={0.1} max={1} step={0.1} value={fineTuneTopP}
                  onChange={e => { const v = parseFloat(e.target.value); setFineTuneTopP(v); sendRpc('model:fine-tune:set', { topP: v }).catch(() => {}); }}
                  style={{ width: '100%', accentColor: 'var(--accent, #6366f1)', cursor: 'pointer' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  <span>保守 (0.1)</span>
                  <span>全部 (1.0)</span>
                </div>
              </div>
            </div>

            {/* ── Divider ── */}
            <div style={{ borderTop: '1px solid var(--border, #333)', paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #eee)', marginBottom: 10 }}>
                🔧 {t('toolPolicy')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                {policyMode === 'standard' ? t('standardMode') : t('readOnlyMode')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={policyMode === 'read_only'}
                    onChange={handleTogglePolicy}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute', inset: 0, borderRadius: 11,
                    background: policyMode === 'read_only' ? 'var(--accent, #6366f1)' : 'var(--border, #444)',
                    transition: 'background 0.2s',
                  }}>
                    <span style={{
                      position: 'absolute', top: 2, left: policyMode === 'read_only' ? 20 : 2,
                      width: 18, height: 18, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s',
                    }} />
                  </span>
                </label>
                <span style={{ fontSize: 13, color: 'var(--text, #eee)' }}>
                  {policyMode === 'read_only' ? '🔒 ' + t('readOnly') : '🔓 ' + t('standard')}
                </span>
              </div>
            </div>

            {/* ── Footer ── */}
            <div style={{ borderTop: '1px solid var(--border, #333)', paddingTop: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                {t('moreSettings')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
