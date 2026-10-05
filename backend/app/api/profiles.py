"""Player profile bio + media uploads."""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_optional_user
from app.core.config import get_settings
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.models import ProfileMedia, Ranking, University, User
from app.schemas import (
    ProfileMediaCaptionUpdate,
    ProfileMediaOut,
    ProfileUpdate,
    UserProfilePublic,
)
from app.services.rating import INITIAL_RATING

router = APIRouter(tags=["profiles"])

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "profiles"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_VIDEO_BYTES = 25 * 1024 * 1024
MAX_MEDIA_PER_USER = 12

ALLOWED_IMAGE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
ALLOWED_VIDEO = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}


def _api_media_path(media_id: UUID) -> str:
    """Stable API path so media is served from DB (survives ephemeral disks)."""
    return f"/api/media/{media_id}"


def _public_url(url: str | None) -> str | None:
    """Ensure media URLs are absolute so a separate frontend host can load them."""
    if not url:
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("/"):
        return f"{get_settings().backend_url.rstrip('/')}{url}"
    return url


def _media_out(m: ProfileMedia) -> ProfileMediaOut:
    # Always serve via API so DB-backed and legacy-disk media share one URL.
    path = _api_media_path(m.id)
    return ProfileMediaOut(
        id=m.id,
        media_type=m.media_type,
        url=_public_url(path) or path,
        caption=m.caption,
        sort_order=m.sort_order,
        is_avatar=m.is_avatar,
        created_at=m.created_at,
    )


def _avatar_public(user: User, media_rows: list[ProfileMedia]) -> str | None:
    avatar = next((m for m in media_rows if m.is_avatar), None)
    if avatar:
        return _media_out(avatar).url
    if user.avatar_url:
        return _public_url(user.avatar_url)
    return None


def _disk_cache_path(user_id: UUID, media_id: UUID, content_type: str | None) -> Path:
    ext = ".bin"
    ctype = (content_type or "").lower()
    for mapping in (ALLOWED_IMAGE, ALLOWED_VIDEO):
        if ctype in mapping:
            ext = mapping[ctype]
            break
    return UPLOAD_ROOT / str(user_id) / f"{media_id}{ext}"


def _load_media_bytes(item: ProfileMedia) -> tuple[bytes, str] | None:
    """Return (bytes, content_type) from DB or legacy/local disk cache."""
    ctype = (item.content_type or "").strip()
    if item.file_data is not None:
        if not ctype:
            ctype = "video/mp4" if item.media_type == "video" else "image/jpeg"
        return bytes(item.file_data), ctype

    # Prefer id-keyed cache written by newer uploads
    for mapping in (ALLOWED_IMAGE, ALLOWED_VIDEO):
        for candidate_ctype, ext in mapping.items():
            path = UPLOAD_ROOT / str(item.user_id) / f"{item.id}{ext}"
            if path.is_file():
                return path.read_bytes(), candidate_ctype

    # Legacy /uploads/profiles/{uid}/{filename} URLs
    try:
        raw = item.url or ""
        if "/uploads/profiles/" in raw:
            filename = raw.rstrip("/").split("/")[-1]
            path = UPLOAD_ROOT / str(item.user_id) / filename
            if path.is_file():
                data = path.read_bytes()
                if not ctype:
                    suffix = path.suffix.lower()
                    ctype = {
                        ".jpg": "image/jpeg",
                        ".jpeg": "image/jpeg",
                        ".png": "image/png",
                        ".webp": "image/webp",
                        ".gif": "image/gif",
                        ".mp4": "video/mp4",
                        ".webm": "video/webm",
                        ".mov": "video/quicktime",
                    }.get(suffix, "application/octet-stream")
                return data, ctype
    except OSError:
        pass
    return None


