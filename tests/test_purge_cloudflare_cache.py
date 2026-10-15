"""Tests for scripts/purge_cloudflare_cache.py -- purge_everything() is the
one function worth testing directly (it's the whole logic: build the
request, decide success/failure); main()'s argparse/env-var wiring isn't,
same convention as the rest of this codebase's script tests.
"""
from unittest.mock import MagicMock, patch

import pytest

from scripts.purge_cloudflare_cache import purge_everything


def _mock_response(status_code: int, json_body: dict) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.ok = 200 <= status_code < 300
    resp.json.return_value = json_body
    return resp


@patch("scripts.purge_cloudflare_cache.requests.post")
def test_purge_everything_succeeds_on_a_real_success_response(mock_post):
    mock_post.return_value = _mock_response(200, {"success": True, "result": {"id": "abc"}})
    purge_everything("zone123", "token123")

    call = mock_post.call_args
    assert call.args[0] == "https://api.cloudflare.com/client/v4/zones/zone123/purge_cache"
    assert call.kwargs["headers"]["Authorization"] == "Bearer token123"
    assert call.kwargs["json"] == {"purge_everything": True}


@patch("scripts.purge_cloudflare_cache.requests.post")
def test_purge_everything_raises_on_http_error_status(mock_post):
    mock_post.return_value = _mock_response(403, {"success": False, "errors": [{"message": "bad token"}]})
    with pytest.raises(RuntimeError, match="403"):
        purge_everything("zone123", "token123")


@patch("scripts.purge_cloudflare_cache.requests.post")
def test_purge_everything_raises_when_cloudflare_reports_success_false_despite_200(mock_post):
    # Cloudflare's API can return HTTP 200 with success:false in the body --
    # checking only the status code would silently miss this.
    mock_post.return_value = _mock_response(200, {"success": False, "errors": [{"message": "zone not found"}]})
    with pytest.raises(RuntimeError, match="zone not found"):
        purge_everything("zone123", "token123")


@patch("scripts.purge_cloudflare_cache.requests.post")
def test_purge_everything_raises_on_a_non_json_response(mock_post):
    resp = MagicMock()
    resp.status_code = 502
    resp.ok = False
    resp.json.side_effect = ValueError("not json")
    resp.text = "<html>Bad Gateway</html>"
    mock_post.return_value = resp
    with pytest.raises(RuntimeError, match="502"):
        purge_everything("zone123", "token123")
