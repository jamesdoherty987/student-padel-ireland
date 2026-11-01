import NumberInput from './NumberInput'

/** Touch-friendly − / value / + control for set scores (player + organiser). */
export default function ScoreStep({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: number
  max: number
  onChange: (n: number) => void
}) {
  return (
    <div className="pl-score-step">
      <button
        type="button"
        className="pl-score-step-btn"
        aria-label={`Decrease ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </button>
      <NumberInput
        className="pl-score-step-input"
        inputMode="numeric"
        pattern="[0-9]*"
        min={0}
        max={max}
        emptyValue={0}
        value={value}
        onValueChange={(n) => onChange(Math.max(0, Math.min(max, Math.trunc(n))))}
        aria-label={label}
      />
      <button
        type="button"
        className="pl-score-step-btn"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  )
}
