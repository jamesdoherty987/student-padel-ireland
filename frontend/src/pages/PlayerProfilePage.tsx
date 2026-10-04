import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import {
  apiErrorMessage,
  authApi,
  communityApi,
  platformApi,
  reportApi,
  type ProfileMedia,
} from '../services/api'
import { mediaUrl } from '../utils/media'
import './Tournament.css'
import './Profile.css'

const MAX_IMAGE = 5 * 1024 * 1024
const MAX_VIDEO = 25 * 1024 * 1024

function validateMediaFile(file: File): string | null {
  const isVideo = file.type.startsWith('video/')
  const isImage = file.type.startsWith('image/')
  if (!isImage && !isVideo) return 'Choose a photo or short video'
  if (isImage && file.size > MAX_IMAGE) return 'Photos must be 5MB or smaller'
  if (isVideo && file.size > MAX_VIDEO) return 'Videos must be 25MB or smaller'
  return null
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function winRate(wins: number, losses: number) {
  const total = wins + losses
  if (total === 0) return null
  return Math.round((wins / total) * 100)
}

export default function PlayerProfilePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [bioDraft, setBioDraft] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [lightbox, setLightbox] = useState<ProfileMedia | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [error, setError] = useState('')
  const [asAvatar, setAsAvatar] = useState(false)
  const [brokenMedia, setBrokenMedia] = useState<Set<string>>(() => new Set())
  const [lightboxError, setLightboxError] = useState(false)
  const [showDeleteAccount, setShowDeleteAccount] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [reportTarget, setReportTarget] = useState<{ type: 'user' | 'media'; id: string } | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportMsg, setReportMsg] = useState('')

  const reportMut = useMutation({
    mutationFn: () => reportApi.create(reportTarget!.type, reportTarget!.id, reportReason.trim()),
    onSuccess: () => {
      setReportMsg('Thanks — your report has been sent. We will review it promptly.')
      setReportReason('')
    },
    onError: (e) => setReportMsg(apiErrorMessage(e)),
  })
  const openReport = (type: 'user' | 'media', targetId: string) => {
    setReportMsg('')
    setReportReason('')
    setReportTarget({ type, id: targetId })
  }

  const { data: player, isLoading, isError, refetch } = useQuery({
    queryKey: ['player', id],
    queryFn: async () => (await platformApi.player(id)).data,
    enabled: !!id,
  })

  const isOwn = Boolean(player?.is_own_profile || (user && player && user.id === player.id))
  const media = player?.media || []

  const lightboxIndex = useMemo(
    () => (lightbox ? media.findIndex((m) => m.id === lightbox.id) : -1),
    [lightbox, media],
  )

  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: !!user && !!player && !isOwn,
  })
  const relation = friendsQ.data?.find((f) => f.user_id === player?.id)

  useEffect(() => {
    const open = !!lightbox || !!reportTarget
    document.body.classList.toggle('modal-open', open)
    return () => document.body.classList.remove('modal-open')
  }, [lightbox, reportTarget])

  useEffect(() => {
    setLightboxError(false)
  }, [lightbox?.id])

  useEffect(() => {
    if (!lightbox && !reportTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (reportTarget) {
          setReportTarget(null)
          return
        }
        setLightbox(null)
        return
      }
      if (reportTarget || !lightbox) return
      if (e.key === 'ArrowRight' && lightboxIndex >= 0 && lightboxIndex < media.length - 1) {
        setLightbox(media[lightboxIndex + 1])
      }
      if (e.key === 'ArrowLeft' && lightboxIndex > 0) {
        setLightbox(media[lightboxIndex - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, lightboxIndex, media, reportTarget])

  const markBroken = (id: string) => {
    setBrokenMedia((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const startUpload = (file: File) => {
    const problem = validateMediaFile(file)
    if (problem) {
      setError(problem)
      return
    }
    const setAvatar = asAvatar && file.type.startsWith('image/')
    uploadMut.mutate({ file, setAvatar })
  }

  const saveBio = useMutation({
    mutationFn: () => platformApi.updateProfile({ bio: bioDraft ?? '' }),
    onSuccess: () => {
      setBioDraft(null)
      setError('')
      qc.invalidateQueries({ queryKey: ['player', id] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const uploadMut = useMutation({
    mutationFn: ({ file, setAvatar }: { file: File; setAvatar: boolean }) =>
      platformApi.uploadMedia(file, {
        caption: caption.trim() || undefined,
        set_as_avatar: setAvatar,
      }),
    onSuccess: () => {
      setCaption('')
      setAsAvatar(false)
      setShowUpload(false)
      setError('')
      if (fileRef.current) fileRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
      qc.invalidateQueries({ queryKey: ['player', id] })
      qc.invalidateQueries({ queryKey: ['rankings'] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (mediaId: string) => platformApi.deleteMedia(mediaId),
    onSuccess: () => {
      setLightbox(null)
      qc.invalidateQueries({ queryKey: ['player', id] })
      qc.invalidateQueries({ queryKey: ['rankings'] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const avatarMut = useMutation({
    mutationFn: (mediaId: string) => platformApi.setAvatar(mediaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player', id] })
      qc.invalidateQueries({ queryKey: ['rankings'] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const friendMut = useMutation({
    mutationFn: (userId: string) => communityApi.requestFriend(userId),
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: ['friends'] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const acceptFriendMut = useMutation({
    mutationFn: (friendshipId: string) => communityApi.acceptFriend(friendshipId),
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: ['friends'] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const deleteAccountMut = useMutation({
    mutationFn: (password: string) => authApi.deleteAccount(password),
    onSuccess: () => {
      logout()
      navigate('/', { replace: true })
    },
    onError: (e) => setDeleteError(apiErrorMessage(e)),
  })

  const rate = player ? winRate(player.wins, player.losses) : null
  const avatarSrc = player ? mediaUrl(player.avatar_url) : undefined

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page profile-page">
        {isLoading && (
          <div className="profile-skeleton">
            <div className="skeleton profile-skeleton-hero" />
            <div className="skeleton" style={{ height: 72, marginTop: 16 }} />
            <div className="skeleton" style={{ height: 160, marginTop: 16 }} />
          </div>
        )}
        {isError && (
          <div className="empty-state">
            <h1 className="page-title">Player not found</h1>
            <p className="page-sub">This profile may have been removed.</p>
            <div className="header-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-ghost" onClick={() => refetch()}>
                Retry
              </button>
              <Link to="/rankings" className="btn btn-primary">
                Rankings
              </Link>
            </div>
          </div>
        )}
        {player && (
          <>
            <p className="eyebrow profile-back">
              <Link to="/rankings">← Rankings</Link>
            </p>

            <header className="profile-hero">
              <div className="profile-hero-bg" aria-hidden />
              <div className="profile-hero-body">
                <div className="profile-avatar-wrap">
                  {avatarSrc ? (
                    <button
                      type="button"
                      className="profile-avatar-btn"
                      onClick={() => {
                        const avatarMedia = media.find((m) => m.is_avatar) || media.find((m) => m.url === player.avatar_url)
                        if (avatarMedia) setLightbox(avatarMedia)
                      }}
                      aria-label="View profile photo"
                    >
                      <img src={avatarSrc} alt="" className="profile-avatar" />
                    </button>
                  ) : (
                    <div className="profile-avatar placeholder">{initials(player.full_name)}</div>
                  )}
                </div>

                <div className="profile-hero-copy">
                  <h1 className="profile-name">{player.full_name}</h1>
                  <p className="profile-uni">
                    {player.university_short || player.university_name || 'Student padel'}
                  </p>
                  {isOwn && <span className="profile-you-tag">Your profile</span>}
                  {user && !isOwn && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => openReport('user', player.id)}
                    >
                      Report
                    </button>
                  )}

                  {user && !isOwn && (
                    <div className="profile-friend-action">
                      {!relation && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={friendMut.isPending}
                          onClick={() => friendMut.mutate(player.id)}
                        >
                          Add friend
                        </button>
                      )}
                      {relation?.direction === 'incoming' && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={acceptFriendMut.isPending}
                          onClick={() => acceptFriendMut.mutate(relation.id)}
                        >
                          Accept request
                        </button>
                      )}
                      {relation?.direction === 'outgoing' && (
                        <span className="profile-friend-status">Request sent</span>
                      )}
                      {relation?.direction === 'friend' && (
                        <span className="profile-friend-status is-friend">Friends</span>
                      )}
                    </div>
                  )}
                  {!user && (
                    <div className="profile-friend-action">
                      <Link
                        to={`/login?next=${encodeURIComponent(`/players/${player.id}`)}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Log in to add friend
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </header>

            <div className="profile-stats" role="list">
              <div role="listitem">
                <strong>#{player.rank_ireland ?? '-'}</strong>
                <span>Ireland</span>
              </div>
              <div role="listitem">
                <strong>{player.points}</strong>
                <span>Elo</span>
              </div>
              <div role="listitem">
                <strong>
                  {player.wins}-{player.losses}
                </strong>
                <span>W-L{rate !== null ? ` · ${rate}%` : ''}</span>
              </div>
              <div role="listitem">
                <strong>{player.matches_played}</strong>
                <span>Matches</span>
              </div>
              <div role="listitem">
                <strong>{player.tournaments_played}</strong>
                <span>Events</span>
              </div>
            </div>

            {error && <p className="form-error">{error}</p>}

            <section className="profile-section">
              <div className="profile-section-head">
                <h2>About</h2>
                {isOwn && bioDraft === null && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setBioDraft(player.bio || '')}
                  >
                    {player.bio ? 'Edit' : 'Add bio'}
                  </button>
                )}
              </div>
              {isOwn && bioDraft !== null ? (
                <div className="profile-bio-edit">
                  <textarea
                    className="form-textarea"
                    value={bioDraft}
                    onChange={(e) => setBioDraft(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="Club, hand, favourite shot..."
                    maxLength={500}
                  />
                  <div className="profile-bio-actions">
                    <button
                      type="button"
                      className="btn btn-dark btn-sm"
                      disabled={saveBio.isPending}
                      onClick={() => saveBio.mutate()}
                    >
                      Save
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBioDraft(null)}>
                      Cancel
                    </button>
                    <span className="profile-char-count">{bioDraft.length}/500</span>
                  </div>
                </div>
              ) : (
                <p className={`profile-bio-text ${player.bio ? '' : 'is-empty'}`}>
                  {player.bio || (isOwn ? "Add a short bio so friends know who's on court." : 'No bio yet.')}
                </p>
              )}
            </section>

            {isOwn && (
              <section className="profile-section">
                <div className="profile-section-head">
                  <h2>Profile Photo</h2>
                </div>
                <p className="muted-note" style={{ marginBottom: '1rem' }}>
                  Your profile photo is displayed at the top of your profile and in rankings. Choose a clear photo of yourself.
                </p>
                {avatarSrc && (
                  <div style={{ marginBottom: '1rem', textAlign: 'center' }}>
                    <img src={avatarSrc} alt="Current profile photo" style={{ maxWidth: '120px', borderRadius: '8px' }} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setShowUpload(true)
                      setAsAvatar(true)
                    }}
                  >
                    {avatarSrc ? 'Change' : 'Upload'} Profile Photo
                  </button>
                  {avatarSrc && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        const confirmed = window.confirm('Remove your profile photo?')
                        if (confirmed) {
                          const avatarMedia = media.find((m) => m.is_avatar)
                          if (avatarMedia) {
                            deleteMut.mutate(avatarMedia.id)
                          }
                        }
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </section>
            )}

            <section className="profile-section">
              <div className="profile-section-head">
                <h2>Photos & Videos</h2>
                {isOwn && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setShowUpload((v) => !v)}
                  >
                    {showUpload ? 'Close' : 'Add'}
                  </button>
                )}
              </div>

              {isOwn && showUpload && (
                <div className="profile-upload">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mov"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) startUpload(file)
                    }}
                  />
                  <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) startUpload(file)
                    }}
                  />
                  <div className="profile-upload-opts">
                    <input
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Optional caption"
                      maxLength={200}
                    />
                    <p className="muted-note" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                      Check the box below to set this as your profile photo, or leave unchecked to add to your gallery.
                    </p>
                    <label className="avatar-check">
                      <input
                        type="checkbox"
                        checked={asAvatar}
                        onChange={(e) => setAsAvatar(e.target.checked)}
                      />
                      Set as profile photo
                    </label>
                  </div>
                  <div className="profile-upload-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={uploadMut.isPending}
                      onClick={() => fileRef.current?.click()}
                    >
                      Choose file
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={uploadMut.isPending}
                      onClick={() => cameraRef.current?.click()}
                    >
                      Take photo
                    </button>
                  </div>
                  {uploadMut.isPending && <p className="muted-note">Uploading...</p>}
                  <p className="muted-note">Photos up to 5MB · short videos up to 25MB.</p>
                </div>
              )}

              {media.length === 0 ? (
                <div className="profile-media-empty">
                  <p>{isOwn ? 'No photos yet.' : 'No media yet.'}</p>
                  {isOwn && (
                    <button
                      type="button"
                      className="btn btn-dark btn-sm"
                      onClick={() => setShowUpload(true)}
                    >
                      Add a match photo
                    </button>
                  )}
                </div>
              ) : (
                <div className={`profile-grid ${media.length === 1 ? 'is-single' : ''}`}>
                  {media.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="profile-grid-item"
                      onClick={() => setLightbox(m)}
                      aria-label={
                        m.caption ||
                        (m.media_type === 'video' ? 'Open video' : 'Open photo')
                      }
                    >
                      {m.media_type === 'video' ? (
                        brokenMedia.has(m.id) ? (
                          <span className="media-missing">Unavailable</span>
                        ) : (
                          <video
                            src={mediaUrl(m.url)}
                            muted
                            playsInline
                            preload="metadata"
                            onError={() => markBroken(m.id)}
                          />
                        )
                      ) : brokenMedia.has(m.id) ? (
                        <span className="media-missing">Unavailable</span>
                      ) : (
                        <img
                          src={mediaUrl(m.url)}
                          alt={m.caption || ''}
                          loading="lazy"
                          onError={() => markBroken(m.id)}
                        />
                      )}
                      {m.media_type === 'video' && (
                        <span className="media-play" aria-hidden>
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </span>
                      )}
                      {m.is_avatar && <span className="media-badge">Profile</span>}
                      {m.caption && <span className="media-caption">{m.caption}</span>}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {isOwn && (
              <section className="profile-account-danger" aria-labelledby="account-danger-title">
                <h2 id="account-danger-title">Account</h2>
                <p className="muted-note">
                  Delete your account to remove personal data from Student Padel Ireland. Tournament history may
                  remain in anonymised form.
                </p>
                {!showDeleteAccount ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm profile-delete-trigger"
                    onClick={() => {
                      setShowDeleteAccount(true)
                      setDeleteError('')
                      setDeletePassword('')
                    }}
                  >
                    Delete account
                  </button>
                ) : (
                  <form
                    className="profile-delete-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      setDeleteError('')
                      if (!deletePassword.trim()) {
                        setDeleteError('Enter your password to confirm')
                        return
                      }
                      deleteAccountMut.mutate(deletePassword)
                    }}
                  >
                    <label className="profile-delete-label" htmlFor="delete-account-password">
                      Confirm with your password
                    </label>
                    <input
                      id="delete-account-password"
                      type="password"
                      autoComplete="current-password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder="Password"
                    />
                    {deleteError && <p className="form-error">{deleteError}</p>}
                    <div className="profile-upload-actions">
                      <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        disabled={deleteAccountMut.isPending}
                      >
                        {deleteAccountMut.isPending ? 'Deleting…' : 'Permanently delete'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={deleteAccountMut.isPending}
                        onClick={() => {
                          setShowDeleteAccount(false)
                          setDeletePassword('')
                          setDeleteError('')
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}

            <div className="profile-footer-links">
              <Link to="/community" className="btn btn-ghost">
                Community
              </Link>
              <Link to="/rankings" className="btn btn-ghost">
                Rankings
              </Link>
            </div>
          </>
        )}

        {lightbox && (
          <div
            className="lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={lightbox.caption || 'Media'}
            onClick={() => setLightbox(null)}
          >
            {lightboxIndex > 0 && (
              <button
                type="button"
                className="lightbox-nav prev"
                aria-label="Previous"
                onClick={(e) => {
                  e.stopPropagation()
                  setLightbox(media[lightboxIndex - 1])
                }}
              >
                ‹
              </button>
            )}
            {lightboxIndex >= 0 && lightboxIndex < media.length - 1 && (
              <button
                type="button"
                className="lightbox-nav next"
                aria-label="Next"
                onClick={(e) => {
                  e.stopPropagation()
                  setLightbox(media[lightboxIndex + 1])
                }}
              >
                ›
              </button>
            )}
            <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
              <div className="lightbox-stage">
                {lightbox.media_type === 'video' ? (
                  lightboxError || brokenMedia.has(lightbox.id) ? (
                    <p className="lightbox-caption is-muted">
                      This video is missing from the server. {isOwn ? 'Delete it and upload again.' : ''}
                    </p>
                  ) : (
                    <video
                      key={lightbox.id}
                      src={mediaUrl(lightbox.url)}
                      controls
                      autoPlay
                      muted
                      playsInline
                      preload="auto"
                      onError={() => {
                        setLightboxError(true)
                        markBroken(lightbox.id)
                      }}
                      onCanPlay={(e) => {
                        const el = e.currentTarget
                        void el.play().catch(() => {})
                      }}
                    />
                  )
                ) : lightboxError || brokenMedia.has(lightbox.id) ? (
                  <p className="lightbox-caption is-muted">
                    This photo is missing from the server. {isOwn ? 'Delete it and upload again.' : ''}
                  </p>
                ) : (
                  <img
                    src={mediaUrl(lightbox.url)}
                    alt={lightbox.caption || ''}
                    onError={() => {
                      setLightboxError(true)
                      markBroken(lightbox.id)
                    }}
                  />
                )}
              </div>
              <div className="lightbox-meta">
                {lightbox.caption ? (
                  <p className="lightbox-caption">{lightbox.caption}</p>
                ) : (
                  <p className="lightbox-caption is-muted">
                    {lightbox.media_type === 'video' ? 'Video (unmute in controls if needed)' : 'Photo'}
                    {media.length > 1 ? ` · ${lightboxIndex + 1} of ${media.length}` : ''}
                  </p>
                )}
                <div className="lightbox-actions">
                  {isOwn && lightbox.media_type === 'image' && !lightbox.is_avatar && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => avatarMut.mutate(lightbox.id)}
                      disabled={avatarMut.isPending}
                    >
                      Set as profile photo
                    </button>
                  )}
                  {isOwn && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        if (window.confirm('Remove this from your profile?')) {
                          deleteMut.mutate(lightbox.id)
                        }
                      }}
                      disabled={deleteMut.isPending}
                    >
                      Delete
                    </button>
                  )}
                  {user && !isOwn && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => openReport('media', lightbox.id)}
                    >
                      Report
                    </button>
                  )}
                  <button type="button" className="btn btn-dark btn-sm" onClick={() => setLightbox(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {reportTarget && (
          <div
            className="report-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-dialog-title"
            onClick={() => setReportTarget(null)}
          >
            <div className="report-dialog" onClick={(e) => e.stopPropagation()}>
              <h2 id="report-dialog-title">
                Report {reportTarget.type === 'user' ? 'this player' : 'this content'}
              </h2>
              {reportMsg && !reportMut.isError ? (
                <p className="report-dialog-body">{reportMsg}</p>
              ) : (
                <>
                  <p className="report-dialog-body">
                    Tell us what is wrong (e.g. offensive, harassment, spam, inappropriate).
                  </p>
                  <textarea
                    className="form-textarea"
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    maxLength={1000}
                    rows={4}
                  />
                  {reportMsg && <p className="form-error">{reportMsg}</p>}
                </>
              )}
              <div className="report-dialog-actions">
                {!(reportMsg && !reportMut.isError) && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={reportReason.trim().length < 3 || reportMut.isPending}
                    onClick={() => reportMut.mutate()}
                  >
                    {reportMut.isPending ? 'Sending…' : 'Send report'}
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportTarget(null)}>
                  {reportMsg && !reportMut.isError ? 'Done' : 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
