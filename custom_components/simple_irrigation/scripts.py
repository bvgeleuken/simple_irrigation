"""Which script a run actually calls: the installation's, or a slot's override.

The installation configures one pre-start and one post-run script. A schedule
slot may *override* either of them — the lawn slot sends the robot mower home,
the drip-line slot leaves it mowing. The override is a replacement, not an
addition: exactly one script runs per phase, so ``override_… = True`` with an
empty entity_id means "no script for this slot" rather than "fall back".

Scripts deliberately live on the slot and not on the zone: zones run in
parallel phases, so a per-zone script would have no single point in the
pipeline to run at. Do not mix lawn and drip zones in one slot when they need
different preparation — split them into two slots instead.

When several slots fire at the same minute their phases are merged into one
run, and a run has one pre-start and one post-run script. The first overriding
slot in the merge wins; a disagreement is logged so it does not stay silent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .models import Installation, ScheduleSlot

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScriptCall:
    """One resolved script; ``entity_id`` empty means there is nothing to run."""

    entity_id: str
    timeout_sec: int


def _resolve(
    kind: str,
    global_entity: str,
    global_timeout: int,
    overrides: list[tuple[str, str, int | None]],
) -> ScriptCall:
    """Pick the effective script from the installation and the slots' overrides.

    ``overrides`` holds ``(slot_id, entity_id, timeout_sec_or_None)`` for the
    overriding slots only, in run order.
    """
    fallback_timeout = max(1, int(global_timeout))
    if not overrides:
        return ScriptCall(str(global_entity or "").strip(), fallback_timeout)

    slot_id, entity_id, timeout = overrides[0]
    chosen = ScriptCall(
        str(entity_id or "").strip(),
        max(1, int(timeout)) if timeout else fallback_timeout,
    )

    disagreeing = [
        sid for sid, other, _t in overrides[1:] if str(other or "").strip() != chosen.entity_id
    ]
    if disagreeing:
        _LOGGER.warning(
            "Slots %s fire together but define different %s scripts; using %s from slot %s",
            ", ".join([slot_id, *disagreeing]),
            kind,
            chosen.entity_id or "no script",
            slot_id,
        )
    return chosen


def effective_pre_start_script(
    inst: Installation, slots: list[ScheduleSlot]
) -> ScriptCall:
    """Script to run before the pre-start outputs come up."""
    return _resolve(
        "pre-start",
        inst.pre_start_script,
        inst.pre_start_script_timeout_sec,
        [
            (s.slot_id, s.pre_start_script, s.pre_start_script_timeout_sec)
            for s in slots
            if s.override_pre_start_script
        ],
    )


def effective_post_run_script(
    inst: Installation, slots: list[ScheduleSlot]
) -> ScriptCall:
    """Script to run once every output is off again."""
    return _resolve(
        "post-run",
        inst.post_run_script,
        inst.post_run_script_timeout_sec,
        [
            (s.slot_id, s.post_run_script, s.post_run_script_timeout_sec)
            for s in slots
            if s.override_post_run_script
        ],
    )
