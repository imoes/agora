"""Fetch Open Graph / meta-tag previews for URLs."""

import re
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.models.user import User
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/link-preview", tags=["link-preview"])

_OG_RE = re.compile(
    r'<meta\s+(?:[^>]*?)'
    r'(?:property|name)\s*=\s*["\']?(og:|twitter:)([^"\'\s>]+)["\']?\s+'
    r'content\s*=\s*["\']([^"\']*)["\']'
    r'|'
    r'content\s*=\s*["\']([^"\']*)["\']?\s+'
    r'(?:property|name)\s*=\s*["\']?(og:|twitter:)([^"\'\s>]+)["\']?',
    re.IGNORECASE,
)

_TITLE_RE = re.compile(r"<title[^>]*>([^<]+)</title>", re.IGNORECASE)
_DESC_RE = re.compile(
    r'<meta\s+name\s*=\s*["\']description["\']\s+content\s*=\s*["\']([^"\']*)["\']',
    re.IGNORECASE,
)


def _parse_meta(html: str) -> dict:
    """Extract Open Graph and fallback meta tags from HTML."""
    og: dict[str, str] = {}
    for m in _OG_RE.finditer(html[:30_000]):
        if m.group(1):  # property=og:X content=Y
            key = m.group(2).lower()
            val = m.group(3)
        else:  # content=Y property=og:X
            key = m.group(6).lower()
            val = m.group(4)
        if key not in og:
            og[key] = val

    title = og.get("title", "")
    description = og.get("description", "")
    image = og.get("image", "")
    site_name = og.get("site_name", "")

    # Fallback to <title> and <meta name="description">
    if not title:
        m = _TITLE_RE.search(html[:10_000])
        if m:
            title = m.group(1).strip()
    if not description:
        m = _DESC_RE.search(html[:30_000])
        if m:
            description = m.group(1).strip()

    return {
        "title": title[:300],
        "description": description[:500],
        "image": image,
        "site_name": site_name,
    }


@router.get("/")
async def get_link_preview(
    url: str = Query(..., min_length=5),
    current_user: User = Depends(get_current_user),
):
    """Fetch Open Graph metadata for a given URL."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http/https URLs")

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=6.0
        ) as client:
            resp = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; AgoraBot/1.0)",
                    "Accept": "text/html",
                },
            )
            if resp.status_code >= 400:
                raise HTTPException(status_code=404, detail="URL not reachable")
            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type:
                return {"url": url, "title": "", "description": "", "image": "", "site_name": ""}
            html = resp.text
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not fetch URL")

    meta = _parse_meta(html)
    meta["url"] = url
    return meta
