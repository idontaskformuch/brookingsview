"""Tests for the image-pipeline overhaul (see NEEDS-HUMAN-REVIEW.md, "Image
pipeline overhaul") -- per-content-type style prompts, the real-people
guardrail surviving the style change, and the center-crop math for the
4:3/1:1 variants. No network calls -- _center_crop/_build_prompt are pure.
"""
from PIL import Image

from content.illustrations.generate_illustration import _build_prompt, _center_crop
from config.image_model import STYLE_PROMPTS, DEFAULT_STYLE_PROMPT


def test_build_prompt_uses_content_type_style():
    prompt = _build_prompt("A bake sale downtown", "vardagsmiddag")
    assert STYLE_PROMPTS["vardagsmiddag"] in prompt
    assert "Theme: A bake sale downtown" in prompt


def test_build_prompt_falls_back_for_unknown_content_type():
    prompt = _build_prompt("Something", "not_a_real_content_type")
    assert DEFAULT_STYLE_PROMPT in prompt


def test_build_prompt_falls_back_for_missing_content_type():
    prompt = _build_prompt("Something", None)
    assert DEFAULT_STYLE_PROMPT in prompt


def test_every_style_prompt_keeps_the_no_real_people_guardrail():
    # The style went from illustrated to photorealistic specifically -- this
    # guardrail matters MORE now, not less (a photorealistic image of a
    # fabricated "identifiable" person reads as a real photo in a way a
    # cartoon never did). Checked via the actual built prompt, not just the
    # style string, so a future refactor can't silently drop it.
    for content_type in STYLE_PROMPTS:
        prompt = _build_prompt("Theme", content_type)
        assert "no real or identifiable people" in prompt


def test_center_crop_4x3_from_16x9_trims_width_not_height():
    image = Image.new("RGB", (1600, 900))
    cropped = _center_crop(image, 4 / 3)
    assert cropped.size == (1200, 900)


def test_center_crop_1x1_from_16x9():
    image = Image.new("RGB", (1600, 900))
    cropped = _center_crop(image, 1 / 1)
    assert cropped.size == (900, 900)


def test_center_crop_is_centered_not_left_aligned():
    # A 4x1 source cropped to a 1:1 target keeps a single centered pixel
    # (new_width = height * ratio = 1), not the leftmost or rightmost one.
    image = Image.new("RGB", (4, 1))
    image.putpixel((0, 0), (255, 0, 0))    # left edge -- must be cropped out
    image.putpixel((1, 0), (0, 255, 0))    # centered -- kept
    image.putpixel((2, 0), (0, 255, 0))
    image.putpixel((3, 0), (0, 0, 255))    # right edge -- must be cropped out
    cropped = _center_crop(image, 1 / 1)
    assert cropped.size == (1, 1)
    pixel = cropped.getpixel((0, 0))
    assert pixel != (255, 0, 0) and pixel != (0, 0, 255)
