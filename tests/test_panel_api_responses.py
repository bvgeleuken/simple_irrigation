"""Every panel error response must reach the frontend as a status code.

``HomeAssistantView.json()`` takes ``status_code``; passing ``status`` raises
TypeError inside the handler, so the browser sees a 500 "Server got itself in
trouble" and the panel prints its generic fallback instead of the translated
error. Nothing in the request path catches that, which is exactly why it went
unnoticed — every validation error in the panel API was affected.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from homeassistant.components.http import HomeAssistantView

import custom_components.simple_irrigation.panel_api as panel_api

SOURCE = Path(inspect.getfile(panel_api)).read_text(encoding="utf-8")


def _json_call_keywords() -> list[tuple[int, str]]:
    """(line, keyword) for every `self.json(...)` keyword argument in the module."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(SOURCE)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "json"):
            continue
        if not (isinstance(func.value, ast.Name) and func.value.id == "self"):
            continue
        for kw in node.keywords:
            if kw.arg is not None:
                found.append((node.lineno, kw.arg))
    return found


def test_json_calls_use_keywords_the_view_actually_accepts() -> None:
    allowed = set(inspect.signature(HomeAssistantView.json).parameters) - {"self"}
    bad = [(line, kw) for line, kw in _json_call_keywords() if kw not in allowed]
    assert not bad, f"self.json() called with unsupported keyword(s): {bad}"


def test_error_responses_are_actually_present() -> None:
    """Guard against the check above passing because the calls disappeared."""
    keywords = [kw for _line, kw in _json_call_keywords()]
    assert keywords.count("status_code") > 20
