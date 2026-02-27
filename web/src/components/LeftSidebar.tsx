import { useState, useEffect, useCallback } from 'react'
import { sendRpc } from '../store/ws'
import { Settings, Plus, MessageSquare } from 'lucide-react'

interface SessionInfo {
    id: string;
    title?: string;
    status: string;
    updatedAt: string;
    goal: string;
    messageCount: number;
}

interface Props {
    connected: boolean;
    onSessionSwitch?: (sessionId: string) => void;
}

export function LeftSidebar({ connected, onSessionSwitch }: Props) {
    const [sessions, setSessions] = useState<SessionInfo[]>([])
    const [activeSession, setActiveSession] = useState<string | null>(null)
    const [workspaces, setWorkspaces] = useState<string[]>([])
    const [activeWorkspace, setActiveWorkspace] = useState<string>('')

    const refreshSessions = useCallback(() => {
        if (!connected) return
        sendRpc<{ sessions: SessionInfo[] }>('session:list').then((res) => {
            if (res?.sessions) setSessions(res.sessions)
        })
    }, [connected])

    const refreshWorkspaces = useCallback(() => {
        if (!connected) return
        sendRpc<{ workspaces: string[] }>('workspace:list').then((res) => {
            if (res && res.workspaces) {
                setWorkspaces(res.workspaces)
                if (!activeWorkspace && res.workspaces.length > 0) {
                    setActiveWorkspace(res.workspaces[res.workspaces.length - 1])
                }
            }
        })
    }, [connected, activeWorkspace])

    useEffect(() => {
        refreshSessions()
        refreshWorkspaces()
    }, [refreshSessions, refreshWorkspaces])

    const handleNewSession = useCallback(() => {
        sendRpc<{ sessionId: string; sessions: SessionInfo[] }>('session:create').then((res) => {
            if (res) {
                setActiveSession(res.sessionId)
                setSessions(res.sessions)
                onSessionSwitch?.(res.sessionId)
            }
        })
    }, [onSessionSwitch])

    const handleSwitchSession = useCallback((sessionId: string) => {
        setActiveSession(sessionId)
        onSessionSwitch?.(sessionId)
    }, [onSessionSwitch])

    const formatTime = (iso: string) => {
        if (!iso || iso === 'unknown') return ''
        try {
            return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        } catch { return '' }
    }

    const handleWorkspaceChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value
        if (val === '__add_new__') {
            const newPath = window.prompt('Enter absolute path to new workspace directory:')
            if (newPath) {
                const res = await sendRpc<{ success: boolean; error?: string }>('workspace:add', { path: newPath })
                if (res.success) {
                    refreshWorkspaces()
                } else {
                    alert(`Failed to add workspace: ${res.error}`)
                }
            }
            // Reset select back to current active workspace
            e.target.value = activeWorkspace
            return
        }

        const res = await sendRpc<{ success: boolean; sessionId: string; error?: string }>('workspace:switch', { targetPath: val })
        if (res.success) {
            setActiveWorkspace(val)
            setActiveSession(res.sessionId)
            refreshSessions()
            onSessionSwitch?.(res.sessionId) // Triggers ChatPanel reset
        } else {
            alert(`Failed to switch workspace: ${res.error}`)
        }
    }

    return (
        <div className="left-sidebar">
            {/* Header */}
            <div className="sidebar-header">
                <span className={`status-dot ${connected ? 'connected' : ''}`} />
                <h1>Meshy</h1>
            </div>

            {/* Workspace */}
            <div className="sidebar-section">
                <div className="sidebar-section-title">Workspace</div>
                <select value={activeWorkspace} onChange={handleWorkspaceChange} style={{
                    width: '100%', padding: '6px', fontSize: '13px', background: 'var(--bg-subtle)',
                    color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '4px',
                    wordBreak: 'break-all'
                }}>
                    <option value="" disabled>Select a Workspace</option>
                    {workspaces.map(w => (
                        <option key={w} value={w}>{w}</option>
                    ))}
                    <option value="__add_new__">+ Add Workspace...</option>
                </select>
            </div>

            {/* Sessions */}
            <div className="sidebar-section">
                <div className="sidebar-section-title">Sessions ({sessions.length})</div>
            </div>
            <div className="session-list">
                {sessions.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 12px' }}>
                        No sessions yet
                    </div>
                )}
                {sessions.map((s) => (
                    <div
                        key={s.id}
                        className={`session-item ${activeSession === s.id ? 'active' : ''}`}
                        onClick={() => handleSwitchSession(s.id)}
                        title={`${s.title || s.goal || s.id}\n${s.messageCount} messages • ${s.status}`}
                    >
                        <MessageSquare size={14} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {s.title ? s.title : (s.goal && s.goal !== '(no goal)' ? s.goal : s.id.slice(0, 12) + '...')}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {s.messageCount} msgs • {formatTime(s.updatedAt)}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <button className="new-session-btn" onClick={handleNewSession}>
                <Plus size={14} style={{ marginRight: 4 }} /> New Session
            </button>

            {/* Footer */}
            <div className="sidebar-footer">
                <button>
                    <Settings size={14} /> Settings
                </button>
            </div>
        </div>
    )
}
