import { useState, useEffect, useCallback, useRef } from 'react'
import { sendRpc, useEvent } from '../store/ws'
import { Settings, Plus, MessageSquare, Trash2, Pencil, FolderOpen, Check, X } from 'lucide-react'

interface SessionInfo {
    id: string;
    title?: string;
    status: string;
    updatedAt: string;
    goal: string;
    messageCount: number;
}

interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    sessionId: string;
    sessionTitle?: string;
}

interface Props {
    connected: boolean;
    activeSessionId: string | null;
    onSessionSwitch?: (sessionId: string, title?: string) => void;
    onSettingsOpen?: () => void;
}

export function LeftSidebar({ connected, activeSessionId, onSessionSwitch, onSettingsOpen }: Props) {
    const [sessions, setSessions] = useState<SessionInfo[]>([])
    // Removed local activeSession state
    const [workspaces, setWorkspaces] = useState<string[]>([])
    const [activeWorkspace, setActiveWorkspace] = useState<string>('')
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
        visible: false,
        x: 0,
        y: 0,
        sessionId: '',
        sessionTitle: ''
    })
    const contextMenuRef = useRef<HTMLDivElement>(null)
    const [showAddWorkspace, setShowAddWorkspace] = useState(false)
    const [newWorkspacePath, setNewWorkspacePath] = useState('')
    const addWsInputRef = useRef<HTMLInputElement>(null)

    const refreshSessions = useCallback(() => {
        sendRpc<{ sessions: SessionInfo[] }>('session:list').then((res) => {
            if (res?.sessions) setSessions(res.sessions)
        })
    }, [])

    const refreshWorkspaces = useCallback(() => {
        sendRpc<{ workspaces: string[]; activeWorkspace?: string }>('workspace:list').then((res) => {
            if (res && res.workspaces) {
                setWorkspaces(res.workspaces)
                if (res.activeWorkspace) {
                    setActiveWorkspace(res.activeWorkspace)
                } else if (!activeWorkspace && res.workspaces.length > 0) {
                    setActiveWorkspace(res.workspaces[res.workspaces.length - 1])
                }
            }
        })
    }, [activeWorkspace])

    useEffect(() => {
        refreshSessions()
        refreshWorkspaces()
    }, [refreshSessions, refreshWorkspaces])

    // Global listener for session changes (deletion, renaming, etc.)
    useEvent('session:list', (msg: any) => {
        const data = msg.data as { sessions: SessionInfo[] }
        if (data?.sessions) {
            setSessions(data.sessions)
        }
    })

    const handleNewSession = useCallback(() => {
        sendRpc<{ sessionId: string; sessions: SessionInfo[] }>('session:create').then((res) => {
            if (res) {
                setSessions(res.sessions)
                onSessionSwitch?.(res.sessionId)
            }
        })
    }, [onSessionSwitch])

    const handleContextMenu = useCallback((e: React.MouseEvent, session: SessionInfo) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            sessionId: session.id,
            sessionTitle: session.title || session.goal || ''
        })
    }, [])

    const closeContextMenu = useCallback(() => {
        setContextMenu(prev => ({ ...prev, visible: false }))
    }, [])

    const handleRenameSession = useCallback(async () => {
        const newTitle = window.prompt('请输入新的会话名称：', contextMenu.sessionTitle || '')
        if (newTitle === null) return // 用户取消
        if (newTitle.trim() === '') {
            alert('会话名称不能为空')
            return
        }
        
        try {
            const res = await sendRpc<{ success: boolean; session?: SessionInfo }>('session:rename', {
                id: contextMenu.sessionId,
                title: newTitle.trim()
            })
            if (res && res.success !== false) {
                refreshSessions()
            } else {
                throw new Error('重命名失败')
            }
        } catch (err: any) {
            alert(`重命名失败: ${err.message}`)
        } finally {
            closeContextMenu()
        }
    }, [contextMenu.sessionId, contextMenu.sessionTitle, closeContextMenu])

    // 点击其他地方关闭右键菜单
    useEffect(() => {
        const handleClickOutside = () => {
            if (contextMenu.visible) {
                closeContextMenu()
            }
        }
        
        if (contextMenu.visible) {
            document.addEventListener('click', handleClickOutside)
            return () => document.removeEventListener('click', handleClickOutside)
        }
    }, [contextMenu.visible, closeContextMenu])

  const handleSwitchSession = useCallback((sessionId: string, title?: string) => {
    onSessionSwitch?.(sessionId, title)
  }, [onSessionSwitch])

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation() // 防止触发 session 切换
    if (!window.confirm('确定删除此会话？此操作不可撤销。')) return
    try {
      const res = await sendRpc<{ success: boolean; activeSessionId?: string }>('session:delete', { id: sessionId })
      if (!res.success) throw new Error('删除失败')
      refreshSessions()
      // 如果删除的是当前活跃会话，父组件会收到 session:list 事件自动处理
    } catch (err: any) {
      alert(`删除失败: ${err.message}`)
    }
  }, [refreshSessions])

    const formatTime = (iso: string) => {
        if (!iso || iso === 'unknown') return ''
        try {
            const date = new Date(iso)
            const y = date.getFullYear()
            const m = String(date.getMonth() + 1).padStart(2, '0')
            const d = String(date.getDate()).padStart(2, '0')
            const hh = String(date.getHours()).padStart(2, '0')
            const mm = String(date.getMinutes()).padStart(2, '0')
            return `${y}-${m}-${d} ${hh}:${mm}`
        } catch { return '' }
    }

    const handleWorkspaceChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value
        if (val === '__add_new__') return
        const res = await sendRpc<{ success: boolean; sessionId: string; error?: string }>('workspace:switch', { targetPath: val })
        if (res.success) {
            setActiveWorkspace(val)
            refreshSessions()
            onSessionSwitch?.(res.sessionId)
        } else {
            alert(`Failed to switch workspace: ${res.error}`)
        }
    }

    const handleAddWorkspace = useCallback(async () => {
        try {
            const dirHandle = await (window as any).showDirectoryPicker()
            setNewWorkspacePath(dirHandle.name)
            setShowAddWorkspace(true)
            setTimeout(() => addWsInputRef.current?.focus(), 50)
        } catch {
            setNewWorkspacePath('')
            setShowAddWorkspace(true)
            setTimeout(() => addWsInputRef.current?.focus(), 50)
        }
    }, [])

    const handleConfirmAddWorkspace = useCallback(async () => {
        const path = newWorkspacePath.trim()
        if (!path) return
        const res = await sendRpc<{ success: boolean; error?: string }>('workspace:add', { path })
        if (res.success) {
            refreshWorkspaces()
            setShowAddWorkspace(false)
            setNewWorkspacePath('')
        } else {
            alert(`Failed to add workspace: ${res.error}`)
        }
    }, [newWorkspacePath, refreshWorkspaces])

    const handleCancelAddWorkspace = useCallback(() => {
        setShowAddWorkspace(false)
        setNewWorkspacePath('')
    }, [])

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
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <select value={activeWorkspace} onChange={handleWorkspaceChange} style={{ flex: 1 }}>
                        <option value="" disabled>Select a Workspace</option>
                        {workspaces.map(w => (
                            <option key={w} value={w}>{w}</option>
                        ))}
                    </select>
                    <button
                        className="ws-add-btn"
                        title="Add workspace"
                        onClick={handleAddWorkspace}
                    >
                        <FolderOpen size={14} />
                    </button>
                    {activeWorkspace && (
                        <button
                            className="ws-remove-btn"
                            title="Remove this workspace"
                            onClick={async () => {
                                if (window.confirm(`Remove workspace "${activeWorkspace}"?`)) {
                                    const res = await sendRpc<{ success: boolean; error?: string }>('workspace:remove', { path: activeWorkspace })
                                    if (res.success) refreshWorkspaces()
                                    else alert(`Failed: ${res.error}`)
                                }
                            }}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
                {showAddWorkspace && (
                    <div style={{ display: 'flex', gap: '4px', marginTop: 6 }}>
                        <input
                            ref={addWsInputRef}
                            type="text"
                            value={newWorkspacePath}
                            onChange={(e) => setNewWorkspacePath(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmAddWorkspace(); if (e.key === 'Escape') handleCancelAddWorkspace() }}
                            placeholder="Paste or type workspace path..."
                            style={{
                                flex: 1,
                                padding: '6px 8px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--accent)',
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-primary)',
                                fontSize: '12px',
                                fontFamily: 'var(--font-mono)',
                                outline: 'none',
                            }}
                        />
                        <button className="ws-confirm-btn" onClick={handleConfirmAddWorkspace} title="Confirm">
                            <Check size={14} />
                        </button>
                    </div>
                )}
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
                        className={`session-item ${activeSessionId === s.id ? 'active' : ''}`}
                        onClick={() => handleSwitchSession(s.id, s.title)}
                        onContextMenu={(e) => handleContextMenu(e, s)}
                        title={`${s.title || s.goal || s.id}\n${formatTime(s.updatedAt)}`}
                    >
                        <MessageSquare size={14} />
                        <div className="session-item-content">
                            <div className="session-item-title">
                                {s.title ? s.title : (s.goal && s.goal !== '(no goal)' ? s.goal : s.id.slice(0, 12) + '...')}
                            </div>
                            <div className="session-item-date">
                                {formatTime(s.updatedAt)}
                            </div>
                        </div>
                        <button
                            className="session-delete-btn"
                            onClick={(e) => handleDeleteSession(e, s.id)}
                            title="删除此会话"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                ))}
            </div>

            {/* 右键菜单 */}
            {contextMenu.visible && (
                <div
                    ref={contextMenuRef}
                    className="context-menu"
                    style={{
                        position: 'fixed',
                        left: `${contextMenu.x}px`,
                        top: `${contextMenu.y}px`,
                        zIndex: 1000,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div
                        className="context-menu-item"
                        onClick={handleRenameSession}
                    >
                        <Pencil size={14} />
                        <span>重命名</span>
                    </div>
                    <div
                        className="context-menu-item danger"
                        onClick={(e) => {
                            handleDeleteSession(e as any, contextMenu.sessionId)
                            closeContextMenu()
                        }}
                    >
                        <Trash2 size={14} />
                        <span>删除</span>
                    </div>
                </div>
            )}

            <button className="new-session-btn" onClick={handleNewSession}>
                <Plus size={14} style={{ marginRight: 4 }} /> New Session
            </button>

            {/* Footer */}
            <div className="sidebar-footer">
                <button onClick={() => onSettingsOpen?.()}>
                    <Settings size={14} /> Settings
                </button>
            </div>
        </div>
    )
}