def _profile_out(
    db: Session, user: User, viewer: User | None
) -> UserProfilePublic:
    ranking = db.query(Ranking).filter(Ranking.user_id == user.id).first()
    uni = db.get(University, user.university_id) if user.university_id else None
    media_rows = (
        db.query(ProfileMedia)
        .filter(ProfileMedia.user_id == user.id)
        .order_by(ProfileMedia.sort_order, ProfileMedia.created_at)
        .all()
    )
    return UserProfilePublic(
        id=user.id,
        full_name=user.full_name,
        university_name=uni.name if uni else None,
        university_short=uni.short_name if uni else None,
        points=ranking.points if ranking else INITIAL_RATING,
        rank_ireland=ranking.rank_ireland if ranking else None,
        tournaments_played=ranking.tournaments_played if ranking else 0,
        matches_played=ranking.matches_played if ranking else 0,
        wins=ranking.wins if ranking else 0,
        losses=ranking.losses if ranking else 0,
        bio=user.bio,
        avatar_url=_avatar_public(user, media_rows),
        media=[_media_out(m) for m in media_rows],
        is_own_profile=bool(viewer and viewer.id == user.id),
    )


def _range_response(data: bytes, content_type: str, request: Request) -> Response:
    """Serve bytes with Accept-Ranges so HTML5 video can seek / buffer."""
    size = len(data)
    range_header = request.headers.get("range")
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
        "Content-Type": content_type,
    }
    if not range_header or not range_header.startswith("bytes="):
        return Response(content=data, media_type=content_type, headers={**headers, "Content-Length": str(size)})

    try:
        spec = range_header.replace("bytes=", "").strip().split(",")[0]
        start_s, end_s = (spec.split("-", 1) + [""])[:2]
        start = int(start_s) if start_s else 0
        end = int(end_s) if end_s else size - 1
    except ValueError:
        return Response(content=data, media_type=content_type, headers={**headers, "Content-Length": str(size)})

    if start < 0 or start >= size:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{size}", **headers},
        )
    end = min(end, size - 1)
    chunk = data[start : end + 1]
    headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    headers["Content-Length"] = str(len(chunk))
    return Response(content=chunk, status_code=206, media_type=content_type, headers=headers)


@router.get("/media/{media_id}")
def serve_profile_media(
    media_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
):
    item = db.get(ProfileMedia, media_id)
    if not item:
        raise HTTPException(404, "Media not found")
    loaded = _load_media_bytes(item)
    if not loaded:
        raise HTTPException(404, "Media file missing - please re-upload")
    data, content_type = loaded
    return _range_response(data, content_type, request)


