import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';

interface ModelGroup {
    protocol: string;
    models: string[];
}

interface Props {
    providers: Record<string, ModelGroup>;
    activeModel: string;
    onSelect: (modelId: string) => void;
}

export function ModelSelector({ providers, activeModel, onSelect }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredProviders = useMemo(() => {
        const lowSearch = search.toLowerCase();
        const result: Record<string, ModelGroup> = {};

        for (const [providerName, group] of Object.entries(providers)) {
            // 如果 provider 名字匹配，显示整个组
            if (providerName.toLowerCase().includes(lowSearch)) {
                result[providerName] = group;
                continue;
            }

            // 过滤匹配的模型
            const matchedModels = group.models.filter(m => m.toLowerCase().includes(lowSearch));
            if (matchedModels.length > 0) {
                result[providerName] = { ...group, models: matchedModels };
            }
        }
        return result;
    }, [providers, search]);

    const handleSelect = (provider: string, model: string) => {
        onSelect(`${provider}/${model}`);
        setIsOpen(false);
        setSearch('');
    };

    return (
        <div className="model-selector-container" ref={containerRef}>
            <div className={`model-selector-trigger ${isOpen ? 'active' : ''}`} onClick={() => setIsOpen(!isOpen)}>
                <span className="current-model-label">{activeModel || 'Select Model'}</span>
                <ChevronDown size={14} className={`chevron ${isOpen ? 'open' : ''}`} />
            </div>

            {isOpen && (
                <div className="model-selector-dropdown">
                    <div className="search-box">
                        <Search size={14} />
                        <input
                            type="text"
                            placeholder="Search providers or models..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            autoFocus
                        />
                    </div>

                    <div className="dropdown-content">
                        {Object.entries(filteredProviders).map(([providerName, group]) => (
                            <div key={providerName} className="provider-group">
                                <div className="provider-header">
                                    <span className="provider-name">{providerName}</span>
                                    <span className="protocol-badge">{group.protocol}</span>
                                </div>
                                <div className="model-options">
                                    {group.models.map(model => {
                                        const fullId = `${providerName}/${model}`;
                                        const isSelected = activeModel === fullId;
                                        return (
                                            <div
                                                key={model}
                                                className={`model-option ${isSelected ? 'selected' : ''}`}
                                                onClick={() => handleSelect(providerName, model)}
                                            >
                                                <span className="model-name">{model}</span>
                                                {isSelected && <Check size={14} />}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        {Object.keys(filteredProviders).length === 0 && (
                            <div className="no-results">No models found</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
