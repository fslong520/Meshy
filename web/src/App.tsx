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
import { SettingsPanel } from './components/SettingsPanel'

export type Lang = 'zh' | 'en'

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
    const rawResult = data.result;
    const resultText: string = typeof rawResult === 'string' ? rawResult : (rawResult ? JSON.stringify(rawResult, null, 2) : (isError ? 'Tool execution failed.' : 'Tool execution completed.'))

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
        <SettingsPanel
          lang={lang} setLang={setLang}
          theme={theme} setTheme={setTheme}
          fontSize={fontSize} setFontSize={setFontSize}
          compactMessages={compactMessages} setCompactMessages={setCompactMessages}
          showReasoning={showReasoning} setShowReasoning={setShowReasoning}
          modelProviders={modelProviders}
          modelLoading={modelLoading}
          activeModel={activeModel}
          onModelSelect={handleModelSelect}
          onClose={() => { setShowSettings(false); refreshModelList(); }}
          onRefreshModels={refreshModelList}
          fineTuneTemp={fineTuneTemp} setFineTuneTemp={setFineTuneTemp}
          fineTuneMaxTokens={fineTuneMaxTokens} setFineTuneMaxTokens={setFineTuneMaxTokens}
          fineTuneTopP={fineTuneTopP} setFineTuneTopP={setFineTuneTopP}
        />
      )}
    </div>
  )
}

export default App
