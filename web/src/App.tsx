import { useState, useCallback } from 'react'
import { useWebSocket, useEvent, sendRpc, type ChatMessage, type RpcMessage } from './store/ws'
import { LeftSidebar } from './components/LeftSidebar'
import { ChatPanel } from './components/ChatPanel'
import { RightPanel } from './components/RightPanel'
import { InputArea } from './components/InputArea'

// ─── Replay 类型定义 ───

interface ReplayStep {
  index: number;
  role: 'system' | 'user' | 'assistant';
  type: 'text' | 'tool_call' | 'tool_result';
  summary: string;
  raw: unknown; // Added 'raw' type
}

interface ReplayExport {
  sessionId: string;
  totalSteps: number;
  steps: ReplayStep[];
  blackboard: {
    currentGoal: string;
    tasks: Array<{ id: string; description: string; status: string }>;
  };
}

/**
 * 将 Replay 步骤转换为 ChatMessage 数组，用于在 ChatPanel 中回放历史。
 */
function replayToMessages(replay: ReplayExport): ChatMessage[] {
  const messages: ChatMessage[] = []

  for (const step of replay.steps) {
    if (step.role === 'system') continue // 跳过 system prompt

    const role: 'user' | 'agent' = step.role === 'user' && step.type === 'text' ? 'user' : 'agent'

    if (step.type === 'tool_call') {
      // 附加到最后一个 agent 消息
      const last = messages[messages.length - 1]
      if (last?.role === 'agent') {
        const toolCalls = last.toolCalls || []
        toolCalls.push({ id: `mock-${Date.now()}-${Math.random()}`, name: step.summary.replace(/^Tool: /, ''), args: '', status: 'done' })
        last.toolCalls = toolCalls
      }
      continue
    }

    if (step.type === 'tool_result' && step.role === 'user') {
      // tool_result 属于 user 角色但实际上是 tool 回复，附加到最后一个 agent
      const last = messages[messages.length - 1]
      if (last?.role === 'agent' && last.toolCalls) {
        const lastTc = last.toolCalls[last.toolCalls.length - 1]
        if (lastTc) lastTc.result = step.summary.replace(/^Result: /, '')
      }
      continue
    }

    messages.push({
      id: `replay-${step.index}`,
      role,
      content: step.type === 'text' ? (step.raw as string) : step.summary,
      timestamp: Date.now(),
    })
  }

  return messages
}

function App() {
  const { connected } = useWebSocket()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [bbOpen, setBbOpen] = useState(false)
  const [bbGoal, setBbGoal] = useState('')
  const [bbTasks, setBbTasks] = useState<Array<{ id: string; description: string; status: string }>>([])
  const [agentStreaming, setAgentStreaming] = useState(false)

  // 接收 Agent 流式文本
  useEvent('agent:text', (msg: RpcMessage) => {
    const chunk = msg.data as { text: string; id: string }
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'agent' && last.id === chunk.id) {
        return [...prev.slice(0, -1), { ...last, content: last.content + chunk.text }]
      }
      return [...prev, { id: chunk.id, role: 'agent', content: chunk.text, timestamp: Date.now() }]
    })
    setAgentStreaming(true)
  })

  // Agent 完成
  useEvent('agent:done', () => {
    setAgentStreaming(false)
  })

  // Tool Call 通知
  useEvent('agent:tool_call', (msg: RpcMessage) => {
    const data = msg.data as { name: string; args: string; id: string }
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'agent') {
        const existingToolCalls = last.toolCalls || []
        const existingIndex = existingToolCalls.findIndex(tc => tc.id === data.id)

        let newToolCalls;
        if (existingIndex >= 0) {
          // Update existing tool call args
          newToolCalls = [...existingToolCalls];
          newToolCalls[existingIndex] = { ...newToolCalls[existingIndex], args: data.args || '' }
        } else {
          // Add new tool call
          newToolCalls = [...existingToolCalls, { id: data.id, name: data.name, args: data.args || '', status: 'running' as const }]
        }

        return [...prev.slice(0, -1), { ...last, toolCalls: newToolCalls }]
      }
      return prev
    })
  })

  // Tool Call 结果
  useEvent('agent:tool_result', (msg: RpcMessage) => {
    const data = msg.data as { id: string; name: string; result: string }
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'agent' && last.toolCalls) {
        const toolCalls = last.toolCalls.map((tc) =>
          tc.id === data.id && tc.status === 'running'
            ? { ...tc, result: data.result, status: 'done' as const }
            : tc,
        )
        return [...prev.slice(0, -1), { ...last, toolCalls }]
      }
      return prev
    })
  })

  // 错误通知（Sandbox 拒绝 / 工具执行失败）
  useEvent('agent:error', (msg: RpcMessage) => {
    const data = msg.data as { id?: string; tool?: string; error?: string; reason?: string }
    const errorText = data.reason || data.error || 'Unknown error'
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'agent') {
        const toolCalls = (last.toolCalls || []).map((tc) =>
          (data.id ? tc.id === data.id : tc.name === data.tool) && tc.status === 'running'
            ? { ...tc, result: `⚠️ ${errorText}`, status: 'error' as const }
            : tc,
        )
        return [...prev.slice(0, -1), { ...last, toolCalls }]
      }
      return [
        ...prev,
        { id: `error-${Date.now()}`, role: 'agent', content: `⚠️ Error: ${errorText}`, timestamp: Date.now() },
      ]
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

  // 发送消息
  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim()) return

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, userMsg])

      // 通过 RPC 提交任务
      sendRpc('task:submit', { prompt: text })
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
  const handleSessionSwitch = useCallback((sessionId: string) => {
    sendRpc<{ success: boolean; replay?: ReplayExport }>('session:switch', { sessionId }).then((res) => {
      if (res?.success && res.replay) {
        const historicalMessages = replayToMessages(res.replay)
        setMessages(historicalMessages)
        setBbGoal(res.replay.blackboard.currentGoal)
        setBbTasks(res.replay.blackboard.tasks)
      } else {
        // 新 session，清空消息
        setMessages([])
        setBbGoal('')
        setBbTasks([])
      }
    })
  }, [])

  return (
    <div className="app-layout">
      <LeftSidebar connected={connected} onSessionSwitch={handleSessionSwitch} />
      <div className="center-panel">
        <ChatPanel messages={messages} onApproval={handleApproval} />
        <InputArea onSend={handleSend} disabled={agentStreaming} connected={connected} />
      </div>
      <RightPanel connected={connected} />

      {/* Blackboard 浮动按钮 */}
      <button className="bb-toggle" onClick={() => setBbOpen(!bbOpen)}>
        📋 {bbOpen ? 'Hide' : 'Blackboard'}
      </button>
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