@router.get("/players/{user_id}/profile", response_model=UserProfilePublic)
def get_player_profile(
    user_id: UUID,
    viewer: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(404, "Player not found")
    return _profile_out(db, user, viewer)


@router.patch("/me/profile", response_model=UserProfilePublic)
def update_my_profile(
    body: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = body.model_dump(exclude_unset=True)
    if "bio" in data:
        bio = (data["bio"] or "").strip()
        user.bio = bio[:500] or None
    if "full_name" in data and data["full_name"]:
        name = data["full_name"].strip()
        if "<" in name or ">" in name:
            raise HTTPException(400, "Invalid name")
        user.full_name = name
    db.commit()
    db.refresh(user)
    return _profile_out(db, user, user)


@router.post("/me/profile/media", response_model=ProfileMediaOut)
async def upload_profile_media(
    request: Request,
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
    set_as_avatar: bool = Form(default=False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rate_limit(request, key="profile-upload", limit=20, window_seconds=60)
    count = db.query(ProfileMedia).filter(ProfileMedia.user_id == user.id).count()
    if count >= MAX_MEDIA_PER_USER:
        raise HTTPException(400, f"Maximum {MAX_MEDIA_PER_USER} media items per profile")

    content_type = (file.content_type or "").lower()
    if content_type in ALLOWED_IMAGE:
        media_type = "image"
        max_bytes = MAX_IMAGE_BYTES
    elif content_type in ALLOWED_VIDEO:
        media_type = "video"
        max_bytes = MAX_VIDEO_BYTES
    else:
        raise HTTPException(400, "Only JPEG, PNG, WebP, GIF, MP4, WebM or MOV allowed")

    if set_as_avatar and media_type != "image":
        raise HTTPException(400, "Only photos can be profile pictures")

    data = await file.read()
    if len(data) > max_bytes:
        raise HTTPException(400, f"File too large (max {max_bytes // (1024 * 1024)}MB)")
    if not data:
        raise HTTPException(400, "Empty file")

    # Optional local cache (dev); source of truth is DB file_data.
    folder = UPLOAD_ROOT / str(user.id)
    folder.mkdir(parents=True, exist_ok=True)

    item = ProfileMedia(
        user_id=user.id,
        media_type=media_type,
        url="",  # set after flush so we have an id
        content_type=content_type,
        file_data=data,
        caption=(caption or "").strip()[:200] or None,
        sort_order=count,
        is_avatar=False,
    )
    db.add(item)
    db.flush()
    item.url = _api_media_path(item.id)

    try:
        _disk_cache_path(user.id, item.id, content_type).write_bytes(data)
    except OSError:
        pass

    # Only auto-set avatar for the very first photo when the user has no avatar yet
    want_avatar = set_as_avatar or (
        media_type == "image" and count == 0 and not user.avatar_url
    )
    if want_avatar:
        db.query(ProfileMedia).filter(
            ProfileMedia.user_id == user.id, ProfileMedia.is_avatar.is_(True)
        ).update({"is_avatar": False})
        user.avatar_url = item.url
        item.is_avatar = True

    db.commit()
    db.refresh(item)
    return _media_out(item)


@router.patch("/me/profile/media/{media_id}", response_model=ProfileMediaOut)
def update_media_caption(
    media_id: UUID,
    body: ProfileMediaCaptionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(ProfileMedia, media_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Media not found")
    if body.caption is not None:
        item.caption = body.caption.strip()[:200] or None
    db.commit()
    db.refresh(item)
    return _media_out(item)


@router.post("/me/profile/media/{media_id}/avatar", response_model=UserProfilePublic)
def set_media_as_avatar(
    media_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(ProfileMedia, media_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Media not found")
    if item.media_type != "image":
        raise HTTPException(400, "Only photos can be profile pictures")
    db.query(ProfileMedia).filter(
        ProfileMedia.user_id == user.id, ProfileMedia.is_avatar.is_(True)
    ).update({"is_avatar": False})
    item.is_avatar = True
    user.avatar_url = _api_media_path(item.id)
    db.commit()
    db.refresh(user)
    return _profile_out(db, user, user)


@router.delete("/me/profile/avatar", response_model=UserProfilePublic)
def clear_profile_avatar(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear the profile photo without deleting gallery media."""
    db.query(ProfileMedia).filter(
        ProfileMedia.user_id == user.id, ProfileMedia.is_avatar.is_(True)
    ).update({"is_avatar": False})
    user.avatar_url = None
    db.commit()
    db.refresh(user)
    return _profile_out(db, user, user)


def _avatar_refs_media(user: User, item: ProfileMedia) -> bool:
    if item.is_avatar:
        return True
    path = _api_media_path(item.id)
    refs = {item.url, path, _public_url(path), _public_url(item.url)}
    if user.avatar_url and user.avatar_url in refs:
        return True
    if user.avatar_url and str(item.id) in user.avatar_url:
        return True
    return False


@router.delete("/me/profile/media/{media_id}")
def delete_profile_media(
    media_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(ProfileMedia, media_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Media not found")

    # Best-effort delete local cache file
    try:
        cache = _disk_cache_path(user.id, item.id, item.content_type)
        if cache.is_file():
            cache.unlink()
        raw = item.url or ""
        if "/uploads/profiles/" in raw:
            filename = raw.rstrip("/").split("/")[-1]
            legacy = UPLOAD_ROOT / str(user.id) / filename
            if legacy.is_file():
                legacy.unlink()
    except OSError:
        pass

    clear_avatar = _avatar_refs_media(user, item)
    db.delete(item)
    if clear_avatar:
        # Do not auto-promote another gallery image — that made "Remove photo" look broken
        db.query(ProfileMedia).filter(
            ProfileMedia.user_id == user.id, ProfileMedia.is_avatar.is_(True)
        ).update({"is_avatar": False})
        user.avatar_url = None
    db.commit()
    return {"ok": True}
