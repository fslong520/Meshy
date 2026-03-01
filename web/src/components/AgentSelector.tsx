import { useState, useRef, useEffect } from 'react';
import { Bot } from 'lucide-react';

export interface AgentInfo {
    id: string;
    name: string;
    description: string;
    emoji: string;
}

interface AgentSelectorProps {
    agents: AgentInfo[];
    activeAgentId: string;
    onSelect: (agentId: string) => void;
}

export function AgentSelector({ agents, activeAgentId, onSelect }: AgentSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const selectorRef = useRef<HTMLDivElement>(null);

    const activeAgent = agents.find(a => a.id === activeAgentId) || agents[0];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!agents.length) return null;

    return (
        <div className="agent-selector" ref={selectorRef}>
            <button
                className="selector-button"
                onClick={() => setIsOpen(!isOpen)}
                title="Select Agent"
            >
                {activeAgent ? (
                    <span className="selector-value">
                        {activeAgent.emoji} {activeAgent.name}
                    </span>
                ) : (
                    <span className="selector-value">
                        <Bot size={14} /> Agent
                    </span>
                )}
                <span className="selector-arrow">▼</span>
            </button>

            {isOpen && (
                <div className="selector-dropdown">
                    {agents.map(agent => (
                        <div
                            key={agent.id}
                            className={`dropdown-item ${agent.id === activeAgentId ? 'active' : ''}`}
                            onClick={() => {
                                onSelect(agent.id);
                                setIsOpen(false);
                            }}
                        >
                            <div className="agent-header">
                                <span className="agent-emoji">{agent.emoji}</span>
                                <span className="agent-name">{agent.name}</span>
                            </div>
                            {agent.description && (
                                <div className="agent-desc">{agent.description}</div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
