"""Minimal Resend wrapper. Never raises: failures are logged so callers keep working."""

from __future__ import annotations

import html
import logging
import re
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Court green - matches the product brand
_BRAND = "#0b3d2e"
_BRAND_SOFT = "#e8f2ee"
_INK = "#14201b"
_MUTED = "#5c6b64"
_LINE = "#e4ebe7"
_BG = "#eef3f0"
_CARD = "#ffffff"

_URL_RE = re.compile(r"(https?://[^\s<]+)")


def send_email(
    *,
    to: str,
    subject: str,
    text: str,
    html_body: str | None = None,
    reply_to: str | None = None,
) -> bool:
    settings = get_settings()
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set; email not sent. Subject: %s\n%s", subject, text)
        return False
    try:
        import resend

        resend.api_key = settings.resend_api_key
        params: dict[str, Any] = {
            "from": settings.email_from,
            "to": [to],
            "subject": subject,
            "text": text,
        }
        if html_body:
            params["html"] = html_body
        if reply_to:
            params["reply_to"] = reply_to
        resend.Emails.send(params)
        return True
    except Exception:
        logger.exception("Failed to send email: %s", subject)
        return False


def brand_logo_url() -> str:
    """Absolute logo URL for HTML emails (email clients need a public https image)."""
    front = (get_settings().frontend_url or "").rstrip("/")
    if not front or "localhost" in front or "127.0.0.1" in front:
        front = "https://www.studentpadel.ie"
    return f"{front}/images/spi-logo.png"


def site_home_url() -> str:
    front = (get_settings().frontend_url or "").rstrip("/")
    if not front or "localhost" in front or "127.0.0.1" in front:
        return "https://www.studentpadel.ie"
    return front


def _linkify(text: str) -> str:
    """Escape text and turn bare https URLs into branded links."""
    parts: list[str] = []
    last = 0
    for match in _URL_RE.finditer(text):
        parts.append(html.escape(text[last : match.start()]).replace("\n", "<br>"))
        raw = match.group(1)
        trailing = ""
        while raw and raw[-1] in ".,);:!?]'\"":
            trailing = raw[-1] + trailing
            raw = raw[:-1]
        if raw:
            safe_href = html.escape(raw, quote=True)
            safe_label = html.escape(raw)
            parts.append(
                f'<a href="{safe_href}" style="color:{_BRAND};font-weight:600;text-decoration:underline;"'
                f' target="_blank" rel="noopener">{safe_label}</a>'
            )
        parts.append(html.escape(trailing))
        last = match.end()
    parts.append(html.escape(text[last:]).replace("\n", "<br>"))
    return "".join(parts)


def _cta_button(*, label: str, url: str, primary: bool = True) -> str:
    safe_label = html.escape(label)
    safe_url = html.escape(url, quote=True)
    if primary:
        return f"""
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
                <tr>
                  <td style="border-radius:10px;background:{_BRAND};">
                    <a href="{safe_url}"
                       style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:700;
                              color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.01em;">
                      {safe_label}
                    </a>
                  </td>
                </tr>
              </table>"""
    return f"""
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
                <tr>
                  <td style="border-radius:10px;border:1.5px solid {_BRAND};background:{_CARD};">
                    <a href="{safe_url}"
                       style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:700;
                              color:{_BRAND};text-decoration:none;border-radius:10px;">
                      {safe_label}
                    </a>
                  </td>
                </tr>
              </table>"""


