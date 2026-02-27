import { useState, useEffect, useCallback } from 'react'
import { sendRpc } from '../store/ws'
import { Settings, Plus, MessageSquare } from 'lucide-react'

interface SessionInfo {
    id: string;
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

    const refreshSessions = useCallback(() => {
        if (!connected) return
        sendRpc<{ sessions: SessionInfo[] }>('session:list').then((res) => {
            if (res?.sessions) setSessions(res.sessions)
        })
    }, [connected])

    useEffect(() => {
        refreshSessions()
    }, [refreshSessions])

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
                <select>
                    <option>{import.meta.env.DEV ? 'dev-workspace' : 'current'}</option>
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
                        title={`${s.goal || s.id}\n${s.messageCount} messages • ${s.status}`}
                    >
                        <MessageSquare size={14} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {s.goal && s.goal !== '(no goal)' ? s.goal : s.id.slice(0, 12) + '...'}
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
