#!/usr/bin/env python3
"""Prepare a text-only FunctionGemma checkpoint for llama.cpp conversion.

Google's tokenizer advertises two multimodal tokens beyond the 270M text
model's embedding table. Transformers tolerates them because text inference
never emits them; llama.cpp's converter correctly rejects the inconsistent
vocabulary. This creates a separate staging copy and removes only those two
unusable visual tokens. The verified training checkpoint is never modified.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any


VISUAL_ONLY_TOKENS = {"<image_soft_token>", "<end_of_image>"}
FUNCTION_TOKENS = {
    "<start_function_declaration>": 46,
    "<end_function_declaration>": 47,
    "<start_function_call>": 48,
    "<end_function_call>": 49,
    "<start_function_response>": 50,
    "<end_function_response>": 51,
    "<escape>": 52,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    # Break the copied file away from its source before writing in case the
    # staging tree is ever created with reflinks or hardlinks by its caller.
    path.unlink()
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def remove_visual_tokens(path: Path, vocab_size: int) -> list[dict[str, Any]]:
    tokenizer = read_json(path)
    added = tokenizer.get("added_tokens")
    if not isinstance(added, list):
        raise ValueError(f"{path}: expected added_tokens[]")
    removed = [
        entry for entry in added
        if isinstance(entry, dict) and int(entry.get("id", -1)) >= vocab_size
    ]
    names = {str(entry.get("content")) for entry in removed}
    if names != VISUAL_ONLY_TOKENS:
        raise ValueError(
            "refusing to alter unexpected out-of-range tokens: "
            f"{sorted(names)}"
        )
    tokenizer["added_tokens"] = [entry for entry in added if entry not in removed]
    write_json(path, tokenizer)
    return removed


def clean_tokenizer_config(path: Path, vocab_size: int) -> None:
    config = read_json(path)
    decoder = config.get("added_tokens_decoder")
    if isinstance(decoder, dict):
        config["added_tokens_decoder"] = {
            key: value for key, value in decoder.items()
            if int(key) < vocab_size
        }

    extras = config.get("extra_special_tokens")
    if isinstance(extras, dict):
        config["extra_special_tokens"] = {
            key: value for key, value in extras.items()
            if value not in VISUAL_ONLY_TOKENS
        }
    elif isinstance(extras, list):
        config["extra_special_tokens"] = [
            value for value in extras if value not in VISUAL_ONLY_TOKENS
        ]

    # Recent Transformers versions also serialise named convenience fields.
    for key, value in list(config.items()):
        if isinstance(value, str) and value in VISUAL_ONLY_TOKENS:
            del config[key]
    write_json(path, config)


def clean_special_tokens_map(path: Path) -> None:
    if not path.exists():
        return
    mapping = read_json(path)
    for key, value in list(mapping.items()):
        token = value.get("content") if isinstance(value, dict) else value
        if isinstance(token, str) and token in VISUAL_ONLY_TOKENS:
            del mapping[key]
    write_json(path, mapping)


def main() -> int:
    args = parse_args()
    if not args.source.is_dir():
        raise ValueError(f"source checkpoint not found: {args.source}")
    if args.output.exists():
        raise ValueError(f"output already exists: {args.output}")

    model_config = read_json(args.source / "config.json")
    vocab_size = int(model_config["vocab_size"])
    shutil.copytree(args.source, args.output)
    removed = remove_visual_tokens(args.output / "tokenizer.json", vocab_size)
    clean_tokenizer_config(args.output / "tokenizer_config.json", vocab_size)
    clean_special_tokens_map(args.output / "special_tokens_map.json")

    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(args.output)
    highest_id = max(tokenizer.get_vocab().values())
    if len(tokenizer) != vocab_size or highest_id >= vocab_size:
        remaining = sorted(
            (token_id, token)
            for token, token_id in tokenizer.get_vocab().items()
            if token_id >= vocab_size
        )
        raise ValueError(f"staged tokenizer remains inconsistent: {remaining}")
    for token, expected_id in FUNCTION_TOKENS.items():
        actual_id = tokenizer.convert_tokens_to_ids(token)
        if actual_id != expected_id:
            raise ValueError(
                f"function token {token} moved: expected {expected_id}, got {actual_id}"
            )

    manifest = {
        "format": "subwave.functiongemma-gguf-source.v1",
        "source": str(args.source.resolve()),
        "vocab_size": vocab_size,
        "highest_token_id": highest_id,
        "removed_visual_tokens": removed,
        "function_tokens": FUNCTION_TOKENS,
    }
    with (args.output / "subwave-gguf-source.json").open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    print(f"GGUF source prepared at {args.output}")
    print(f"vocab={len(tokenizer)} highest_id={highest_id}")
    print("removed: " + ", ".join(sorted(VISUAL_ONLY_TOKENS)))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"GGUF preparation failed: {error}")
        raise
