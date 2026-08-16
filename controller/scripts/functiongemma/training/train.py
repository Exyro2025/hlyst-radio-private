#!/usr/bin/env python3
"""Full supervised fine-tuning for SUB/WAVE's FunctionGemma router.

This follows Google's FunctionGemma SFT recipe while keeping every artifact
local. It deliberately trains routing and recovery, not final track choice.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--development", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default="google/functiongemma-270m-it")
    parser.add_argument("--epochs", type=float, default=8.0)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--gradient-accumulation", type=int, default=2)
    parser.add_argument("--max-length", type=int, default=1024)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--early-stopping-patience", type=int, default=2)
    parser.add_argument("--seed", type=int, default=20260816)
    parser.add_argument("--resume", default=None, help="Checkpoint path, or 'latest'")
    parser.add_argument("--no-early-stopping", action="store_true")
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for number, raw in enumerate(handle, 1):
            line = raw.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{number}: invalid JSON: {error}") from error
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{number}: expected a JSON object")
            rows.append(value)
    if not rows:
        raise ValueError(f"{path}: dataset is empty")
    return rows


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_rows(rows: list[dict[str, Any]], path: Path) -> set[str]:
    fingerprints: set[str] = set()
    for index, row in enumerate(rows, 1):
        messages = row.get("messages")
        tools = row.get("tools")
        if not isinstance(messages, list) or not isinstance(tools, list):
            raise ValueError(f"{path}:{index}: expected messages[] and tools[]")
        offered = {
            tool.get("function", {}).get("name")
            for tool in tools
            if isinstance(tool, dict)
        }
        assistant_calls = []
        for message in messages:
            if not isinstance(message, dict):
                raise ValueError(f"{path}:{index}: invalid message")
            if message.get("role") == "assistant":
                assistant_calls.extend(message.get("tool_calls") or [])
        if not assistant_calls:
            raise ValueError(f"{path}:{index}: no assistant tool-call target")
        for call in assistant_calls:
            name = call.get("function", {}).get("name") if isinstance(call, dict) else None
            if name not in offered:
                raise ValueError(f"{path}:{index}: target tool {name!r} was not offered")
        fingerprint = hashlib.sha256(
            json.dumps(messages, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        if fingerprint in fingerprints:
            raise ValueError(f"{path}:{index}: duplicate conversation")
        fingerprints.add(fingerprint)
    return fingerprints


def package_versions(names: list[str]) -> dict[str, str]:
    versions: dict[str, str] = {}
    for name in names:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "missing"
    return versions


def main() -> int:
    args = parse_args()
    if args.epochs <= 0 or args.batch_size < 1 or args.gradient_accumulation < 1:
        raise ValueError("epochs, batch size and gradient accumulation must be positive")
    if args.max_length < 256:
        raise ValueError("max length below 256 is unsafe for tool declarations")

    # Imports happen after argument validation so --help works before the
    # heavyweight training environment has been installed.
    import torch
    from datasets import Dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer, EarlyStoppingCallback, set_seed
    from trl import SFTConfig, SFTTrainer

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; this training recipe requires the NVIDIA GPU")

    train_rows = read_jsonl(args.train)
    development_rows = read_jsonl(args.development)
    train_fingerprints = validate_rows(train_rows, args.train)
    development_fingerprints = validate_rows(development_rows, args.development)
    overlap = train_fingerprints & development_fingerprints
    if overlap:
        raise ValueError(f"training/development leakage: {len(overlap)} duplicate conversations")

    args.output.mkdir(parents=True, exist_ok=True)
    set_seed(args.seed)
    use_bf16 = bool(torch.cuda.is_bf16_supported())
    dtype = torch.bfloat16 if use_bf16 else torch.float16

    print(f"Loading {args.model}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"dtype: {dtype}; train={len(train_rows)} development={len(development_rows)}")
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        dtype=dtype,
        attn_implementation="eager",
    )
    model.config.use_cache = False

    lengths: list[int] = []
    for row in train_rows + development_rows:
        tokenised = tokenizer.apply_chat_template(
            row["messages"],
            tools=row["tools"],
            add_generation_prompt=False,
            tokenize=True,
        )
        lengths.append(len(tokenised))
    longest = max(lengths)
    over_limit = sum(length > args.max_length for length in lengths)
    print(f"token lengths: max={longest}; over --max-length={over_limit}")
    if over_limit:
        raise ValueError(
            f"{over_limit} examples exceed max length {args.max_length}; "
            "increase --max-length rather than silently truncating tool calls"
        )

    batches_per_epoch = math.ceil(len(train_rows) / args.batch_size)
    update_steps_per_epoch = math.ceil(batches_per_epoch / args.gradient_accumulation)
    planned_update_steps = math.ceil(update_steps_per_epoch * args.epochs)
    warmup_steps = max(1, math.ceil(planned_update_steps * 0.05))
    print(
        f"planned optimiser steps: {planned_update_steps}; "
        f"warmup: {warmup_steps} steps (5%)"
    )

    training_args = SFTConfig(
        output_dir=str(args.output),
        max_length=args.max_length,
        packing=False,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation,
        gradient_checkpointing=False,
        optim="adamw_torch_fused",
        logging_steps=10,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=4,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        learning_rate=args.learning_rate,
        warmup_steps=warmup_steps,
        fp16=not use_bf16,
        bf16=use_bf16,
        lr_scheduler_type="constant",
        report_to="tensorboard",
        seed=args.seed,
        data_seed=args.seed,
        push_to_hub=False,
    )
    callbacks = [] if args.no_early_stopping else [
        EarlyStoppingCallback(early_stopping_patience=args.early_stopping_patience)
    ]
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=Dataset.from_list(train_rows),
        eval_dataset=Dataset.from_list(development_rows),
        processing_class=tokenizer,
        callbacks=callbacks,
    )

    resume: bool | str | None
    if args.resume == "latest":
        resume = True
    else:
        resume = args.resume
    result = trainer.train(resume_from_checkpoint=resume)
    final_dir = args.output / "best"
    trainer.save_model(str(final_dir))
    tokenizer.save_pretrained(final_dir)

    summary = {
        "format": "subwave.functiongemma-training-run.v1",
        "model": args.model,
        "arguments": vars(args) | {
            "train": str(args.train),
            "development": str(args.development),
            "output": str(args.output),
        },
        "dataset": {
            "train_rows": len(train_rows),
            "development_rows": len(development_rows),
            "train_sha256": file_sha256(args.train),
            "development_sha256": file_sha256(args.development),
            "max_tokens": longest,
        },
        "environment": {
            "python": sys.version,
            "platform": platform.platform(),
            "gpu": torch.cuda.get_device_name(0),
            "cuda": torch.version.cuda,
            "dtype": str(dtype),
            "packages": package_versions([
                "torch", "transformers", "datasets", "accelerate", "trl", "tensorboard"
            ]),
        },
        "best_checkpoint": trainer.state.best_model_checkpoint,
        "best_metric": trainer.state.best_metric,
        "training_metrics": result.metrics,
        "log_history": trainer.state.log_history,
    }
    with (args.output / "run-summary.json").open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, default=str)
        handle.write("\n")
    print(f"Best model saved to {final_dir}")
    print(f"Run summary saved to {args.output / 'run-summary.json'}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"training failed: {error}", file=sys.stderr)
        raise
