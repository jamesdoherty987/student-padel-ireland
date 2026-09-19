import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage, communityApi, platformApi, type ProfileMedia } from '../services/api'
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

export default function PlayerProfilePage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [bioDraft, setBioDraft] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [lightbox, setLightbox] = useState<ProfileMedia | null>(null)
  const [error, setError] = useState('')
  const [asAvatar, setAsAvatar] = useState(false)

  const { data: player, isLoading, isError, refetch } = useQuery({
    queryKey: ['player', id],
    queryFn: async () => (await platformApi.player(id)).data,
    enabled: !!id,
  })

  const isOwn = Boolean(player?.is_own_profile || (user && player && user.id === player.id))
  const media = player?.media || []

  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: !!user && !!player && !isOwn,
  })
  const relation = friendsQ.data?.find((f) => f.user_id === player?.id)

  useEffect(() => {
    document.body.classList.toggle('modal-open', !!lightbox)
    return () => document.body.classList.remove('modal-open')
  }, [lightbox])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  const startUpload = (file: File) => {
    const problem = validateMediaFile(file)
    if (problem) {
      setError(problem)
      return
    }
    // Videos cannot be avatars — clear the flag so the request doesn't fail
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
      setError('')
      if (fileRef.current) fileRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
      qc.invalidateQueries({ queryKey: ['player', id] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (mediaId: string) => platformApi.deleteMedia(mediaId),
    onSuccess: () => {
      setLightbox(null)
      qc.invalidateQueries({ queryKey: ['player', id] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const avatarMut = useMutation({
    mutationFn: (mediaId: string) => platformApi.setAvatar(mediaId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player', id] }),
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

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        {isLoading && (
          <>
            <div className="skeleton" style={{ height: 28, width: '50%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 100 }} />
          </>
        )}
        {isError && (
          <div className="empty-state">
            <h1 className="page-title">Player not found</h1>
            <p className="page-sub">This profile may have been removed.</p>
            <button className="btn btn-ghost" onClick={() => refetch()}>
              Retry
            </button>
            <Link to="/rankings" className="btn btn-primary" style={{ marginLeft: 8 }}>
              Rankings
            </Link>
          </div>
        )}
        {player && (
          <>
            <p className="eyebrow">
              <Link to="/rankings" style={{ color: 'inherit' }}>
                ← Rankings
              </Link>
            </p>

            <div className="profile-header">
              <div className="profile-avatar-wrap">
                {(() => {
                  const avatar = mediaUrl(player.avatar_url)
                  return avatar ? (
                    <img src={avatar} alt="" className="profile-avatar" />
                  ) : (
                    <div className="profile-avatar placeholder">{initials(player.full_name)}</div>
                  )
                })()}
              </div>
              <div>
                <h1 className="page-title" style={{ marginBottom: 4 }}>
                  {player.full_name}
                </h1>
                <p className="page-sub" style={{ marginBottom: 0 }}>
                  {player.university_short || player.university_name || '—'}
                </p>
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
                      <span className="muted-note">Friend request sent</span>
                    )}
                    {relation?.direction === 'friend' && <span className="muted-note">Friends</span>}
                  </div>
                )}
                {!user && (
                  <div className="profile-friend-action">
                    <Link to={`/login?next=${encodeURIComponent(`/players/${player.id}`)}`} className="btn btn-ghost btn-sm">
                      Log in to add friend
                    </Link>
                  </div>
                )}
              </div>
            </div>

            <div className="tour-stats">
              <div>
                <strong>#{player.rank_ireland ?? '—'}</strong>
                <span>Ireland</span>
              </div>
              <div>
                <strong>{player.points}</strong>
                <span>Elo rating</span>
              </div>
              <div>
                <strong>{player.matches_played}</strong>
                <span>Matches</span>
              </div>
              <div>
                <strong>
                  {player.wins}–{player.losses}
                </strong>
                <span>W–L</span>
              </div>
            </div>

            {error && <p className="form-error">{error}</p>}

            <section className="profile-section">
              <h2>About</h2>
              {isOwn && bioDraft !== null ? (
                <div className="profile-bio-edit">
                  <textarea
                    value={bioDraft}
                    onChange={(e) => setBioDraft(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="A short intro — club, hand, favourite shot…"
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
                    <span className="rank-meta">{bioDraft.length}/500</span>
                  </div>
                </div>
              ) : (
                <div className="profile-bio">
                  <p>{player.bio || (isOwn ? 'Add a short bio so friends know who’s on court.' : 'No bio yet.')}</p>
                  {isOwn && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setBioDraft(player.bio || '')}
                    >
                      {player.bio ? 'Edit bio' : 'Add bio'}
                    </button>
                  )}
                </div>
              )}
            </section>

            <section className="profile-section">
              <div className="profile-section-head">
                <h2>Photos & clips</h2>
                {isOwn && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    Add media
                  </button>
                )}
              </div>

              {isOwn && (
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
                    <label className="avatar-check">
                      <input
                        type="checkbox"
                        checked={asAvatar}
                        onChange={(e) => setAsAvatar(e.target.checked)}
                      />
                      Use as profile photo
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
                  {uploadMut.isPending && <p className="muted-note">Uploading…</p>}
                  <p className="muted-note">Photos up to 5MB · short videos up to 25MB (MP4/WebM/MOV).</p>
                </div>
              )}

              {media.length === 0 ? (
                <p className="muted-note">
                  {isOwn ? 'No media yet — add a photo from a match or training.' : 'No media yet.'}
                </p>
              ) : (
                <div className="profile-grid">
                  {media.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="profile-grid-item"
                      onClick={() => setLightbox(m)}
                    >
                      {m.media_type === 'video' ? (
                        <video src={mediaUrl(m.url)} muted playsInline preload="metadata" />
                      ) : (
                        <img src={mediaUrl(m.url)} alt={m.caption || ''} loading="lazy" />
                      )}
                      {m.is_avatar && <span className="media-badge">Photo</span>}
                      {m.media_type === 'video' && <span className="media-badge video">Video</span>}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <div style={{ marginTop: 20 }}>
              <Link to="/community" className="btn btn-ghost">
                Community
              </Link>
            </div>
          </>
        )}

        {lightbox && (
          <div className="lightbox" onClick={() => setLightbox(null)}>
            <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
              {lightbox.media_type === 'video' ? (
                <video src={mediaUrl(lightbox.url)} controls autoPlay playsInline />
              ) : (
                <img src={mediaUrl(lightbox.url)} alt={lightbox.caption || ''} />
              )}
              {lightbox.caption && <p className="lightbox-caption">{lightbox.caption}</p>}
              <div className="lightbox-actions">
                {isOwn && lightbox.media_type === 'image' && !lightbox.is_avatar && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => avatarMut.mutate(lightbox.id)}
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
                  >
                    Delete
                  </button>
                )}
                <button type="button" className="btn btn-dark btn-sm" onClick={() => setLightbox(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
