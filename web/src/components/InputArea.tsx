import { useState, useRef, useCallback, useEffect } from 'react'
import { Paperclip, Send } from 'lucide-react'
import { sendRpc } from '../store/ws'
import { ModelSelector } from './ModelSelector'
import { AgentSelector, type AgentInfo } from './AgentSelector'

interface Props {
    onSend: (text: string) => void;
    disabled?: boolean;
    connected: boolean;
}

export function InputArea({ onSend, disabled, connected }: Props) {
    const [text, setText] = useState('')
    const [mode, setMode] = useState<'standard' | 'smart' | 'auto'>('smart')
    const [models, setModels] = useState<Record<string, { protocol: string, models: string[] }>>({})
    const [activeModel, setActiveModel] = useState<string>('')
    const [agents, setAgents] = useState<AgentInfo[]>([])
    const [activeAgentId, setActiveAgentId] = useState<string>('default')
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        if (!connected) return
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
    }, [connected])

    const handleModelChange = (newModel: string) => {
        setActiveModel(newModel)
        sendRpc('model:switch', { model: newModel })
    }

    const handleAgentChange = (agentId: string) => {
        setActiveAgentId(agentId)
        sendRpc('agent:switch', { agentId })
    }

    const handleSend = useCallback(() => {
        if (!text.trim() || disabled) return

        let finalPrompt = text.trim()
        if (mode === 'smart') {
            finalPrompt += '\n\n[System: Explore actively, but ask for permission before editing code. Use tool calls proactively to understand but pause before taking irreversible actions.]'
        } else if (mode === 'auto') {
            finalPrompt += '\n\n[System: Execute fully autonomously until the objective is 100% complete. Do not ask for user permission, only report when fully done.]'
        }

        onSend(finalPrompt)
        setText('')
        // 重置高度
        if (textareaRef.current) textareaRef.current.style.height = '44px'
    }, [text, disabled, onSend])

    const handleKeyDown = (e: React.KeyboardEvent) => {
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
        setText(e.target.value)
        const el = e.target
        el.style.height = '44px'
        el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    }

    return (
        <div className="input-area">
            {/* Toolbar */}
            <div className="input-toolbar">
                <button title="Attach file">
                    <Paperclip size={14} /> Attach
                </button>

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

            {/* Input Row */}
            <div className="input-row">
                <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your message... (@ for files, / for commands, + for skills)"
                    disabled={disabled}
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