def render_simple_email(
    *,
    title: str,
    greeting: str,
    paragraphs: list[str],
    detail_lines: list[tuple[str, str]] | None = None,
    schedule_lines: list[str] | None = None,
    schedule_heading: str = "Your schedule",
    cta_label: str,
    cta_url: str,
    secondary_cta_label: str | None = None,
    secondary_cta_url: str | None = None,
    footer: str = "Student Padel Ireland",
    preheader: str | None = None,
) -> tuple[str, str]:
    """Return (plain_text, html) for a branded transactional email."""
    safe_title = html.escape(title)
    safe_greeting = html.escape(greeting)
    safe_footer = html.escape(footer)
    logo = html.escape(brand_logo_url(), quote=True)
    home = html.escape(site_home_url(), quote=True)
    preview = html.escape((preheader or title).strip())

    text_parts = [greeting, "", title, ""]
    for p in paragraphs:
        text_parts.append(p)
        text_parts.append("")
    if detail_lines:
        for label, value in detail_lines:
            text_parts.append(f"{label}: {value}")
        text_parts.append("")
    if schedule_lines:
        text_parts.append(schedule_heading)
        for line in schedule_lines:
            text_parts.append(f"· {line}")
        text_parts.append("")
    text_parts.append(f"{cta_label}: {cta_url}")
    if secondary_cta_label and secondary_cta_url:
        text_parts.append(f"{secondary_cta_label}: {secondary_cta_url}")
    text_parts.append("")
    text_parts.append(footer)
    text_parts.append(site_home_url())
    text = "\n".join(text_parts)

    para_html = "".join(
        f'<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:{_INK};">{_linkify(p)}</p>'
        for p in paragraphs
    )

    detail_html = ""
    if detail_lines:
        rows = "".join(
            (
                "<tr>"
                f'<td style="padding:10px 0;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;'
                f'color:{_MUTED};vertical-align:top;width:72px;font-weight:700;">{html.escape(label)}</td>'
                f'<td style="padding:10px 0;font-size:15px;color:{_INK};font-weight:600;'
                f'vertical-align:top;">{html.escape(value)}</td>'
                "</tr>"
            )
            for label, value in detail_lines
        )
        detail_html = (
            f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
            f'style="width:100%;margin:8px 0 22px;background:{_BRAND_SOFT};border-radius:12px;'
            f'padding:4px 16px;">{rows}</table>'
        )

    schedule_html = ""
    if schedule_lines:
        rows_html: list[str] = []
        for line in schedule_lines:
            bits = [b.strip() for b in line.split(" · ")]
            time_bit = html.escape(bits[0]) if bits else html.escape(line)
            rest = html.escape(" · ".join(bits[1:])) if len(bits) > 1 else ""
            rows_html.append(
                "<tr>"
                f'<td style="padding:12px 14px;border-bottom:1px solid {_LINE};vertical-align:top;'
                f'width:64px;font-size:15px;font-weight:700;color:{_BRAND};white-space:nowrap;">'
                f"{time_bit}</td>"
                f'<td style="padding:12px 14px 12px 0;border-bottom:1px solid {_LINE};'
                f'font-size:14px;line-height:1.4;color:{_INK};">{rest}</td>'
                "</tr>"
            )
        # Drop border on last row
        if rows_html:
            rows_html[-1] = (
                rows_html[-1]
                .replace(f'border-bottom:1px solid {_LINE};', "border-bottom:none;", 2)
            )
        schedule_html = (
            f'<p style="margin:4px 0 10px;font-size:12px;font-weight:700;letter-spacing:0.06em;'
            f'color:{_MUTED};text-transform:uppercase;">{html.escape(schedule_heading)}</p>'
            f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
            f'style="width:100%;margin:0 0 22px;background:{_CARD};border:1px solid {_LINE};'
            f'border-radius:12px;overflow:hidden;">{"".join(rows_html)}</table>'
        )

    primary_cta = _cta_button(label=cta_label, url=cta_url, primary=True)
    secondary_cta = ""
    if secondary_cta_label and secondary_cta_url:
        secondary_cta = _cta_button(
            label=secondary_cta_label, url=secondary_cta_url, primary=False
        )

    safe_cta_url = html.escape(cta_url, quote=True)

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>{safe_title}</title>
  <!--[if mso]><style>body,table,td{{font-family:Arial,sans-serif !important;}}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:{_BG};font-family:Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{preview}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:{_BG};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
               style="max-width:520px;background:{_CARD};border-radius:16px;border:1px solid {_LINE};
                      overflow:hidden;box-shadow:0 8px 28px rgba(11,61,46,0.08);">
          <tr>
            <td style="background:{_BRAND};padding:22px 28px;text-align:center;">
              <a href="{home}" style="text-decoration:none;display:inline-block;">
                <img src="{logo}" width="48" height="45" alt="Student Padel Ireland"
                     style="display:block;margin:0 auto 10px;border:0;outline:none;" />
                <span style="display:block;font-size:15px;letter-spacing:0.06em;font-weight:700;
                             color:#ffffff;text-transform:uppercase;">
                  Student Padel Ireland
                </span>
              </a>
            </td>
          </tr>
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#1a6b52 0%,#0b3d2e 50%,#c4a35a 100%);
                       font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 28px 12px;">
              <p style="margin:0 0 8px;font-size:14px;color:{_MUTED};">{safe_greeting}</p>
              <h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:{_BRAND};font-weight:700;">
                {safe_title}
              </h1>
              {para_html}
              {detail_html}
              {schedule_html}
              {primary_cta}
              {secondary_cta}
              <p style="margin:4px 0 0;font-size:12px;line-height:1.45;color:{_MUTED};">
                Button not working?
                <a href="{safe_cta_url}" style="color:{_BRAND};text-decoration:underline;">Open this link</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 28px;border-top:1px solid {_LINE};background:#fbfcfb;">
              <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:{_BRAND};">{safe_footer}</p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:{_MUTED};">
                Ireland’s student padel tournaments ·
                <a href="{home}" style="color:{_BRAND};text-decoration:none;font-weight:600;">studentpadel.ie</a>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;line-height:1.4;color:#8a9690;max-width:520px;">
          You’re receiving this because you’re registered for an event on Student Padel Ireland.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>"""
    return text, html_body
