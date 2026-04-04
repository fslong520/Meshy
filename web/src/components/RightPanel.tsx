import React, { useState, useEffect } from 'react'
import { sendRpc, type PolicyDecisionEvent } from '../store/ws'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock, PreBlock } from './CodeBlock'
import { PolicyDecisionPanel } from './PolicyDecisionPanel'

type TabName = 'skills' | 'mcp' | 'soul' | 'plugins' | 'messaging';

const TABS: { key: TabName; label: string }[] = [
    { key: 'skills', label: 'Skills' },
    { key: 'mcp', label: 'MCP' },
    { key: 'soul', label: 'SOUL' },
    { key: 'plugins', label: 'Plugins' },
    { key: 'messaging', label: 'Msg' },
]

interface RightPanelProps {
    policyDecisions: PolicyDecisionEvent[]
}

export function RightPanel({ policyDecisions }: RightPanelProps) {
    const [activeTab, setActiveTab] = useState<TabName>('skills')

    return (
        <div className="right-panel">
            <PolicyDecisionPanel events={policyDecisions} />

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

interface SkillItem {
    name: string
    description: string
    keywords: string[]
    source: string
    filePath: string
}

type ScopeFilter = 'all' | 'global' | 'project'

function SkillsTab() {
    const [skills, setSkills] = useState<SkillItem[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
    const [refreshing, setRefreshing] = useState(false)
    const [showBuilderDialog, setShowBuilderDialog] = useState(false)
    const [builderPrompt, setBuilderPrompt] = useState('')

    // Skill Detail Modal States
    const [selectedSkill, setSelectedSkill] = useState<SkillItem | null>(null)
    const [selectedSkillContent, setSelectedSkillContent] = useState<string>('')
    const [editedSkillContent, setEditedSkillContent] = useState<string>('')
    const [detailViewMode, setDetailViewMode] = useState<'markdown' | 'raw' | 'edit'>('markdown')
    const [contentLoading, setContentLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        sendRpc<{ skills: SkillItem[] }>('skill:list').then(res => setSkills(res?.skills || []))
    }, [])

    // Debounced search
    const handleSearch = (q: string) => {
        setSearchQuery(q)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            if (q.trim()) {
                sendRpc<{ skills: SkillItem[] }>('skill:search', { query: q }).then(res => setSkills(res?.skills || []))
            } else {
                sendRpc<{ skills: SkillItem[] }>('skill:list').then(res => setSkills(res?.skills || []))
            }
        }, 300)
    }

    const handleRefresh = async () => {
        setRefreshing(true)
        const res = await sendRpc<{ skills: SkillItem[] }>('skill:refresh')
        if (res?.skills) setSkills(res.skills)
        setRefreshing(false)
    }

    const handleSkillClick = async (skill: SkillItem) => {
        setSelectedSkill(skill)
        setContentLoading(true)
        setDetailViewMode('markdown')
        try {
            const res = await sendRpc<{ success: boolean; content?: string }>('skill:read', { filePath: skill.filePath })
            if (res?.success && res.content) {
                setSelectedSkillContent(res.content)
                setEditedSkillContent(res.content)
            } else {
                setSelectedSkillContent('Failed to load skill content.')
                setEditedSkillContent('')
            }
        } catch (e) {
            setSelectedSkillContent('Error loading skill content.')
            setEditedSkillContent('')
        } finally {
            setContentLoading(false)
        }
    }

    const handleSaveSkill = async () => {
        if (!selectedSkill) return
        setIsSaving(true)
        try {
            const res = await sendRpc<{ success: boolean; error?: string }>('skill:write', {
                filePath: selectedSkill.filePath,
                content: editedSkillContent
            })
            if (res?.success) {
                setSelectedSkillContent(editedSkillContent)
                setDetailViewMode('markdown')
                handleRefresh() // Refresh the list to update any metadata if changed
            } else {
                alert(`Failed to save: ${res?.error || 'Unknown error'}`)
            }
        } catch (e: any) {
            alert(`Error saving skill: ${e.message}`)
        } finally {
            setIsSaving(false)
        }
    }

    const handleDeleteSkill = async () => {
        if (!selectedSkill) return
        if (!window.confirm(`Are you sure you want to delete the skill "${selectedSkill.name}"? This will delete the skill folder and cannot be undone.`)) return

        try {
            const res = await sendRpc<{ success: boolean; error?: string }>('skill:delete', {
                filePath: selectedSkill.filePath
            })
            if (res?.success) {
                setSelectedSkill(null)
                handleRefresh()
            } else {
                alert(`Failed to delete: ${res?.error || 'Unknown error'}`)
            }
        } catch (e: any) {
            alert(`Error deleting skill: ${e.message}`)
        }
    }

    const handleStartBuilder = () => {
        const prompt = builderPrompt.trim()
        if (!prompt) return
        setShowBuilderDialog(false)
        setBuilderPrompt('')
        sendRpc<{ sessionId: string }>('session:create').then(res => {
            if (res?.sessionId) {
                sendRpc('task:submit', { prompt: `@skill:skill-creator ${prompt}` })
            }
        })
    }

    const filtered = scopeFilter === 'all'
        ? skills
        : skills.filter(s => s.source === scopeFilter)

    return (
        <div>
            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
                <input
                    value={searchQuery}
                    onChange={e => handleSearch(e.target.value)}
                    placeholder="🔍 Search skills..."
                    style={{
                        flex: 1, padding: '5px 8px', borderRadius: 4,
                        border: '1px solid var(--border, #444)', background: 'var(--bg-primary, #151520)',
                        color: 'var(--text, #eee)', fontSize: 12, fontFamily: 'inherit',
                    }}
                />
                <button onClick={handleRefresh} style={iconBtnStyle} title="Refresh (rescan all skill dirs)" disabled={refreshing}>
                    {refreshing ? '⏳' : '🔄'}
                </button>
                <button onClick={() => setShowBuilderDialog(true)} style={iconBtnStyle} title="Create Skill with AI">✨</button>
            </div>

            {/* Scope Filter */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {(['all', 'global', 'project'] as ScopeFilter[]).map(scope => (
                    <button
                        key={scope}
                        onClick={() => setScopeFilter(scope)}
                        style={{
                            padding: '3px 10px', borderRadius: 12, fontSize: 11, cursor: 'pointer',
                            border: scopeFilter === scope ? '1px solid var(--accent, #6366f1)' : '1px solid var(--border, #444)',
                            background: scopeFilter === scope ? 'var(--accent-dim, rgba(99,102,241,0.15))' : 'transparent',
                            color: scopeFilter === scope ? 'var(--accent, #6366f1)' : 'var(--text-muted)',
                        }}
                    >
                        {scope === 'all' ? '📋 All' : scope === 'global' ? '🌍 Global' : '📁 Project'}
                    </button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                    {filtered.length} skill{filtered.length !== 1 ? 's' : ''}
                </span>
            </div>

            {/* List */}
            {filtered.length === 0 ? (
                <div className="tab-empty">
                    <div style={{ fontSize: 20, marginBottom: 6 }}>🧩</div>
                    <div>{searchQuery ? 'No matching skills' : 'No skills found'}</div>
                    <div style={{ marginTop: 4, fontSize: 12 }}>
                        {searchQuery ? 'Try a different keyword' : 'Click 🔄 to scan skill directories'}
                    </div>
                </div>
            ) : (
                filtered.map(s => (
                    <div
                        className="list-item"
                        key={`${s.source}:${s.name}`}
                        onClick={() => handleSkillClick(s)}
                        style={{ cursor: 'pointer' }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="list-item-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {s.name}
                                    <span style={{
                                        fontSize: 9, padding: '1px 5px', borderRadius: 3,
                                        background: s.source === 'global'
                                            ? 'rgba(251,191,36,0.15)' : 'var(--accent-dim, rgba(99,102,241,0.15))',
                                        color: s.source === 'global' ? 'var(--warning)' : 'var(--accent)',
                                    }}>
                                        {s.source === 'global' ? '🌍' : '📁'}
                                    </span>
                                </div>
                                {s.description && (
                                    <div className="list-item-desc" style={{ fontSize: 11, lineHeight: 1.4 }}>
                                        {s.description.length > 100 ? s.description.slice(0, 100) + '…' : s.description}
                                    </div>
                                )}
                                {s.keywords.length > 0 && (
                                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>
                                        {s.keywords.slice(0, 5).map(k => (
                                            <span key={k} style={{
                                                fontSize: 9, padding: '1px 5px', borderRadius: 3,
                                                background: 'var(--bg-tertiary, rgba(255,255,255,0.05))',
                                                color: 'var(--text-muted)',
                                            }}>{k}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))
            )}

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
                                fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
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

            {/* Skill Details Modal */}
            {selectedSkill && (
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                    }}
                    onClick={() => setSelectedSkill(null)}
                >
                    <div
                        style={{
                            background: 'var(--bg-secondary, #1e1e2e)',
                            border: '1px solid var(--border, #333)',
                            borderRadius: 12, padding: 0, width: '80vw', height: '80vh', maxWidth: 900,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                            display: 'flex', flexDirection: 'column'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div style={{
                            padding: '16px 24px', borderBottom: '1px solid var(--border, #333)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            flexShrink: 0
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text, #eee)' }}>
                                    {selectedSkill.name}
                                </h3>
                                <span style={{
                                    fontSize: 10, padding: '2px 6px', borderRadius: 4,
                                    background: selectedSkill.source === 'global'
                                        ? 'rgba(251,191,36,0.15)' : 'var(--accent-dim, rgba(99,102,241,0.15))',
                                    color: selectedSkill.source === 'global' ? 'var(--warning)' : 'var(--accent)',
                                }}>
                                    {selectedSkill.source === 'global' ? '🌍 Global' : '📁 Project'}
                                </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                {/* Action Buttons */}
                                {detailViewMode === 'edit' ? (
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                            onClick={() => setDetailViewMode('markdown')}
                                            style={{
                                                border: '1px solid var(--border, #444)', background: 'transparent',
                                                color: 'var(--text-muted, #888)', padding: '4px 12px', borderRadius: 4,
                                                fontSize: 12, cursor: 'pointer', transition: 'all 0.2s'
                                            }}
                                            disabled={isSaving}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSaveSkill}
                                            style={{
                                                border: 'none', background: 'var(--accent, #6366f1)',
                                                color: '#fff', padding: '4px 12px', borderRadius: 4,
                                                fontSize: 12, cursor: isSaving ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                                                opacity: isSaving ? 0.7 : 1
                                            }}
                                            disabled={isSaving}
                                        >
                                            {isSaving ? 'Saving...' : 'Save'}
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                        <button
                                            onClick={handleDeleteSkill}
                                            style={{
                                                background: 'transparent', border: 'none',
                                                color: 'var(--error, #f87171)', padding: '4px 8px', borderRadius: 4,
                                                fontSize: 12, cursor: 'pointer', transition: 'all 0.2s',
                                                display: 'flex', alignItems: 'center'
                                            }}
                                        >
                                            🗑️ Delete
                                        </button>
                                        <button
                                            onClick={() => setDetailViewMode('edit')}
                                            style={{
                                                border: '1px solid var(--accent, #6366f1)', background: 'transparent',
                                                color: 'var(--accent, #6366f1)', padding: '4px 12px', borderRadius: 4,
                                                fontSize: 12, cursor: 'pointer', transition: 'all 0.2s'
                                            }}
                                        >
                                            Edit
                                        </button>
                                        {/* View Toggle */}
                                        <div style={{ display: 'flex', background: 'var(--bg-primary, #151520)', borderRadius: 6, padding: 2 }}>
                                            <button
                                                onClick={() => setDetailViewMode('markdown')}
                                                style={{
                                                    border: 'none', background: detailViewMode === 'markdown' ? 'var(--border, #333)' : 'transparent',
                                                    color: detailViewMode === 'markdown' ? '#fff' : 'var(--text-muted, #888)',
                                                    padding: '4px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', transition: 'all 0.2s'
                                                }}
                                            >
                                                Preview
                                            </button>
                                            <button
                                                onClick={() => setDetailViewMode('raw')}
                                                style={{
                                                    border: 'none', background: detailViewMode === 'raw' ? 'var(--border, #333)' : 'transparent',
                                                    color: detailViewMode === 'raw' ? '#fff' : 'var(--text-muted, #888)',
                                                    padding: '4px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', transition: 'all 0.2s'
                                                }}
                                            >
                                                Raw
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <button
                                    onClick={() => setSelectedSkill(null)}
                                    style={{
                                        background: 'transparent', border: 'none', color: 'var(--text-muted, #888)',
                                        cursor: 'pointer', fontSize: 20, padding: 4, display: 'flex', alignItems: 'center'
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        {/* Content Body */}
                        <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column' }}>
                            {contentLoading ? (
                                <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>Loading content...</div>
                            ) : detailViewMode === 'edit' ? (
                                <textarea
                                    value={editedSkillContent}
                                    onChange={(e) => setEditedSkillContent(e.target.value)}
                                    style={{
                                        flex: 1, width: '100%', padding: 16, borderRadius: 8,
                                        background: 'var(--bg-primary, #151520)', color: 'var(--text, #eee)',
                                        border: '1px solid var(--border, #444)', fontSize: 13, lineHeight: 1.5,
                                        fontFamily: 'var(--font-mono, monospace)', resize: 'none', outline: 'none'
                                    }}
                                />
                            ) : detailViewMode === 'raw' ? (
                                <pre style={{
                                    margin: 0, padding: 16, borderRadius: 8, background: 'var(--bg-primary, #151520)',
                                    color: 'var(--text, #eee)', fontSize: 13, lineHeight: 1.5,
                                    whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)'
                                }}>
                                    {selectedSkillContent}
                                </pre>
                            ) : (
                                <div className="markdown-body" style={{ color: 'var(--text, #eee)', fontSize: 14, lineHeight: 1.6 }}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock, pre: PreBlock }}>
                                        {selectedSkillContent}
                                    </ReactMarkdown>
                                </div>
                            )}
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

function McpTab() {
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
        sendRpc<{ servers: McpServer[] }>('mcp:list').then(res => setServers(res?.servers || []))
    }, [])

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
function SoulTab() {
    const [rituals, setRituals] = useState<{ name: string, status: string, desc: string }[]>([])

    useEffect(() => {
        sendRpc<{ rituals: typeof rituals }>('ritual:status').then(res => setRituals(res?.rituals || []))
    }, [])

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
