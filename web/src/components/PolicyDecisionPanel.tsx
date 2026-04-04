import type { PolicyDecisionEvent } from '../store/ws'

interface PolicyDecisionPanelProps {
  events: PolicyDecisionEvent[]
}

const MAX_VISIBLE_EVENTS = 6

export function PolicyDecisionPanel({ events }: PolicyDecisionPanelProps) {
  const recentEvents = [...events].slice(-MAX_VISIBLE_EVENTS).reverse()

  return (
    <section className="policy-decision-panel" aria-label="Policy decision timeline">
      <div className="policy-decision-panel__header">
        <div>
          <h3>Policy Decisions</h3>
          <p>Live allow/deny decisions for tool execution.</p>
        </div>
        <span className="policy-decision-panel__count">{events.length}</span>
      </div>

      {recentEvents.length === 0 ? (
        <p className="policy-decision-panel__empty">No policy decisions yet.</p>
      ) : (
        <div className="policy-decision-list">
          {recentEvents.map((event) => (
            <article
              key={event.id}
              className={`policy-decision-item policy-decision-item--${event.decision}`}
            >
              <div className="policy-decision-item__topline">
                <span className={`policy-decision-badge policy-decision-badge--${event.decision}`}>
                  {event.decision}
                </span>
                <code>{event.tool}</code>
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
