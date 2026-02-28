import React, { useState, useEffect } from 'react'
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

interface McpServer {
    name: string
    description: string
    status: string
    enabled: boolean
    toolsCount: number
    config: {
        name: string
        type?: 'local' | 'remote'
        command?: string
        args?: string[]
        env?: Record<string, string>
        url?: string
        description?: string
        autoStart?: boolean
        enabled?: boolean
    }
}

type McpFormMode = 'create' | 'edit'

function McpTab({ connected }: { connected: boolean }) {
    const [servers, setServers] = useState<McpServer[]>([])
    const [formMode, setFormMode] = useState<McpFormMode | null>(null)
    const [editTarget, setEditTarget] = useState<string | null>(null)

    // Form fields
    const [fName, setFName] = useState('')
    const [fType, setFType] = useState<'local' | 'remote'>('local')
    const [fCommand, setFCommand] = useState('')
    const [fArgs, setFArgs] = useState('')
    const [fUrl, setFUrl] = useState('')
    const [fDesc, setFDesc] = useState('')
    const [fAutoStart, setFAutoStart] = useState(false)
    const [fEnv, setFEnv] = useState('')

    useEffect(() => {
        if (!connected) return
        sendRpc<{ servers: McpServer[] }>('mcp:list').then(res => setServers(res?.servers || []))
    }, [connected])

    const resetForm = () => {
        setFName(''); setFType('local'); setFCommand(''); setFArgs('')
        setFUrl(''); setFDesc(''); setFAutoStart(false); setFEnv('')
        setFormMode(null); setEditTarget(null)
    }

    const buildConfig = () => {
        const config: Record<string, unknown> = {
            name: fName.trim(), type: fType, description: fDesc.trim(),
            autoStart: fAutoStart, enabled: true,
        }
        if (fType === 'local') {
            config.command = fCommand.trim()
            config.args = fArgs.split(/\s+/).filter(Boolean)
        } else {
            config.url = fUrl.trim()
        }
        if (fEnv.trim()) {
            try { config.env = JSON.parse(fEnv) } catch { /* ignore bad JSON */ }
        }
        return config
    }

    const handleCreate = async () => {
        if (!fName.trim()) return
        const res = await sendRpc<{ success: boolean; servers?: McpServer[]; error?: string }>('mcp:create', { config: buildConfig() })
        if (res?.success && res.servers) { setServers(res.servers); resetForm() }
        else alert(res?.error || 'Failed to create MCP server')
    }

    const handleUpdate = async () => {
        if (!editTarget || !fName.trim()) return
        const res = await sendRpc<{ success: boolean; servers?: McpServer[]; error?: string }>('mcp:update', { name: editTarget, config: buildConfig() })
        if (res?.success && res.servers) { setServers(res.servers); resetForm() }
        else alert(res?.error || 'Failed to update')
    }

    const handleDelete = async (name: string) => {
        if (!confirm(`Delete MCP server "${name}"?`)) return
        const res = await sendRpc<{ success: boolean; servers?: McpServer[] }>('mcp:delete', { name })
        if (res?.success && res.servers) setServers(res.servers)
    }

    const handleToggle = async (name: string, enabled: boolean) => {
        const res = await sendRpc<{ success: boolean; servers?: McpServer[] }>('mcp:toggle', { name, enabled })
        if (res?.success && res.servers) setServers(res.servers)
    }

    const handleEditOpen = (s: McpServer) => {
        setFName(s.config.name)
        setFType(s.config.type || 'local')
        setFCommand(s.config.command || '')
        setFArgs((s.config.args || []).join(' '))
        setFUrl(s.config.url || '')
        setFDesc(s.config.description || '')
        setFAutoStart(s.config.autoStart || false)
        setFEnv(s.config.env ? JSON.stringify(s.config.env, null, 2) : '')
        setFormMode('edit')
        setEditTarget(s.name)
    }

    const getStatusColor = (status: string) => {
        if (status === 'running') return { background: 'var(--accent-dim)', color: 'var(--accent)' }
        if (status === 'error') return { background: 'rgba(248,113,113,0.15)', color: 'var(--error)' }
        if (status === 'starting') return { background: 'rgba(251,191,36,0.15)', color: 'var(--warning)' }
        if (status === 'disabled') return { background: 'rgba(100,100,100,0.15)', color: 'var(--text-muted)' }
        return { background: 'rgba(100,100,100,0.15)', color: 'var(--text-muted)' }
    }

    // ── Form View (Create / Edit) ──
    if (formMode) {
        return (
            <div style={{ padding: '4px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {formMode === 'create' ? '➕ Add MCP Server' : `✏️ Edit ${editTarget}`}
                    </span>
                    <button onClick={resetForm} style={linkBtnStyle}>← Back</button>
                </div>

                <Label>Name</Label>
                <Input value={fName} onChange={e => setFName(e.target.value)} placeholder="my-server" />

                <Label>Type</Label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <TypeBtn active={fType === 'local'} onClick={() => setFType('local')}>💻 Local (stdio)</TypeBtn>
                    <TypeBtn active={fType === 'remote'} onClick={() => setFType('remote')}>🌐 Remote (URL)</TypeBtn>
                </div>

                {fType === 'local' ? (
                    <>
                        <Label>Command</Label>
                        <Input value={fCommand} onChange={e => setFCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem" />
                        <Label>Args (space-separated)</Label>
                        <Input value={fArgs} onChange={e => setFArgs(e.target.value)} placeholder="/path/to/dir" />
                    </>
                ) : (
                    <>
                        <Label>Server URL (SSE / HTTP)</Label>
                        <Input value={fUrl} onChange={e => setFUrl(e.target.value)} placeholder="http://localhost:3001/mcp" />
                    </>
                )}

                <Label>Description</Label>
                <Input value={fDesc} onChange={e => setFDesc(e.target.value)} placeholder="What this server does" />

                <Label>Environment Variables (JSON)</Label>
                <textarea
                    value={fEnv} onChange={e => setFEnv(e.target.value)}
                    placeholder='{"API_KEY": "xxx"}'
                    style={{ ...inputStyle, minHeight: 48, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 12px' }}>
                    <input type="checkbox" id="autostart" checked={fAutoStart} onChange={e => setFAutoStart(e.target.checked)} />
                    <label htmlFor="autostart" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-start on workspace load</label>
                </div>

                <button onClick={formMode === 'create' ? handleCreate : handleUpdate} style={primaryBtnStyle}>
                    {formMode === 'create' ? '✅ Create' : '💾 Save'}
                </button>
            </div>
        )
    }

    // ── List View ──
    return (
        <div>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 8 }}>
                <button onClick={() => sendRpc<{ servers: McpServer[] }>('mcp:list').then(r => setServers(r?.servers || []))} style={iconBtnStyle} title="Refresh">🔄</button>
                <button onClick={() => setFormMode('create')} style={iconBtnStyle} title="Add MCP Server">➕</button>
            </div>

            {servers.length === 0 ? (
                <div className="tab-empty">
                    <div style={{ fontSize: 20, marginBottom: 6 }}>🔌</div>
                    <div>No MCP servers configured</div>
                    <div style={{ marginTop: 4, fontSize: 12 }}>Add a local or remote MCP server</div>
                </div>
            ) : (
                servers.map(s => (
                    <div className="list-item" key={s.name} style={{ opacity: s.enabled ? 1 : 0.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="list-item-title">{s.name}</div>
                                <div className="list-item-desc" style={{ fontSize: 11 }}>
                                    {s.config.type === 'remote' ? `🌐 ${s.config.url || ''}` : `💻 ${s.config.command || ''}`}
                                </div>
                                {s.description && <div className="list-item-desc">{s.description}</div>}
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                                    <span className="list-item-status" style={getStatusColor(s.status)}>
                                        {s.status}
                                    </span>
                                    {s.toolsCount > 0 && (
                                        <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-tertiary, rgba(255,255,255,0.05))', padding: '1px 6px', borderRadius: 3 }}>
                                            🔧 {s.toolsCount}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 8, flexShrink: 0 }}>
                                {/* Toggle switch */}
                                <label style={{ position: 'relative', display: 'inline-block', width: 32, height: 18, cursor: 'pointer' }} title={s.enabled ? 'Disable' : 'Enable'}>
                                    <input type="checkbox" checked={s.enabled} onChange={() => handleToggle(s.name, !s.enabled)} style={{ opacity: 0, width: 0, height: 0 }} />
                                    <span style={{
                                        position: 'absolute', inset: 0, borderRadius: 9,
                                        background: s.enabled ? 'var(--accent, #6366f1)' : 'var(--border, #444)',
                                        transition: 'background 0.2s',
                                    }}>
                                        <span style={{
                                            position: 'absolute', top: 2, left: s.enabled ? 16 : 2,
                                            width: 14, height: 14, borderRadius: '50%', background: '#fff',
                                            transition: 'left 0.2s',
                                        }} />
                                    </span>
                                </label>
                                <button onClick={() => handleEditOpen(s)} style={iconBtnStyle} title="Edit">✏️</button>
                                <button onClick={() => handleDelete(s.name)} style={{ ...iconBtnStyle, color: 'var(--error, #f87171)' }} title="Delete">🗑️</button>
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}

// ── Shared micro-components for McpTab form ──
const Label = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 3, marginTop: 8 }}>{children}</div>
)

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} style={{ ...inputStyle, ...props.style }} />
)

const TypeBtn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} style={{
        flex: 1, padding: '5px 0', borderRadius: 4, fontSize: 12, cursor: 'pointer',
        border: active ? '1px solid var(--accent, #6366f1)' : '1px solid var(--border, #444)',
        background: active ? 'var(--accent-dim, rgba(99,102,241,0.15))' : 'transparent',
        color: active ? 'var(--accent, #6366f1)' : 'var(--text-muted)',
    }}>{children}</button>
)

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', borderRadius: 4,
    border: '1px solid var(--border, #444)', background: 'var(--bg-primary, #151520)',
    color: 'var(--text, #eee)', fontSize: 12, fontFamily: 'inherit',
    boxSizing: 'border-box',
}

const iconBtnStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: 13, padding: '2px 4px', color: 'var(--text-muted)',
}

const linkBtnStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: 12, color: 'var(--text-muted)', textDecoration: 'underline',
}

const primaryBtnStyle: React.CSSProperties = {
    width: '100%', padding: '7px 0', borderRadius: 6, border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #a855f7)',
    color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500,
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
