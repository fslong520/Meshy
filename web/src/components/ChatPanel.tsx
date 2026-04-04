import { useRef, useEffect, useState, useCallback } from 'react'
import { Search, ChevronUp, ChevronDown, MoreVertical, Edit2, Trash2, Minimize2 } from 'lucide-react'
import { useWebSocket, useEvent, type ChatMessage } from '../store/ws'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock, PreBlock } from './CodeBlock'
import { ToolPolicyDecisionBadge } from './ToolPolicyDecisionBadge'

interface Props {
    messages: ChatMessage[];
    onApproval: (id: string, approved: boolean) => void;
    activeSession: { id: string; title?: string } | null;
    onSessionAction: (action: 'rename' | 'compact' | 'delete', payload?: any) => void;
}

export function ChatPanel({ messages, onApproval, activeSession, onSessionAction }: Props) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

    // Workspace & Session State
    const { sendRpc } = useWebSocket()
    const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [isRenaming, setIsRenaming] = useState(false)
    const [renameTitle, setRenameTitle] = useState('')
    const menuRef = useRef<HTMLDivElement>(null)

    // Fetch initial workspace
    useEffect(() => {
        sendRpc<{ activeWorkspace?: string }>('workspace:list').then(res => {
            if (res && res.activeWorkspace) {
                setActiveWorkspace(res.activeWorkspace)
            }
        })
    }, [sendRpc])

    // Listen for workspace switches
    useEvent('workspace:list', (msg: any) => {
        if (msg.data && msg.data.activeWorkspace) {
            setActiveWorkspace(msg.data.activeWorkspace)
        }
    })

    // Handle outside click for menu
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false)
            }
        }
        if (menuOpen) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [menuOpen])

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

    // 回车保存 Rename
    const handleRenameSubmit = () => {
        if (renameTitle.trim() && activeSession) {
            onSessionAction('rename', { title: renameTitle.trim() })
        }
        setIsRenaming(false)
    }

    // 搜索过滤高亮
    const highlightText = (text: string) => {
        if (!searchTerm) return text
        const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
        return text.replace(regex, '**$1**')
    }

    // Helper: Determine message status for minimap
    const getMessageStatus = (msg: ChatMessage): string => {
        if (msg.role === 'user') return 'msg-user'
        if (msg.approval && !msg.approval.resolved) return 'msg-approval'
        
        let hasError = false
        let hasRunning = false
        let hasSuccess = false

        if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const tc of msg.toolCalls) {
                if (tc.status === 'error') hasError = true
                else if (tc.status === 'running') hasRunning = true
                else if (tc.status === 'done') hasSuccess = true
            }
        }

        if (hasError) return 'msg-error'
        if (hasRunning) return 'msg-running'
        if (hasSuccess) return 'msg-success'
        
        return 'msg-assistant'
    }

    const scrollToMessage = (id: string) => {
        const el = document.getElementById(id)
        if (el && scrollRef.current) {
            // Calculate relative offset to scroll container
            const containerTop = scrollRef.current.scrollTop
            const containerScrollTop = scrollRef.current.getBoundingClientRect().top
            const elementTop = el.getBoundingClientRect().top
            
            // smooth scroll
            scrollRef.current.scrollTo({
                top: containerTop + elementTop - containerScrollTop - 20,
                behavior: 'smooth'
            })
        }
    }

    return (
        <div className="chat-panel-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Session Header */}
            {activeSession && (
                <div className="chat-session-header">
                    <div className="session-header-left">
                        {isRenaming ? (
                            <input
                                autoFocus
                                type="text"
                                className="rename-input"
                                value={renameTitle}
                                onChange={e => setRenameTitle(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') handleRenameSubmit()
                                    if (e.key === 'Escape') setIsRenaming(false)
                                }}
                                onBlur={handleRenameSubmit}
                            />
                        ) : (
                            <div className="session-title">
                                {activeSession.title || activeSession.id}
                            </div>
                        )}
                    </div>

                    <div className="session-header-right" ref={menuRef}>
                        <button
                            className={`session-menu-trigger ${menuOpen ? 'active' : ''}`}
                            onClick={() => setMenuOpen(!menuOpen)}
                            title="Session options"
                        >
                            <MoreVertical size={20} />
                        </button>

                        {menuOpen && (
                            <div className="dropdown-menu">
                                <button className="menu-item" onClick={() => {
                                    onSessionAction('compact')
                                    setMenuOpen(false)
                                }}>
                                    <Minimize2 size={14} />
                                    <span>Compact Context</span>
                                </button>
                                <button className="menu-item" onClick={() => {
                                    setRenameTitle(activeSession.title || activeSession.id)
                                    setIsRenaming(true)
                                    setMenuOpen(false)
                                }}>
                                    <Edit2 size={14} />
                                    <span>Rename Session</span>
                                </button>
                                <div className="menu-divider" />
                                <button className="menu-item danger" onClick={() => {
                                    if (confirm('Are you sure you want to delete this session? This action cannot be undone.')) {
                                        onSessionAction('delete')
                                    }
                                    setMenuOpen(false)
                                }}>
                                    <Trash2 size={14} />
                                    <span>Delete Session</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

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

            {/* Chat Minimap */}
            {messages.length > 0 && (
                <div className="chat-minimap-container">
                    {messages.map((msg, i) => {
                        const domId = `msg-${msg.id || i}`
                        const statusClass = getMessageStatus(msg)
                        return (
                            <div 
                                key={`minimap-${msg.id || i}`} 
                                className={`minimap-sq ${statusClass}`}
                                title={`${msg.role} message`}
                                onClick={() => scrollToMessage(domId)}
                            />
                        )
                    })}
                </div>
            )}

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
                        <div id={`msg-${msg.id || i}`} key={msg.id || i} className={`chat-msg ${msg.role}`}>
                            {/* 思考过程 (DeepSeek-Reasoner) */}
                            {msg.reasoningContent && (
                                <details className="reasoning-block">
                                    <summary>🤔 Thinking Process</summary>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock, pre: PreBlock }}>
                                        {msg.reasoningContent}
                                    </ReactMarkdown>
                                </details>
                            )}

                            {/* 文本内容 */}
                            {msg.content && (
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock, pre: PreBlock }}>
                                    {searchTerm ? highlightText(msg.content) : msg.content}
                                </ReactMarkdown>
                            )}

                            {/* Attachments preview */}
                            {msg.attachments && msg.attachments.length > 0 && (
                                <div className="message-attachments" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                                    {msg.attachments.map((att, idx) => (
                                        <div key={idx} style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            padding: '4px 8px', backgroundColor: 'var(--bg-tertiary)',
                                            borderRadius: '4px', fontSize: '12px', border: '1px solid var(--border)'
                                        }}>
                                            {att.type.startsWith('image/') ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={att.data} alt={att.name} style={{ width: '20px', height: '20px', objectFit: 'cover', borderRadius: '2px' }} />
                                            ) : (
                                                <span style={{ fontSize: '14px' }}>📄</span>
                                            )}
                                            <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{att.name}</span>
                                        </div>
                                    ))}
                                </div>
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

                                // 解析参数以提取内联显示内容
                                let toolTarget = '';
                                try {
                                    if (tc.args) {
                                        const parsedArgs = JSON.parse(tc.args);
                                        const toolLower = tc.name.toLowerCase();

                                        // 处理文件路径展示
                                        const extractPath = (p: string) => {
                                            if (!p) return '';
                                            const ws = activeWorkspace || '';
                                            // 统一路径分隔符进行比较
                                            const normP = p.replace(/\\/g, '/');
                                            const normWs = ws.replace(/\\/g, '/');

                                            if (normP.startsWith(normWs)) {
                                                const rel = normP.slice(normWs.length);
                                                return rel.startsWith('/') ? rel.slice(1) : rel;
                                            }
                                            return p;
                                        }

                                        if (toolLower.includes('read') || toolLower.includes('write') || toolLower.includes('edit')) {
                                            toolTarget = extractPath(parsedArgs.filePath || parsedArgs.path || '');
                                        } else if (toolLower.includes('command') || toolLower.includes('bash')) {
                                            toolTarget = parsedArgs.commandLine || parsedArgs.command || '';
                                        } else if (toolLower.includes('search') || toolLower.includes('grep')) {
                                            toolTarget = `"${parsedArgs.query || parsedArgs.pattern || ''}"`;
                                        }
                                    }
                                } catch (e) {
                                    // 忽略解析错误，保持默认
                                }

                                const displayTarget = toolTarget ? ` ` + toolTarget : '';

                                // Inline 模式 (Running)
                                if (isRunning) {
                                    return (
                                        <div key={key} className="tool-inline pulse">
                                            {approvalNotice}
                                            <span className="icon">⚙</span>
                                            <span className="tool-name">[Running] {tc.name}</span>
                                            {toolTarget && <span className="tool-target" style={{ marginLeft: 6, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.9em' }}>{displayTarget}</span>}
                                            <ToolPolicyDecisionBadge decision={tc.policyDecision} />
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
                                            <span className="tool-title"># {tc.name}{toolTarget && <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontWeight: 400, fontFamily: 'var(--font-mono)', fontSize: '0.95em' }}>{displayTarget}</span>} {isError ? '(Failed)' : '(Success)'}</span>
                                            <span className="tool-expander">{expanded ? '▼' : '▶'}</span>
                                        </div>
                                        {expanded && (
                                            <div className="tool-block-body" onClick={(e) => e.stopPropagation()}>
                                                <ToolPolicyDecisionBadge decision={tc.policyDecision} />
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
        </div>
    )
}
