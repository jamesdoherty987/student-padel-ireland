import { Link } from 'react-router-dom'

type Mode = 'tournaments' | 'play'

/** Segmented control that makes Official vs Play with friends obvious. */
export default function ModeSwitch({ active }: { active: Mode }) {
  return (
    <div className="mode-switch" role="navigation" aria-label="Choose how to play">
      {active === 'tournaments' ? (
        <span className="mode-switch-item is-active" aria-current="page">
          <i className="fas fa-trophy" aria-hidden />
          Tournaments
        </span>
      ) : (
        <Link to="/tournaments" className="mode-switch-item" replace={false}>
          <i className="fas fa-trophy" aria-hidden />
          Tournaments
        </Link>
      )}
      {active === 'play' ? (
        <span className="mode-switch-item is-active" aria-current="page">
          <i className="fas fa-users" aria-hidden />
          Play
        </span>
      ) : (
        <Link to="/community" className="mode-switch-item" replace={false}>
          <i className="fas fa-users" aria-hidden />
          Play
        </Link>
      )}
    </div>
  )
}
