import { useEffect, useState } from 'react'

export type DraftSponsor = {
  id: string
  name: string
  website: string
  featured: boolean
  logo: File | null
  previewUrl: string | null
}

type Props = {
  sponsors: DraftSponsor[]
  onChange: (next: DraftSponsor[]) => void
  max?: number
  disabled?: boolean
  onToast?: (msg: string) => void
}

function newId() {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function emptyDraftSponsor(): DraftSponsor {
  return {
    id: newId(),
    name: '',
    website: '',
    featured: false,
    logo: null,
    previewUrl: null,
  }
}

function validateLogo(file: File, onToast?: (msg: string) => void): boolean {
  if (file.size > 2 * 1024 * 1024) {
    onToast?.('Logo must be 2MB or smaller')
    return false
  }
  const type = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()
  const heic =
    type.includes('heic') ||
    type.includes('heif') ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  if (heic) {
    onToast?.('Use JPG or PNG — iPhone HEIC photos aren’t supported yet')
    return false
  }
  return true
}

/**
 * Collect sponsor logos before a tournament exists. Files upload after create.
 */
export default function DraftSponsorsField({
  sponsors,
  onChange,
  max = 12,
  disabled = false,
  onToast,
}: Props) {
  const [draft, setDraft] = useState(() => emptyDraftSponsor())
  const [logoKey, setLogoKey] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!draft.logo) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(draft.logo)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [draft.logo])

  const patchDraft = (patch: Partial<DraftSponsor>) => setDraft((d) => ({ ...d, ...patch }))

  const addSponsor = () => {
    const name = draft.name.trim()
    if (name.length < 2 || sponsors.length >= max || disabled) return
    onChange([
      ...sponsors,
      {
        id: newId(),
        name,
        website: draft.website.trim(),
        featured: draft.featured,
        logo: draft.logo,
        previewUrl: draft.logo ? URL.createObjectURL(draft.logo) : null,
      },
    ])
    setDraft(emptyDraftSponsor())
    setLogoKey((k) => k + 1)
  }

  const removeSponsor = (id: string) => {
    const victim = sponsors.find((s) => s.id === id)
    if (victim?.previewUrl) URL.revokeObjectURL(victim.previewUrl)
    onChange(sponsors.filter((s) => s.id !== id))
  }

  return (
    <div className="draft-sponsors">
      <p className="tf-section-lead">
        Optional. Logos show as a “Supported by” strip on the tournament page. You can add more later
        from Manage.
      </p>

      {sponsors.length > 0 && (
        <ul className="org-sponsor-list">
          {sponsors.map((s) => (
            <li key={s.id} className="org-sponsor-item">
              <div className="org-sponsor-thumb">
                {s.previewUrl ? (
                  <img src={s.previewUrl} alt="" />
                ) : (
                  <span aria-hidden>{s.name.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="org-sponsor-meta">
                <strong>
                  {s.name}
                  {s.featured ? <em> · Featured</em> : null}
                </strong>
                {s.website ? (
                  <span className="muted">{s.website.replace(/^https?:\/\//, '')}</span>
                ) : (
                  <span className="muted">{s.logo ? 'Logo ready' : 'No logo yet'}</span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disabled}
                onClick={() => removeSponsor(s.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {sponsors.length < max && (
        <div className="org-sponsor-form">
          <div className="form-group">
            <label className="form-label" htmlFor="draft-sponsor-name">
              Name
            </label>
            <input
              id="draft-sponsor-name"
              className="form-input"
              placeholder="Sponsor name"
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              maxLength={200}
              disabled={disabled}
              autoCapitalize="words"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="draft-sponsor-website">
              Website <span className="muted">(optional)</span>
            </label>
            <input
              id="draft-sponsor-website"
              className="form-input"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="example.com"
              value={draft.website}
              onChange={(e) => patchDraft({ website: e.target.value })}
              disabled={disabled}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="draft-sponsor-logo">
              Logo <span className="muted">(recommended)</span>
            </label>
            <div className={`org-sponsor-upload${previewUrl ? ' has-preview' : ''}`}>
              {previewUrl ? (
                <img src={previewUrl} alt="" className="org-sponsor-preview" />
              ) : (
                <span className="org-sponsor-upload-hint">Tap to choose logo</span>
              )}
              <input
                key={logoKey}
                id="draft-sponsor-logo"
                type="file"
                accept="image/*,.jpg,.jpeg,.png,.webp,.gif"
                disabled={disabled}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null
                  if (!file) {
                    patchDraft({ logo: null })
                    return
                  }
                  if (!validateLogo(file, onToast)) {
                    e.target.value = ''
                    return
                  }
                  patchDraft({ logo: file })
                }}
              />
            </div>
            {draft.logo ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm org-sponsor-clear-logo"
                disabled={disabled}
                onClick={() => {
                  patchDraft({ logo: null })
                  setLogoKey((k) => k + 1)
                }}
              >
                Clear logo
              </button>
            ) : null}
          </div>
          <label className="org-sponsor-featured">
            <input
              type="checkbox"
              checked={draft.featured}
              disabled={disabled}
              onChange={(e) => patchDraft({ featured: e.target.checked })}
            />
            <span>Featured (shown a bit larger)</span>
          </label>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={disabled || draft.name.trim().length < 2}
            onClick={addSponsor}
          >
            Add to list
          </button>
        </div>
      )}

      {sponsors.length >= max ? (
        <p className="muted-note" style={{ marginTop: 8 }}>
          Maximum {max} sponsors.
        </p>
      ) : null}
    </div>
  )
}
