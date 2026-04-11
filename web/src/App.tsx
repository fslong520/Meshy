import { useState, useCallback } from 'react'
import {
  useWebSocket,
  useEvent,
  sendRpc,
  clearPolicyDecisionTimeline,
  getPolicyDecisionTimeline,
  replacePolicyDecisionTimeline,
  type ChatMessage,
  type RpcMessage,
  type PolicyDecisionEvent,
  type ToolCallInfo,
} from './store/ws'
import { attachToolError, upsertToolCallById } from './store/tool-call-linking'
import { hydrateReplayView } from './store/replay-hydration'
import { mergePolicyDecision } from './store/policy-decision-ui.js'
import type { ReplayExport } from '../../src/shared/replay-contract.js'
import { LeftSidebar } from './components/LeftSidebar'
import { ChatPanel } from './components/ChatPanel'
import { RightPanel } from './components/RightPanel'
import { InputArea } from './components/InputArea'

function App() {
  const { connected } = useWebSocket()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [bbOpen, setBbOpen] = useState(false)
  const [bbGoal, setBbGoal] = useState('')
  const [bbTasks, setBbTasks] = useState<Array<{ id: string; description: string; status: string }>>([])
  const [agentStreaming, setAgentStreaming] = useState(false)
  const [activeSession, setActiveSession] = useState<{ id: string; title?: string } | null>(null)
  const [policyDecisions, setPolicyDecisions] = useState<PolicyDecisionEvent[]>(() => getPolicyDecisionTimeline())

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
  useEvent('agent:done', () => {
    setAgentStreaming(false)
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
      setPolicyDecisions([])
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

      const policyDecision = {
        decision,
        mode,
        permissionClass,
        reason,
        timestamp: data.timestamp,
      }

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

      // 通过 RPC 提交任务
      sendRpc('task:submit', { prompt: text, mode, attachments })
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
        setPolicyDecisions(getPolicyDecisionTimeline())
      } else {
        // 新 session，清空消息
        setMessages([])
        setBbGoal('')
        setBbTasks([])
        clearPolicyDecisionTimeline()
        setPolicyDecisions([])
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
            setPolicyDecisions([])
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
          setPolicyDecisions(getPolicyDecisionTimeline())
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
      />
      <div className="center-panel">
        <ChatPanel
          messages={messages}
          onApproval={handleApproval}
          activeSession={activeSession}
          onSessionAction={handleSessionAction}
        />
        <InputArea
          onSend={handleSend}
          disabled={agentStreaming}
          bbOpen={bbOpen}
          onToggleBb={() => setBbOpen(!bbOpen)}
        />
      </div>
      <RightPanel policyDecisions={policyDecisions} />

      {/* Blackboard Drawer (no more floating toggle – it's in InputArea toolbar) */}
      <div className={`bb-drawer ${bbOpen ? 'open' : ''}`}>
        <h3>Blackboard</h3>
        {bbGoal ? (
          <>
            <p style={{ color: 'var(--text-primary)', fontSize: 14, marginBottom: 8 }}>
              🎯 {bbGoal}
            </p>
            {bbTasks.map((t) => (
              <div className="bb-task" key={t.id}>
                <input type="checkbox" checked={t.status === 'completed'} readOnly />
                <span style={{ color: t.status === 'completed' ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  {t.description}
                </span>
              </div>
            ))}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Goal and task status will appear here during active sessions.
          </p>
        )}
      </div>
    </div>
  )
}

export default App
