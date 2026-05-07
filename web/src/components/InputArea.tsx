import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Paperclip, Send } from 'lucide-react'
import { sendRpc } from '../store/ws'
import { ModelSelector } from './ModelSelector'
import { AgentSelector, type AgentInfo } from './AgentSelector'

// @ Mention item from mention:list RPC
interface MentionItem {
    namespace: 'agent' | 'skill' | 'mcp';
    name: string;
    label: string;
    description: string;
    emoji: string;
}

interface Props {
    onSend: (text: string, mode: string, attachments?: { name: string, type: string, data: string }[]) => void;
    disabled?: boolean;
    bbOpen?: boolean;
    onToggleBb?: () => void;
    modelListVersion?: number;
}

export function InputArea({ onSend, disabled, bbOpen, onToggleBb, modelListVersion }: Props) {
    const [text, setText] = useState('')
    const [attachments, setAttachments] = useState<{ name: string, type: string, data: string }[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [mode, setMode] = useState<'standard' | 'smart' | 'auto'>('smart')
    const [models, setModels] = useState<Record<string, { protocol: string, models: string[] }>>({})
    const [activeModel, setActiveModel] = useState<string>('')
    const [agents, setAgents] = useState<AgentInfo[]>([])
    const [activeAgentId, setActiveAgentId] = useState<string>('default')

    // Command Palette (Omnibar) states
    const [commands, setCommands] = useState<{ name: string, description: string }[]>([])
    const [omnibarVisible, setOmnibarVisible] = useState(false)
    const [omnibarFilter, setOmnibarFilter] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)

    // @ Mention popover states
    const [mentionItems, setMentionItems] = useState<MentionItem[]>([])
    const [mentionVisible, setMentionVisible] = useState(false)
    const [mentionQuery, setMentionQuery] = useState('') // raw text after @, e.g. 'agent:cod'
    const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)

    // ↑↓ 历史消息选择（用 ref 避免闭包问题）
    const historyRef = useRef<string[]>([])
    const historyIdxRef = useRef(-1) // -1 = 新输入, 0 = 最新, 1 = 次新...

    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        sendRpc<{ providers: Record<string, { protocol: string, models: string[] }>, defaultModel: string }>('model:list').then((res) => {
            if (res) {
                setModels(res.providers)
                setActiveModel(res.defaultModel)
            }
        })
        sendRpc<{ agents: AgentInfo[], activeAgentId: string }>('agent:list').then((res) => {
            if (res) {
                setAgents(res.agents || [])
                setActiveAgentId(res.activeAgentId || 'default')
            }
        })
        sendRpc<{ commands: { name: string, description: string }[] }>('command:list').then((res) => {
            if (res && res.commands) {
                setCommands(res.commands)
            }
        })
        sendRpc<{ items: MentionItem[] }>('mention:list').then((res) => {
            if (res && res.items) {
                setMentionItems(res.items)
            }
        })
    }, [modelListVersion]) // 当 modelListVersion 变化时重新拉取模型列表

    const handleModelChange = (newModel: string) => {
        setActiveModel(newModel)
        sendRpc('model:switch', { model: newModel })
    }

    const handleAgentChange = (agentId: string) => {
        setActiveAgentId(agentId)
        sendRpc('agent:switch', { agentId })
    }

    const handleSend = useCallback(() => {
        if ((!text.trim() && attachments.length === 0) || disabled) return

        const msg = text.trim()
        onSend(msg, mode, attachments)
        // 记入历史（不记重复、不记空，直接操作 ref）
        if (msg && (historyRef.current.length === 0 || historyRef.current[0] !== msg)) {
            historyRef.current = [msg, ...historyRef.current].slice(0, 50)
        }
        historyIdxRef.current = -1
        setText('')
        setAttachments([])
        setOmnibarVisible(false)
        setMentionVisible(false)
        setSelectedIndex(0)
        setMentionSelectedIndex(0)
        if (textareaRef.current) textareaRef.current.style.height = '44px'
    }, [text, disabled, onSend, mode, attachments])

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        if (files.length === 0) return

        const newAttachments: { name: string, type: string, data: string }[] = []
        for (const file of files) {
            const buffer = await file.arrayBuffer()
            let dataStr = ''

            if (file.type.startsWith('image/')) {
                dataStr = await new Promise((resolve) => {
                    const reader = new FileReader()
                    reader.onload = (e) => resolve(e.target?.result as string)
                    reader.readAsDataURL(file)
                })
            } else {
                dataStr = new TextDecoder().decode(buffer)
            }

            newAttachments.push({
                name: file.name,
                type: file.type || 'application/octet-stream',
                data: dataStr
            })
        }
        setAttachments(prev => [...prev, ...newAttachments])
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index))
    }

    const filteredCommands = commands.filter(c => c.name.toLowerCase().includes(omnibarFilter))

    // Namespace categories for @ first-level menu
    const NAMESPACE_CATEGORIES = [
        { namespace: 'agent', name: 'agent', label: 'Agents', emoji: '🤖', description: 'Switch or invoke an agent' },
        { namespace: 'skill', name: 'skill', label: 'Skills', emoji: '⚡', description: 'Attach a skill to context' },
        { namespace: 'mcp', name: 'mcp', label: 'MCP Servers', emoji: '🔌', description: 'Connect an MCP server' },
    ]

    // Parse mention query: determine if we're at namespace level or entity level
    const mentionParsed = useMemo(() => {
        const colonIdx = mentionQuery.indexOf(':')
        if (colonIdx >= 0) {
            const ns = mentionQuery.slice(0, colonIdx).toLowerCase()
            const entityFilter = mentionQuery.slice(colonIdx + 1).toLowerCase()
            return { namespace: ns, entityFilter }
        }
        return { namespace: null, entityFilter: mentionQuery.toLowerCase() }
    }, [mentionQuery])

    // Filtered mention items for the popover
    const filteredMentionItems = useMemo(() => {
        if (!mentionParsed.namespace) {
            // Show namespace categories filtered by input
            return NAMESPACE_CATEGORIES.filter(c =>
                c.namespace.includes(mentionParsed.entityFilter) ||
                c.label.toLowerCase().includes(mentionParsed.entityFilter)
            )
        }
        // Show entities within the selected namespace
        return mentionItems
            .filter(item => item.namespace === mentionParsed.namespace)
            .filter(item => {
                const nameMatch = item.name?.toLowerCase().includes(mentionParsed.entityFilter) ?? false;
                const labelMatch = item.label?.toLowerCase().includes(mentionParsed.entityFilter) ?? false;
                return nameMatch || labelMatch;
            })
    }, [mentionParsed, mentionItems])

    const applyCommand = (cmdName: string) => {
        setText(`/${cmdName} `)
        setOmnibarVisible(false)
        setSelectedIndex(0)
        if (textareaRef.current) {
            textareaRef.current.focus()
        }
    }

    const applyMention = (item: { namespace: string; label?: string; name?: string; emoji?: string }) => {
        if (!mentionParsed.namespace) {
            // User selected a namespace category → drill into second level
            const newText = text.replace(/@[^\s]*$/, `@${item.namespace}:`)
            setText(newText)
            setMentionQuery(`${item.namespace}:`)
            setMentionSelectedIndex(0)
            // Explicitly keep popover open for second-level display
            setMentionVisible(true)
            if (textareaRef.current) textareaRef.current.focus()
            return
        }
        // User selected a specific entity → apply and close
        const entityName = item.name || item.label || ''
        const ns = mentionParsed.namespace
        const newText = text.replace(/@[^\s]*$/, `@${ns}:${entityName} `)
        setText(newText)
        setMentionVisible(false)
        setMentionSelectedIndex(0)
        if (textareaRef.current) textareaRef.current.focus()
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Handle Omnibar keyboard navigation
        if (omnibarVisible && filteredCommands.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1))
                return
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex(prev => Math.max(prev - 1, 0))
                return
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                if (filteredCommands[selectedIndex]) {
                    applyCommand(filteredCommands[selectedIndex].name)
                }
                return
            } else if (e.key === 'Escape') {
                e.preventDefault()
                setOmnibarVisible(false)
                return
            }
        }

        // Handle @ Mention keyboard navigation
        if (mentionVisible && filteredMentionItems.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentionSelectedIndex(prev => Math.min(prev + 1, filteredMentionItems.length - 1))
                return
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionSelectedIndex(prev => Math.max(prev - 1, 0))
                return
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                if (filteredMentionItems[mentionSelectedIndex]) {
                    applyMention(filteredMentionItems[mentionSelectedIndex])
                }
                return
            } else if (e.key === 'Escape') {
                e.preventDefault()
                setMentionVisible(false)
                return
            }
        }

        // ↑↓ 历史消息导航（直接用 ref，无闭包问题）
        if (!omnibarVisible && !mentionVisible && historyRef.current.length > 0) {
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                const idx = historyIdxRef.current === -1 ? 0 : Math.min(historyIdxRef.current + 1, historyRef.current.length - 1)
                historyIdxRef.current = idx
                setText(historyRef.current[idx])
                requestAnimationFrame(() => {
                    if (textareaRef.current) {
                        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = textareaRef.current.value.length
                    }
                })
                return
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (historyIdxRef.current <= 0) {
                    historyIdxRef.current = -1
                    setText('')
                } else {
                    historyIdxRef.current--
                    setText(historyRef.current[historyIdxRef.current])
                }
                return
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const handleInterrupt = useCallback(() => {
        sendRpc('session:interrupt', {})
    }, [])

    // 自动增高
    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value
        setText(val)

        // Show omnibar if text starts with '/'
        if (val.startsWith('/')) {
            const parts = val.split(' ')
            if (parts.length === 1) {
                setOmnibarVisible(true)
                setOmnibarFilter(val.slice(1).toLowerCase())
                setSelectedIndex(0)
            } else {
                setOmnibarVisible(false)
            }
            setMentionVisible(false)
        } else {
            setOmnibarVisible(false)
        }

        // Detect @ mention trigger: find the last @ that isn't followed by a space
        const atMatch = val.match(/@([^\s]*)$/)
        if (atMatch) {
            setMentionVisible(true)
            setMentionQuery(atMatch[1])
            setMentionSelectedIndex(0)
        } else {
            setMentionVisible(false)
        }

        const el = e.target
        el.style.height = '44px'
        el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    }

    return (
        <div className="input-area">
            {attachments.length > 0 && (
                <div className="attachments-preview" style={{ padding: '8px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap', borderBottom: '1px solid #1a1a1a', background: '#0a0a0a' }}>
                    {attachments.map((att, idx) => (
                        <div key={idx} className="attachment-chip" style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '4px 8px', backgroundColor: '#1a1a1a',
                            borderRadius: '4px', fontSize: '12px', position: 'relative'
                        }}>
                            {att.type.startsWith('image/') ? (
                                <img src={att.data} alt={att.name} style={{ width: '20px', height: '20px', objectFit: 'cover', borderRadius: '2px' }} />
                            ) : (
                                <span style={{ fontSize: '14px' }}>📄</span>
                            )}
                            <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
                            <button onClick={() => removeAttachment(idx)} style={{ marginLeft: '4px', cursor: 'pointer', background: 'none', border: 'none', color: '#999', fontSize: '14px' }}>&times;</button>
                        </div>
                    ))}
                </div>
            )}
            {/* Toolbar */}
            <div className="input-toolbar">
                <button title="Attach file" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip size={14} /> Attach
                </button>
                <input
                    type="file"
                    multiple
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />

                <ModelSelector
                    providers={models}
                    activeModel={activeModel}
                    onSelect={handleModelChange}
                />

                <AgentSelector
                    agents={agents}
                    activeAgentId={activeAgentId}
                    onSelect={handleAgentChange}
                />

                <div style={{ flex: 1 }} />

                {onToggleBb && (
                    <button className="bb-toggle" onClick={onToggleBb}>
                        📋 {bbOpen ? 'Hide' : 'Blackboard'}
                    </button>
                )}

                <div className="mode-toggle">
                    <button
                        className={mode === 'standard' ? 'active' : ''}
                        onClick={() => setMode('standard')}
                        title="Standard Chat"
                    >
                        Standard
                    </button>
                    <button
                        className={mode === 'smart' ? 'active' : ''}
                        onClick={() => setMode('smart')}
                        title="Proactive with confirmations"
                    >
                        Smart✨
                    </button>
                    <button
                        className={mode === 'auto' ? 'active' : ''}
                        onClick={() => setMode('auto')}
                        title="Fully Autonomous execution"
                    >
                        Auto🚀
                    </button>
                </div>
            </div>

            {/* Omnibar Popover */}
            {omnibarVisible && filteredCommands.length > 0 && (
                <div className="omnibar-popover">
                    <ul style={{ listStyle: 'none', margin: 0, padding: '4px' }}>
                        {filteredCommands.map((cmd, i) => (
                            <li
                                key={cmd.name}
                                onClick={() => applyCommand(cmd.name)}
                                onMouseEnter={() => setSelectedIndex(i)}
                                className={i === selectedIndex ? 'selected' : ''}
                            >
                                <span className="omnibar-cmd-name">/{cmd.name}</span>
                                <span className="omnibar-cmd-desc">{cmd.description}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* @ Mention Popover */}
            {mentionVisible && filteredMentionItems.length > 0 && (
                <div className="omnibar-popover mention-popover">
                    {!mentionParsed.namespace && (
                        <div className="mention-header">Select a category</div>
                    )}
                    {mentionParsed.namespace && (
                        <div className="mention-header">
                            @{mentionParsed.namespace}: — select an item
                        </div>
                    )}
                    <ul style={{ listStyle: 'none', margin: 0, padding: '4px' }}>
                        {filteredMentionItems.map((item, i) => (
                            <li
                                key={`${item.namespace}-${item.name || item.label}`}
                                onClick={() => applyMention(item)}
                                onMouseEnter={() => setMentionSelectedIndex(i)}
                                className={i === mentionSelectedIndex ? 'selected' : ''}
                            >
                                <span className="mention-item-left">
                                    <span className="mention-emoji">{item.emoji}</span>
                                    <span className="omnibar-cmd-name">
                                        {mentionParsed.namespace
                                            ? (item as MentionItem).name
                                            : `@${item.namespace}:`
                                        }
                                    </span>
                                </span>
                                <span className="omnibar-cmd-desc">
                                    {item.description || (item as any).label || ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Input Row */}
            <div className="input-row">
                <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder={disabled ? '正在思考…（↑↓查看历史）' : '输入消息…（@=文件, /=命令, ↑↓=历史）'}
                    rows={1}
                />
                {disabled ? (
                    <button className="send-btn stop-btn" onClick={handleInterrupt} title="Stop Generation">
                        <span style={{ fontSize: '12px' }}>🛑</span>
                    </button>
                ) : (
                    <button className="send-btn" onClick={handleSend} disabled={!text.trim()}>
                        <Send size={16} />
                    </button>
                )}
            </div>
        </div>
    )
}
