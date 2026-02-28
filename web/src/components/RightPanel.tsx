import { useState, useEffect } from 'react'
import { sendRpc } from '../store/ws'

type TabName = 'skills' | 'mcp' | 'soul' | 'plugins' | 'messaging';

const TABS: { key: TabName; label: string }[] = [
    { key: 'skills', label: 'Skills' },
    { key: 'mcp', label: 'MCP' },
    { key: 'soul', label: 'SOUL' },
    { key: 'plugins', label: 'Plugins' },
    { key: 'messaging', label: 'Msg' },
]

export function RightPanel({ connected }: { connected: boolean }) {
    const [activeTab, setActiveTab] = useState<TabName>('skills')

    return (
        <div className="right-panel">
            {/* Tabs */}
            <div className="right-tabs">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        className={activeTab === t.key ? 'active' : ''}
                        onClick={() => setActiveTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="right-tab-content">
                {activeTab === 'skills' && <SkillsTab connected={connected} />}
                {activeTab === 'mcp' && <McpTab connected={connected} />}
                {activeTab === 'soul' && <SoulTab connected={connected} />}
                {activeTab === 'plugins' && <PlaceholderTab title="Plugins" />}
                {activeTab === 'messaging' && <PlaceholderTab title="Messaging" />}
            </div>
        </div>
    )
}

// ─── Skills Tab ───
function SkillsTab({ connected }: { connected: boolean }) {
    const [skills, setSkills] = useState<{ name: string, status: string, desc: string }[]>([])
    const [showBuilderDialog, setShowBuilderDialog] = useState(false)
    const [builderPrompt, setBuilderPrompt] = useState('')

    useEffect(() => {
        if (!connected) return
        sendRpc<{ skills: typeof skills }>('skill:list').then(res => setSkills(res?.skills || []))
    }, [connected])

    const handleStartBuilder = () => {
        const prompt = builderPrompt.trim()
        if (!prompt) return

        setShowBuilderDialog(false)
        setBuilderPrompt('')

        // Create a new isolated session, then submit the skill-creator prompt
        sendRpc<{ sessionId: string }>('session:create').then(res => {
            if (res?.sessionId) {
                sendRpc('task:submit', { prompt: `@skill:skill-creator ${prompt}` })
            }
        })
    }

    return (
        <div>
            {skills.map(s => (
                <div className="list-item" key={s.name}>
                    <div className="list-item-title">{s.name}</div>
                    <div className="list-item-desc">{s.desc}</div>
                    <span className="list-item-status" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                        {s.status}
                    </span>
                </div>
            ))}

            {/* Create Skill Button */}
            <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button
                    onClick={() => setShowBuilderDialog(true)}
                    style={{
                        padding: '6px 16px',
                        borderRadius: 4,
                        border: '1px dashed var(--border)',
                        background: 'transparent',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: 12,
                    }}
                >
                    + Create Skill
                </button>
            </div>

            {/* AI Skill Builder Dialog (Cancellable) */}
            {showBuilderDialog && (
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                    }}
                    onClick={() => setShowBuilderDialog(false)}
                >
                    <div
                        style={{
                            background: 'var(--bg-secondary, #1e1e2e)',
                            border: '1px solid var(--border, #333)',
                            borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 style={{ margin: '0 0 8px', fontSize: 16, color: 'var(--text, #eee)' }}>
                            ✨ AI Skill Builder
                        </h3>
                        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-dim, #999)', lineHeight: 1.5 }}>
                            Describe the skill you want to create. A new session will be started where the AI will interview you and build it interactively.
                        </p>
                        <textarea
                            autoFocus
                            value={builderPrompt}
                            onChange={e => setBuilderPrompt(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleStartBuilder() } }}
                            placeholder="e.g. A code reviewer that checks for security vulnerabilities in Solidity smart contracts..."
                            style={{
                                width: '100%', minHeight: 80, padding: 10, borderRadius: 8,
                                border: '1px solid var(--border, #444)', background: 'var(--bg-primary, #151520)',
                                color: 'var(--text, #eee)', fontSize: 13, resize: 'vertical',
                                fontFamily: 'inherit', lineHeight: 1.5,
                            }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                            <button
                                onClick={() => { setShowBuilderDialog(false); setBuilderPrompt('') }}
                                style={{
                                    padding: '6px 16px', borderRadius: 6,
                                    border: '1px solid var(--border, #444)', background: 'transparent',
                                    color: 'var(--text-muted, #888)', cursor: 'pointer', fontSize: 13,
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleStartBuilder}
                                disabled={!builderPrompt.trim()}
                                style={{
                                    padding: '6px 16px', borderRadius: 6, border: 'none',
                                    background: builderPrompt.trim()
                                        ? 'linear-gradient(135deg, #6366f1, #a855f7)'
                                        : 'var(--border, #333)',
                                    color: '#fff', cursor: builderPrompt.trim() ? 'pointer' : 'not-allowed',
                                    fontSize: 13, fontWeight: 500,
                                }}
                            >
                                🚀 Start
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── MCP Tab ───
function McpTab({ connected }: { connected: boolean }) {
    const [servers, setServers] = useState<{ name: string, status: string, desc: string }[]>([])

    useEffect(() => {
        if (!connected) return
        sendRpc<{ servers: typeof servers }>('mcp:list').then(res => setServers(res?.servers || []))
    }, [connected])

    return (
        <div>
            {servers.map(s => (
                <div className="list-item" key={s.name}>
                    <div className="list-item-title">{s.name}</div>
                    <div className="list-item-desc">{s.desc}</div>
                    <span
                        className="list-item-status"
                        style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                    >
                        {s.status}
                    </span>
                </div>
            ))}
            <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button
                    style={{
                        padding: '6px 16px',
                        borderRadius: 4,
                        border: '1px dashed var(--border)',
                        background: 'transparent',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: 12,
                    }}
                >
                    + Add MCP Server
                </button>
            </div>
        </div>
    )
}

// ─── SOUL Tab ───
function SoulTab({ connected }: { connected: boolean }) {
    const [rituals, setRituals] = useState<{ name: string, status: string, desc: string }[]>([])

    useEffect(() => {
        if (!connected) return
        sendRpc<{ rituals: typeof rituals }>('ritual:status').then(res => setRituals(res?.rituals || []))
    }, [connected])

    const getStatusStyle = (status: string) => {
        if (status === 'Loaded') return { background: 'var(--accent-dim)', color: 'var(--accent)' }
        if (status === 'Pending') return { background: 'rgba(251,191,36,0.15)', color: 'var(--warning)' }
        return { background: 'rgba(248,113,113,0.15)', color: 'var(--error)' }
    }

    return (
        <div>
            {rituals.map(r => (
                <div className="list-item" key={r.name}>
                    <div className="list-item-title">{r.name}</div>
                    <div className="list-item-desc">{r.desc}</div>
                    <span className="list-item-status" style={getStatusStyle(r.status)}>
                        {r.status}
                    </span>
                </div>
            ))}
        </div>
    )
}

// ─── Placeholder ───
function PlaceholderTab({ title }: { title: string }) {
    return (
        <div className="tab-empty">
            <div className="coming-soon">🚧</div>
            <div>{title}</div>
            <div style={{ marginTop: 4, fontSize: 12 }}>Coming soon</div>
        </div>
    )
}
