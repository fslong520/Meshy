import { useState, useRef, useCallback, useEffect } from 'react'
import { Paperclip, Send } from 'lucide-react'
import { sendRpc } from '../store/ws'
import { ModelSelector } from './ModelSelector'

interface Props {
    onSend: (text: string) => void;
    disabled?: boolean;
    connected: boolean;
}

export function InputArea({ onSend, disabled, connected }: Props) {
    const [text, setText] = useState('')
    const [mode, setMode] = useState<'plan' | 'build'>('build')
    const [models, setModels] = useState<Record<string, { protocol: string, models: string[] }>>({})
    const [activeModel, setActiveModel] = useState<string>('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        if (!connected) return
        sendRpc<{ providers: Record<string, { protocol: string, models: string[] }>, defaultModel: string }>('model:list').then((res) => {
            if (res) {
                setModels(res.providers)
                setActiveModel(res.defaultModel)
            }
        })
    }, [connected])

    const handleModelChange = (newModel: string) => {
        setActiveModel(newModel)
        sendRpc('model:switch', { model: newModel })
    }

    const handleSend = useCallback(() => {
        if (!text.trim() || disabled) return
        const finalPrompt = mode === 'plan' ? `/plan ${text.trim()}` : text.trim()
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

                <select title="Select agent">
                    <option>@Manager</option>
                </select>

                <div style={{ flex: 1 }} />

                <div className="mode-toggle">
                    <button
                        className={mode === 'plan' ? 'active' : ''}
                        onClick={() => setMode('plan')}
                    >
                        Plan
                    </button>
                    <button
                        className={mode === 'build' ? 'active' : ''}
                        onClick={() => setMode('build')}
                    >
                        Build
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
