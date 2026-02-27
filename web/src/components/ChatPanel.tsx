import { useRef, useEffect, useState, useCallback } from 'react'
import { Search, ChevronUp, ChevronDown } from 'lucide-react'
import type { ChatMessage } from '../store/ws'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
    messages: ChatMessage[];
    onApproval: (id: string, approved: boolean) => void;
}

export function ChatPanel({ messages, onApproval }: Props) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

    // 自动滚动到底部
    useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages])

    // 用户消息快速跳转

    const jumpToUserMsg = useCallback(
        (direction: 'up' | 'down') => {
            const el = scrollRef.current
            if (!el) return

            const msgElements = el.querySelectorAll('.chat-msg.user')
            if (msgElements.length === 0) return

            const currentScroll = el.scrollTop
            const targets = Array.from(msgElements).map((e) => (e as HTMLElement).offsetTop)

            if (direction === 'up') {
                const prev = targets.reverse().find((t) => t < currentScroll - 10)
                if (prev !== undefined) el.scrollTo({ top: prev - 8, behavior: 'smooth' })
            } else {
                const next = targets.find((t) => t > currentScroll + 50)
                if (next !== undefined) el.scrollTo({ top: next - 8, behavior: 'smooth' })
            }
        },
        [],
    )

    const toggleTool = (key: string) => {
        setExpandedTools((prev) => {
            const next = new Set(prev)
            next.has(key) ? next.delete(key) : next.add(key)
            return next
        })
    }

    // 搜索过滤高亮
    const highlightText = (text: string) => {
        if (!searchTerm) return text
        const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
        return text.replace(regex, '**$1**')
    }

    return (
        <>
            {/* 搜索栏 */}
            <div className="chat-search-bar">
                <Search size={16} />
                <input
                    type="text"
                    placeholder="Search messages..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button title="Previous user message" onClick={() => jumpToUserMsg('up')}>
                    <ChevronUp size={18} />
                </button>
                <button title="Next user message" onClick={() => jumpToUserMsg('down')}>
                    <ChevronDown size={18} />
                </button>
            </div>

            {/* 消息流 */}
            <div className="chat-messages" ref={scrollRef}>
                {messages.length === 0 && (
                    <div style={{
                        textAlign: 'center',
                        paddingTop: 120,
                        animation: 'fadeIn 0.8s ease',
                    }}>
                        <div style={{ fontSize: 48, marginBottom: 12, filter: 'drop-shadow(0 0 8px rgba(74,222,128,0.3))' }}>🤖</div>
                        <div style={{
                            fontSize: 18,
                            fontWeight: 600,
                            background: 'linear-gradient(135deg, #4ade80, #38bdf8)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            marginBottom: 8,
                        }}>
                            Start a conversation
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
                            Type a message below, or use <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>/help</code> for commands
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 16, opacity: 0.6 }}>
                            <kbd style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 11 }}>Enter</kbd> to send
                            &nbsp;·&nbsp;
                            <kbd style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 11 }}>Shift+Enter</kbd> for new line
                        </div>
                    </div>
                )}

                {messages.map((msg, i) => {
                    // 搜索过滤
                    if (searchTerm && !msg.content.toLowerCase().includes(searchTerm.toLowerCase())) {
                        return null
                    }

                    return (
                        <div key={msg.id || i} className={`chat-msg ${msg.role}`}>
                            {/* 思考过程 (DeepSeek-Reasoner) */}
                            {msg.reasoningContent && (
                                <details className="reasoning-block">
                                    <summary>🤔 Thinking Process</summary>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {msg.reasoningContent}
                                    </ReactMarkdown>
                                </details>
                            )}

                            {/* 文本内容 */}
                            {msg.content && (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {searchTerm ? highlightText(msg.content) : msg.content}
                                </ReactMarkdown>
                            )}

                            {/* Tool Call卡片 - Inline/Block 风格 */}
                            {msg.toolCalls?.map((tc, j) => {
                                const key = `${msg.id}-tool-${j}`
                                const isRunning = tc.status === 'running'
                                const isError = tc.status === 'error'

                                // Auto Approve 提示 (inline, muted)
                                const approvalNotice = tc.approvalReason && (
                                    <div className="tool-approval-notice">
                                        <span className="icon">🛡️</span> [AI Approved] {tc.approvalReason}
                                    </div>
                                )

                                // Inline 模式 (Running)
                                if (isRunning) {
                                    return (
                                        <div key={key} className="tool-inline pulse">
                                            {approvalNotice}
                                            <span className="icon">⚙</span>
                                            <span className="tool-name">[Running] {tc.name}</span>
                                            <span className="tool-args">{tc.args.length > 50 ? tc.args.slice(0, 50) + '...' : tc.args}</span>
                                        </div>
                                    )
                                }

                                // Block 模式 (Done / Error)
                                const expanded = expandedTools.has(key)
                                return (
                                    <div key={key} className={`tool-block ${tc.status}`} onClick={() => toggleTool(key)}>
                                        {approvalNotice}
                                        <div className="tool-block-header">
                                            <span className="icon">{isError ? '⚠️' : '✓'}</span>
                                            <span className="tool-title"># {tc.name} {isError ? '(Failed)' : '(Success)'}</span>
                                            <span className="tool-expander">{expanded ? '▼' : '▶'}</span>
                                        </div>
                                        {expanded && (
                                            <div className="tool-block-body" onClick={(e) => e.stopPropagation()}>
                                                <div className="arg-box"><strong>Input:</strong> {tc.args}</div>
                                                {tc.result && <div className="result-box"><strong>Output:</strong> {tc.result}</div>}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}

                            {/* 审批卡片 */}
                            {msg.approval && !msg.approval.resolved && (
                                <div className="approval-card">
                                    <p>🔒 {msg.approval.question}</p>
                                    {msg.approval.context && (
                                        <pre style={{ fontSize: 12, marginBottom: 8 }}>{msg.approval.context}</pre>
                                    )}
                                    <div className="approval-actions">
                                        <button className="btn-approve" onClick={() => onApproval(msg.approval!.id, true)}>
                                            ✅ Approve
                                        </button>
                                        <button className="btn-reject" onClick={() => onApproval(msg.approval!.id, false)}>
                                            ❌ Reject
                                        </button>
                                    </div>
                                </div>
                            )}
                            {msg.approval?.resolved && (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                    ✓ Approval resolved
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </>
    )
}
