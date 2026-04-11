import type { PolicyDecisionEvent } from '../store/ws'
import { formatPolicyDecisionTimestamp, sortPolicyDecisionsNewestFirst } from '../store/policy-decision-ui.js'

export type PolicyDecisionPanelMode = 'current' | 'audit'

interface PolicyDecisionPanelProps {
  events: PolicyDecisionEvent[]
  mode?: PolicyDecisionPanelMode
  onModeChange?: (mode: PolicyDecisionPanelMode) => void
}

const MAX_VISIBLE_EVENTS = 6

export function PolicyDecisionPanel({
  events,
  mode = 'current',
  onModeChange,
}: PolicyDecisionPanelProps) {
  const sortedEvents = sortPolicyDecisionsNewestFirst(events)
  const visibleEvents = mode === 'audit'
    ? sortedEvents
    : sortedEvents.slice(0, MAX_VISIBLE_EVENTS)

  return (
    <section className="policy-decision-panel" aria-label="Policy decision timeline">
      <div className="policy-decision-panel__header">
        <div>
          <h3>Policy Decisions</h3>
          <p>{mode === 'audit' ? 'Append-only policy audit history.' : 'Live allow/deny decisions for tool execution.'}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className={mode === 'current' ? 'active' : ''}
              onClick={() => onModeChange?.('current')}
            >
              Current
            </button>
            <button
              type="button"
              className={mode === 'audit' ? 'active' : ''}
              onClick={() => onModeChange?.('audit')}
            >
              Audit
            </button>
          </div>
          <span className="policy-decision-panel__count">{events.length}</span>
        </div>
      </div>

      {visibleEvents.length === 0 ? (
        <p className="policy-decision-panel__empty">No policy decisions yet.</p>
      ) : (
        <div className="policy-decision-list">
          {visibleEvents.map((event, index) => (
            <article
              key={`${event.id}-${event.timestamp}-${index}`}
              className={`policy-decision-item policy-decision-item--${event.decision}`}
            >
              <div className="policy-decision-item__topline">
                <span className={`policy-decision-badge policy-decision-badge--${event.decision}`}>
                  {event.decision}
                </span>
                <code>{event.tool}</code>
                <time dateTime={new Date(event.timestamp).toISOString()}>
                  {formatPolicyDecisionTimestamp(event.timestamp)}
                </time>
              </div>

              <dl className="policy-decision-meta">
                <div>
                  <dt>Mode</dt>
                  <dd>{event.mode}</dd>
                </div>
                <div>
                  <dt>Class</dt>
                  <dd>{event.permissionClass}</dd>
                </div>
              </dl>

              <p className="policy-decision-reason">{event.reason}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
