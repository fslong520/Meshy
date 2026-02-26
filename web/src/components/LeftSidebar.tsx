import { useState, useEffect } from 'react'
import { sendRpc } from '../store/ws'
import { Settings, Plus, MessageSquare } from 'lucide-react'

interface SessionInfo {
    id: string;
    updatedAt: string;
}

interface Props {
    connected: boolean;
}

export function LeftSidebar({ connected }: Props) {
    const [sessions, setSessions] = useState<SessionInfo[]>([])
    const [activeSession, setActiveSession] = useState<string | null>(null)

    useEffect(() => {
        if (!connected) return
        sendRpc<{ sessions: SessionInfo[] }>('session:list').then((res) => {
            if (res?.sessions) setSessions(res.sessions)
        })
    }, [connected])

    const handleNewSession = () => {
        // 未来: 创建新 session
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
                <div className="sidebar-section-title">Sessions</div>
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
                        onClick={() => setActiveSession(s.id)}
                    >
                        <MessageSquare size={14} />
                        <span>{s.id.slice(0, 8)}...</span>
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
