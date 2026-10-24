"""Minimal Resend wrapper. Never raises: failures are logged so callers keep working."""

from __future__ import annotations

import html
import logging
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Court green — matches the product brand
_BRAND = "#0b3d2e"
_INK = "#14201b"
_MUTED = "#5c6b64"
_LINE = "#e4ebe7"
_BG = "#f6f8f7"


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


def render_simple_email(
    *,
    title: str,
    greeting: str,
    paragraphs: list[str],
    detail_lines: list[tuple[str, str]] | None = None,
    cta_label: str,
    cta_url: str,
    footer: str = "Student Padel Ireland",
) -> tuple[str, str]:
    """Return (plain_text, html) for a clean transactional email with one CTA button."""
    safe_title = html.escape(title)
    safe_greeting = html.escape(greeting)
    safe_footer = html.escape(footer)
    safe_cta_label = html.escape(cta_label)
    safe_cta_url = html.escape(cta_url, quote=True)

    text_parts = [greeting, "", title, ""]
    for p in paragraphs:
        text_parts.append(p)
        text_parts.append("")
    if detail_lines:
        for label, value in detail_lines:
            text_parts.append(f"{label}: {value}")
        text_parts.append("")
    text_parts.append(f"{cta_label}: {cta_url}")
    text_parts.append("")
    text_parts.append(footer)
    text = "\n".join(text_parts)

    para_html = "".join(
        f'<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:{_INK};">'
        f"{html.escape(p)}</p>"
        for p in paragraphs
    )

    detail_html = ""
    if detail_lines:
        rows = "".join(
            (
                "<tr>"
                f'<td style="padding:8px 0;font-size:13px;color:{_MUTED};vertical-align:top;'
                f'width:88px;">{html.escape(label)}</td>'
                f'<td style="padding:8px 0;font-size:15px;color:{_INK};font-weight:600;'
                f'vertical-align:top;">{html.escape(value)}</td>'
                "</tr>"
            )
            for label, value in detail_lines
        )
        detail_html = (
            f'<table role="presentation" cellpadding="0" cellspacing="0" '
            f'style="width:100%;margin:4px 0 20px;border-top:1px solid {_LINE};'
            f'border-bottom:1px solid {_LINE};">{rows}</table>'
        )

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:{_BG};font-family:Outfit,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:{_BG};padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
               style="max-width:480px;background:#ffffff;border-radius:14px;border:1px solid {_LINE};overflow:hidden;">
          <tr>
            <td style="background:{_BRAND};padding:18px 24px;">
              <p style="margin:0;font-size:13px;letter-spacing:0.04em;font-weight:700;color:#ffffff;">
                Student Padel Ireland
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;">
              <p style="margin:0 0 6px;font-size:14px;color:{_MUTED};">{safe_greeting}</p>
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:{_BRAND};font-weight:700;">
                {safe_title}
              </h1>
              {para_html}
              {detail_html}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
                <tr>
                  <td style="border-radius:10px;background:{_BRAND};">
                    <a href="{safe_cta_url}"
                       style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;
                              color:#ffffff;text-decoration:none;border-radius:10px;">
                      {safe_cta_label}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;line-height:1.45;color:{_MUTED};">
                Button not working?
                <a href="{safe_cta_url}" style="color:{_BRAND};">Open this link</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 22px;border-top:1px solid {_LINE};">
              <p style="margin:0;font-size:12px;color:{_MUTED};">{safe_footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
    return text, html_body
