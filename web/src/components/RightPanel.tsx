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

    useEffect(() => {
        if (!connected) return
        sendRpc<{ skills: typeof skills }>('skill:list').then(res => setSkills(res?.skills || []))
    }, [connected])

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
                    + Create Skill
                </button>
            </div>
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
