import { useState } from 'react'

type TabName = 'skills' | 'mcp' | 'soul' | 'plugins' | 'messaging';

const TABS: { key: TabName; label: string }[] = [
    { key: 'skills', label: 'Skills' },
    { key: 'mcp', label: 'MCP' },
    { key: 'soul', label: 'SOUL' },
    { key: 'plugins', label: 'Plugins' },
    { key: 'messaging', label: 'Msg' },
]

export function RightPanel() {
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
                {activeTab === 'skills' && <SkillsTab />}
                {activeTab === 'mcp' && <McpTab />}
                {activeTab === 'soul' && <SoulTab />}
                {activeTab === 'plugins' && <PlaceholderTab title="Plugins" />}
                {activeTab === 'messaging' && <PlaceholderTab title="Messaging" />}
            </div>
        </div>
    )
}

// ─── Skills Tab ───
function SkillsTab() {
    return (
        <div>
            <div className="list-item">
                <div className="list-item-title">code-review</div>
                <div className="list-item-desc">Review code with best practices</div>
                <span className="list-item-status" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                    Active
                </span>
            </div>
            <div className="list-item">
                <div className="list-item-title">deep-research</div>
                <div className="list-item-desc">Multi-step web research agent</div>
                <span className="list-item-status" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                    Active
                </span>
            </div>
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
function McpTab() {
    return (
        <div>
            <div className="list-item">
                <div className="list-item-title">filesystem</div>
                <div className="list-item-desc">Local file operations</div>
                <span
                    className="list-item-status"
                    style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                >
                    Connected
                </span>
            </div>
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
function SoulTab() {
    return (
        <div>
            <div className="list-item">
                <div className="list-item-title">SOUL.md</div>
                <div className="list-item-desc">Agent identity and behavioral rules</div>
                <span className="list-item-status" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                    Loaded
                </span>
            </div>
            <div className="list-item">
                <div className="list-item-title">HEARTBEAT.md</div>
                <div className="list-item-desc">Self-verification ritual checkpoint</div>
                <span className="list-item-status" style={{ background: 'rgba(251,191,36,0.15)', color: 'var(--warning)' }}>
                    Pending
                </span>
            </div>
            <div className="list-item">
                <div className="list-item-title">BOOTSTRAP.md</div>
                <div className="list-item-desc">Session initialization script</div>
                <span className="list-item-status" style={{ background: 'rgba(248,113,113,0.15)', color: 'var(--error)' }}>
                    Not Found
                </span>
            </div>
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
