export type RegistrationFieldDraft = {
  /** Stable React key */
  clientId: string
  /** Existing field id when editing */
  id?: string
  label: string
  field_type: 'text' | 'select' | 'boolean'
  /** Comma or newline separated options for select */
  optionsText: string
  required: boolean
  scope: 'player' | 'team'
}

type Props = {
  fields: RegistrationFieldDraft[]
  onChange: (fields: RegistrationFieldDraft[]) => void
  disabled?: boolean
  singles?: boolean
  mode?: 'create' | 'edit'
}

let _seq = 0
export function newFieldDraft(
  partial?: Partial<RegistrationFieldDraft>,
): RegistrationFieldDraft {
  _seq += 1
  return {
    clientId: `rf-${Date.now()}-${_seq}`,
    label: '',
    field_type: 'text',
    optionsText: '',
    required: false,
    scope: 'player',
    ...partial,
  }
}

export function draftsFromApi(
  fields: Array<{
    id: string
    label: string
    field_type: string
    options?: string[]
    required?: boolean
    scope?: string
  }>,
): RegistrationFieldDraft[] {
  return fields.map((f) =>
    newFieldDraft({
      id: f.id,
      label: f.label,
      field_type:
        f.field_type === 'select' || f.field_type === 'boolean' ? f.field_type : 'text',
      optionsText: (f.options || []).join(', '),
      required: !!f.required,
      scope: f.scope === 'team' ? 'team' : 'player',
    }),
  )
}

function parseOptionsText(text: string) {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function validateRegistrationFields(fields: RegistrationFieldDraft[]): string | null {
  for (const f of fields) {
    const label = f.label.trim()
    if (!label) continue
    if (f.field_type === 'select' && parseOptionsText(f.optionsText).length < 2) {
      return `“${label}” needs at least 2 dropdown options (e.g. S, M, L)`
    }
  }
  const labeled = fields.filter((f) => f.label.trim())
  if (labeled.length > 12) return 'At most 12 custom signup questions'
  return null
}

export function draftsToPayload(fields: RegistrationFieldDraft[]) {
  return fields
    .map((f, i) => {
      const label = f.label.trim()
      if (!label) return null
      const options = f.field_type === 'select' ? parseOptionsText(f.optionsText) : []
      return {
        ...(f.id ? { id: f.id } : {}),
        label,
        field_type: f.field_type,
        options,
        required: f.required,
        scope: f.scope,
        sort_order: i,
      }
    })
    .filter(Boolean)
}

const PRESETS: Array<{ label: string; draft: Partial<RegistrationFieldDraft> }> = [
  {
    label: 'Jersey size',
    draft: {
      label: 'Jersey size',
      field_type: 'select',
      optionsText: 'XS, S, M, L, XL, XXL',
      required: true,
      scope: 'player',
    },
  },
  {
    label: 'Dietary needs',
    draft: {
      label: 'Dietary requirements',
      field_type: 'text',
      required: false,
      scope: 'player',
    },
  },
  {
    label: 'Racket hire',
    draft: {
      label: 'Need racket hire?',
      field_type: 'boolean',
      required: true,
      scope: 'player',
    },
  },
]

export default function RegistrationFieldsEditor({
  fields,
  onChange,
  disabled = false,
  singles = false,
  mode = 'create',
}: Props) {
  const update = (clientId: string, patch: Partial<RegistrationFieldDraft>) => {
    onChange(fields.map((f) => (f.clientId === clientId ? { ...f, ...patch } : f)))
  }

  const remove = (clientId: string) => {
    onChange(fields.filter((f) => f.clientId !== clientId))
  }

  const addPreset = (partial: Partial<RegistrationFieldDraft>) => {
    onChange([...fields, newFieldDraft(partial)])
  }

  return (
    <div className="tf-reg-fields">
      <p className="form-hint tf-reg-fields-lead">
        Extra questions players answer when they join
        {singles ? '' : ' — player questions are asked for each teammate'}.
        {mode === 'create'
          ? ' You can add or change these later from Edit.'
          : ' New questions only apply to new signups.'}
      </p>

      {fields.length === 0 && (
        <p className="muted tf-reg-fields-empty">No custom questions yet — add one below.</p>
      )}

      <ul className="tf-reg-fields-list">
        {fields.map((f, index) => (
          <li key={f.clientId} className="tf-reg-field-card">
            <div className="tf-reg-field-top">
              <span className="tf-reg-field-num">Q{index + 1}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disabled}
                onClick={() => remove(f.clientId)}
              >
                Remove
              </button>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor={`rf-label-${f.clientId}`}>
                Question
              </label>
              <input
                id={`rf-label-${f.clientId}`}
                className="form-input"
                placeholder="e.g. Jersey size"
                value={f.label}
                disabled={disabled}
                onChange={(e) => update(f.clientId, { label: e.target.value })}
                maxLength={200}
              />
            </div>

            <div className="tf-reg-field-row">
              <div className="form-group">
                <label className="form-label" htmlFor={`rf-type-${f.clientId}`}>
                  Type
                </label>
                <select
                  id={`rf-type-${f.clientId}`}
                  className="form-input"
                  value={f.field_type}
                  disabled={disabled}
                  onChange={(e) =>
                    update(f.clientId, {
                      field_type: e.target.value as RegistrationFieldDraft['field_type'],
                    })
                  }
                >
                  <option value="text">Short text</option>
                  <option value="select">Dropdown</option>
                  <option value="boolean">Yes / no</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={`rf-scope-${f.clientId}`}>
                  Asked for
                </label>
                <select
                  id={`rf-scope-${f.clientId}`}
                  className="form-input"
                  value={f.scope}
                  disabled={disabled}
                  onChange={(e) =>
                    update(f.clientId, {
                      scope: e.target.value as RegistrationFieldDraft['scope'],
                    })
                  }
                >
                  <option value="player">{singles ? 'Each player' : 'Each teammate'}</option>
                  <option value="team">Once per entry</option>
                </select>
              </div>
            </div>

            {f.field_type === 'select' && (
              <div className="form-group">
                <label className="form-label" htmlFor={`rf-opts-${f.clientId}`}>
                  Options <span className="tf-optional">(comma-separated)</span>
                </label>
                <input
                  id={`rf-opts-${f.clientId}`}
                  className="form-input"
                  placeholder="S, M, L, XL"
                  value={f.optionsText}
                  disabled={disabled}
                  autoCapitalize="characters"
                  enterKeyHint="done"
                  onChange={(e) => update(f.clientId, { optionsText: e.target.value })}
                />
                {f.label.trim() && parseOptionsText(f.optionsText).length < 2 && (
                  <p className="tf-reg-field-warn">Add at least two options</p>
                )}
              </div>
            )}

            <label className="tf-check">
              <input
                type="checkbox"
                checked={f.required}
                disabled={disabled}
                onChange={(e) => update(f.clientId, { required: e.target.checked })}
              />
              <span>Required</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="tf-reg-fields-actions">
        <button
          type="button"
          className="btn btn-dark btn-sm"
          disabled={disabled || fields.length >= 12}
          onClick={() => onChange([...fields, newFieldDraft()])}
        >
          Add question
        </button>
        <div className="tf-reg-presets" role="group" aria-label="Quick add">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={disabled || fields.length >= 12}
              onClick={() => addPreset(p.draft)}
            >
              + {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
