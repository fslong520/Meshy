import { useState, useRef, useCallback } from 'react'
import { Paperclip, Send } from 'lucide-react'

interface Props {
    onSend: (text: string) => void;
    disabled?: boolean;
}

export function InputArea({ onSend, disabled }: Props) {
    const [text, setText] = useState('')
    const [mode, setMode] = useState<'plan' | 'build'>('build')
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const handleSend = useCallback(() => {
        if (!text.trim() || disabled) return
        onSend(text.trim())
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

                <select title="Select model">
                    <option>🤖 Default Model</option>
                </select>

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
                <button className="send-btn" onClick={handleSend} disabled={disabled || !text.trim()}>
                    <Send size={16} />
                </button>
            </div>
        </div>
    )
}
