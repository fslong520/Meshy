import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';

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
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    const activeAgent = agents.find(a => a.id === activeAgentId) || agents[0];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredAgents = useMemo(() => {
        const lowSearch = search.toLowerCase();
        return agents.filter(agent =>
            agent.name.toLowerCase().includes(lowSearch) ||
            (agent.description && agent.description.toLowerCase().includes(lowSearch))
        );
    }, [agents, search]);

    const handleSelect = (agentId: string) => {
        onSelect(agentId);
        setIsOpen(false);
        setSearch('');
    };

    if (!agents.length) return null;

    return (
        <div className="model-selector-container" ref={containerRef}>
            <div className={`model-selector-trigger ${isOpen ? 'active' : ''}`} onClick={() => setIsOpen(!isOpen)}>
                <span className="current-model-label">
                    {activeAgent ? (
                        <>
                            {activeAgent.emoji} {activeAgent.name}
                        </>
                    ) : (
                        'Select Agent'
                    )}
                </span>
                <ChevronDown size={14} className={`chevron ${isOpen ? 'open' : ''}`} />
            </div>

            {isOpen && (
                <div className="model-selector-dropdown">
                    <div className="search-box">
                        <Search size={14} />
                        <input
                            type="text"
                            placeholder="Search agents..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            autoFocus
                        />
                    </div>

                    <div className="dropdown-content">
                        {filteredAgents.map(agent => {
                            const isSelected = activeAgentId === agent.id;
                            return (
                                <div
                                    key={agent.id}
                                    className={`model-option ${isSelected ? 'selected' : ''}`}
                                    onClick={() => handleSelect(agent.id)}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span className="model-name" style={{ fontWeight: 600 }}>
                                                {agent.emoji} {agent.name}
                                            </span>
                                            {isSelected && <Check size={14} />}
                                        </div>
                                        {agent.description && (
                                            <span style={{ fontSize: '11px', opacity: 0.7 }}>
                                                {agent.description}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {filteredAgents.length === 0 && (
                            <div className="no-results">No agents found</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
