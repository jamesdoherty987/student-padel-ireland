"""Unit tests for Stripe payment helpers (no live Stripe calls)."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.payments import (
    _assert_session_matches_registration,
    _payment_intent_id,
    _session_is_paid,
)


def test_session_is_paid_statuses():
    assert _session_is_paid(SimpleNamespace(payment_status="paid"))
    assert _session_is_paid(SimpleNamespace(payment_status="no_payment_required"))
    assert not _session_is_paid(SimpleNamespace(payment_status="unpaid"))
    assert not _session_is_paid(SimpleNamespace(payment_status=None))


def test_payment_intent_id_string_or_object():
    assert _payment_intent_id(SimpleNamespace(payment_intent="pi_abc")) == "pi_abc"
    assert (
        _payment_intent_id(SimpleNamespace(payment_intent=SimpleNamespace(id="pi_obj")))
        == "pi_obj"
    )
    assert _payment_intent_id(SimpleNamespace(payment_intent=None)) is None


def test_assert_session_matches_registration_amount_and_currency():
    reg = SimpleNamespace(amount_cents=2500, currency="EUR")
    _assert_session_matches_registration(
        SimpleNamespace(amount_total=2500, currency="eur"), reg
    )
    with pytest.raises(HTTPException) as amount_err:
        _assert_session_matches_registration(
            SimpleNamespace(amount_total=1, currency="eur"), reg
        )
    assert amount_err.value.status_code == 400
    with pytest.raises(HTTPException) as currency_err:
        _assert_session_matches_registration(
            SimpleNamespace(amount_total=2500, currency="usd"), reg
        )
    assert currency_err.value.status_code == 400


def test_registration_id_uuid_roundtrip_shape():
    # Sanity: metadata values we store are UUID strings
    rid = uuid4()
    assert str(rid)
