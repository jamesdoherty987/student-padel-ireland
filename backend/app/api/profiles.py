"""Player profile bio + media uploads."""

from __future__ import annotations

import uuid
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
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


def _media_url(user_id: UUID, filename: str) -> str:
    # Store relative paths; absolutize on read so the frontend host can load them
    return f"/uploads/profiles/{user_id}/{filename}"


def _public_url(url: str | None) -> str | None:
    """Ensure media URLs are absolute so a separate frontend host can load them."""
    if not url:
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("/"):
        return f"{get_settings().backend_url.rstrip('/')}{url}"
    return url


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
        avatar_url=_public_url(user.avatar_url),
        media=[
            ProfileMediaOut(
                id=m.id,
                media_type=m.media_type,
                url=_public_url(m.url) or m.url,
                caption=m.caption,
                sort_order=m.sort_order,
                is_avatar=m.is_avatar,
                created_at=m.created_at,
            )
            for m in media_rows
        ],
        is_own_profile=bool(viewer and viewer.id == user.id),
    )


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
        ext = ALLOWED_IMAGE[content_type]
        max_bytes = MAX_IMAGE_BYTES
    elif content_type in ALLOWED_VIDEO:
        media_type = "video"
        ext = ALLOWED_VIDEO[content_type]
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

    folder = UPLOAD_ROOT / str(user.id)
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    path = folder / filename
    path.write_bytes(data)

    url = _media_url(user.id, filename)
    want_avatar = set_as_avatar or (media_type == "image" and count == 0)
    if want_avatar:
        db.query(ProfileMedia).filter(
            ProfileMedia.user_id == user.id, ProfileMedia.is_avatar.is_(True)
        ).update({"is_avatar": False})
        user.avatar_url = url
        is_avatar = True
    else:
        is_avatar = False

    item = ProfileMedia(
        user_id=user.id,
        media_type=media_type,
        url=url,
        caption=(caption or "").strip()[:200] or None,
        sort_order=count,
        is_avatar=is_avatar,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return ProfileMediaOut(
        id=item.id,
        media_type=item.media_type,
        url=_public_url(item.url) or item.url,
        caption=item.caption,
        sort_order=item.sort_order,
        is_avatar=item.is_avatar,
        created_at=item.created_at,
    )


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
    return ProfileMediaOut.model_validate(item)


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
    user.avatar_url = item.url
    db.commit()
    db.refresh(user)
    return _profile_out(db, user, user)


@router.delete("/me/profile/media/{media_id}")
def delete_profile_media(
    media_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(ProfileMedia, media_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Media not found")

    # Best-effort delete local file
    try:
        # url .../uploads/profiles/{uid}/{file}
        filename = item.url.rstrip("/").split("/")[-1]
        path = UPLOAD_ROOT / str(user.id) / filename
        if path.is_file():
            path.unlink()
    except OSError:
        pass

    was_avatar = item.is_avatar
    db.delete(item)
    if was_avatar:
        next_img = (
            db.query(ProfileMedia)
            .filter(ProfileMedia.user_id == user.id, ProfileMedia.media_type == "image")
            .order_by(ProfileMedia.sort_order)
            .first()
        )
        if next_img:
            next_img.is_avatar = True
            user.avatar_url = next_img.url
        else:
            user.avatar_url = None
    db.commit()
    return {"ok": True}
