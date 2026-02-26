import { useState, useCallback } from 'react'
import { useWebSocket, useEvent, sendRpc, type ChatMessage, type RpcMessage } from './store/ws'
import { LeftSidebar } from './components/LeftSidebar'
import { ChatPanel } from './components/ChatPanel'
import { RightPanel } from './components/RightPanel'
import { InputArea } from './components/InputArea'

function App() {
  const { connected } = useWebSocket()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [bbOpen, setBbOpen] = useState(false)
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
        const toolCalls = [...(last.toolCalls || []), { name: data.name, args: data.args, status: 'running' as const }]
        return [...prev.slice(0, -1), { ...last, toolCalls }]
      }
      return prev
    })
  })

  // Tool Call 结果
  useEvent('agent:tool_result', (msg: RpcMessage) => {
    const data = msg.data as { name: string; result: string }
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'agent' && last.toolCalls) {
        const toolCalls = last.toolCalls.map((tc) =>
          tc.name === data.name && tc.status === 'running'
            ? { ...tc, result: data.result, status: 'done' as const }
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

  return (
    <div className="app-layout">
      <LeftSidebar connected={connected} />
      <div className="center-panel">
        <ChatPanel messages={messages} onApproval={handleApproval} />
        <InputArea onSend={handleSend} disabled={agentStreaming} />
      </div>
      <RightPanel />

      {/* Blackboard 浮动按钮 */}
      <button className="bb-toggle" onClick={() => setBbOpen(!bbOpen)}>
        📋 {bbOpen ? 'Hide' : 'Blackboard'}
      </button>
      <div className={`bb-drawer ${bbOpen ? 'open' : ''}`}>
        <h3>Blackboard</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Goal and task status will appear here during active sessions.
        </p>
      </div>
    </div>
  )
}

export default App
