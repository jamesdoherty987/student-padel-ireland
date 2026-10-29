"""Unit tests for Stripe payment helpers (no live Stripe calls)."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.payments import (
    _as_mapping,
    _assert_session_matches_registration,
    _payment_intent_id,
    _session_field,
    _session_is_paid,
)


class _FakeStripeObject:
    """Mimics stripe.StripeObject: mapping access works, ``.get`` does not."""

    def __init__(self, data: dict):
        self._data = data

    def __getitem__(self, key: str):
        return self._data[key]

    def __iter__(self):
        return iter(self._data)

    def keys(self):
        return self._data.keys()

    def __getattr__(self, key: str):
        if key in {"get", "items", "values", "update", "pop"}:
            raise AttributeError(
                f"'{key}' is a dict method, but a StripeObject is not a dict. "
                "Use .to_dict() to convert it."
            )
        try:
            return self._data[key]
        except KeyError as exc:
            raise AttributeError(key) from exc

    def to_dict(self):
        return dict(self._data)


def test_as_mapping_handles_stripe_metadata_object():
    rid = str(uuid4())
    meta = _FakeStripeObject({"registration_id": rid, "tournament_id": str(uuid4())})
    # Regression: old code did ``(metadata or {}).get(...)`` and crashed here
    with pytest.raises(AttributeError):
        (meta or {}).get("registration_id")
    mapped = _as_mapping(meta)
    assert mapped["registration_id"] == rid


def test_as_mapping_handles_plain_dict_and_none():
    assert _as_mapping(None) == {}
    assert _as_mapping({"registration_id": "abc"})["registration_id"] == "abc"


def test_session_field_dict_and_object():
    assert _session_field({"id": "cs_1"}, "id") == "cs_1"
    assert _session_field(SimpleNamespace(id="cs_2"), "id") == "cs_2"
    assert _session_field(SimpleNamespace(), "missing") is None


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
    reg = SimpleNamespace(amount_cents=2500, currency="EUR", stripe_session_id="cs_other")
    _assert_session_matches_registration(
        SimpleNamespace(id="cs_1", amount_total=2500, currency="eur"), reg
    )
    with pytest.raises(HTTPException) as amount_err:
        _assert_session_matches_registration(
            SimpleNamespace(id="cs_1", amount_total=1, currency="eur"), reg
        )
    assert amount_err.value.status_code == 400
    with pytest.raises(HTTPException) as currency_err:
        _assert_session_matches_registration(
            SimpleNamespace(id="cs_1", amount_total=2500, currency="usd"), reg
        )
    assert currency_err.value.status_code == 400


def test_assert_session_matches_bound_session_syncs_amount():
    """Fee edits after Checkout create must not block a paid bound session."""
    reg = SimpleNamespace(amount_cents=200, currency="EUR", stripe_session_id="cs_live_abc")
    _assert_session_matches_registration(
        SimpleNamespace(id="cs_live_abc", amount_total=400, currency="eur"), reg
    )
    assert reg.amount_cents == 400
    assert reg.currency == "EUR"


def test_registration_id_uuid_roundtrip_shape():
    # Sanity: metadata values we store are UUID strings
    rid = uuid4()
    assert str(rid)
