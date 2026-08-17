#!/usr/bin/env python3
"""Run the frozen SUB/WAVE FunctionGemma harness through Transformers.

This evaluates the unquantised checkpoint directly, separating fine-tuning
quality from GGUF conversion, quantisation and llama.cpp serving behaviour.
The JSONL output is consumed by the existing TypeScript scorer.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any


PRODUCER_SYSTEM = " ".join([
    "You are a model that can do function calling with the following functions.",
    "You are the backstage Producer for a live personal radio station.",
    "Use the offered functions to make operational music-selection decisions.",
    "Never invent a track id. The current track is a discovery seed, not a valid pick.",
    "When a done function is offered, use it only after discovery has surfaced a candidate.",
])

CALL_PATTERN = re.compile(r"<start_function_call>call:([^\s{]+)\{([^}]*)\}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--scenarios", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--max-new-tokens", type=int, default=256)
    return parser.parse_args()


def split_arguments(raw: str) -> list[str]:
    parts: list[str] = []
    start = 0
    escaped = False
    index = 0
    while index < len(raw):
        if raw.startswith("<escape>", index):
            escaped = not escaped
            index += len("<escape>")
            continue
        if raw[index] == "," and not escaped:
            parts.append(raw[start:index])
            start = index + 1
        index += 1
    if raw[start:].strip():
        parts.append(raw[start:])
    return parts


def scalar(raw: str) -> Any:
    value = raw.strip()
    if value.startswith("<escape>") and value.endswith("<escape>"):
        return value[len("<escape>"):-len("<escape>")]
    if value in {"null", "None"}:
        return None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        return float(value) if "." in value else int(value)
    return value


def parse_calls(text: str) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for match in CALL_PATTERN.finditer(text):
        arguments: dict[str, Any] = {}
        for part in split_arguments(match.group(2)):
            key, separator, value = part.partition(":")
            if separator and key.strip():
                arguments[key.strip()] = scalar(value)
        calls.append({"name": match.group(1), "arguments": arguments})
    return calls


def result_for(scenario: dict[str, Any], call: dict[str, Any]) -> Any:
    if call["name"] == "done":
        return {"accepted": True}
    return scenario.get("mockResults", {}).get(call["name"], {"tracks": []})


def run_scenario(
    scenario: dict[str, Any],
    tokenizer: Any,
    model: Any,
    torch: Any,
    max_new_tokens: int,
) -> dict[str, Any]:
    messages: list[dict[str, Any]] = [
        {"role": "developer", "content": PRODUCER_SYSTEM},
        {"role": "user", "content": scenario["prompt"]},
    ]
    calls: list[dict[str, Any]] = []
    responses: list[str] = []
    calls_per_round: list[int] = []
    max_rounds = 3 if scenario["stage"] == "recover" else 1
    started = time.perf_counter()

    for _round in range(max_rounds):
        encoded = tokenizer.apply_chat_template(
            messages,
            tools=scenario["openAiTools"],
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        )
        encoded = {key: value.to(model.device) for key, value in encoded.items()}
        prompt_tokens = encoded["input_ids"].shape[-1]
        with torch.inference_mode():
            generated = model.generate(
                **encoded,
                do_sample=False,
                max_new_tokens=max_new_tokens,
                pad_token_id=tokenizer.eos_token_id,
            )
        text = tokenizer.decode(
            generated[0, prompt_tokens:],
            skip_special_tokens=False,
        ).strip()
        if text:
            responses.append(text)
        parsed = parse_calls(text)
        calls_per_round.append(len(parsed))
        calls.extend(parsed)
        if len(parsed) != 1:
            break
        call = parsed[0]
        messages.append({
            "role": "assistant",
            "tool_calls": [{
                "type": "function",
                "function": {
                    "name": call["name"],
                    "arguments": call["arguments"],
                },
            }],
        })
        messages.append({
            "role": "tool",
            "content": {
                "name": call["name"],
                "response": result_for(scenario, call),
            },
        })
        if call["name"] == "done":
            break

    return {
        "scenario": scenario["id"],
        "calls": calls,
        "latencyMs": round((time.perf_counter() - started) * 1000),
        "callsPerRound": calls_per_round,
        **({"responseText": "\n\n".join(responses)} if responses else {}),
    }


def main() -> int:
    args = parse_args()
    if args.iterations < 1:
        raise ValueError("--iterations must be positive")
    if args.max_new_tokens < 16:
        raise ValueError("--max-new-tokens must be at least 16")

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; native evaluation expects the training GPU")
    with args.scenarios.open("r", encoding="utf-8") as handle:
        scenarios = json.load(handle)
    if not isinstance(scenarios, list) or not scenarios:
        raise ValueError(f"{args.scenarios}: expected a non-empty JSON array")

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    print(f"Loading {args.model}")
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        dtype=dtype,
        attn_implementation="eager",
    ).to("cuda")
    model.eval()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as output:
        for iteration in range(1, args.iterations + 1):
            for scenario in scenarios:
                prediction = run_scenario(
                    scenario, tokenizer, model, torch, args.max_new_tokens
                )
                prediction["iteration"] = iteration
                output.write(json.dumps(prediction, separators=(",", ":")) + "\n")
                output.flush()
                print(
                    f"{iteration}/{args.iterations} {scenario['id']} "
                    f"{prediction['latencyMs']}ms calls="
                    f"{','.join(call['name'] for call in prediction['calls']) or '<none>'}"
                )
    print(f"Predictions saved to {args.output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"evaluation failed: {error}")
        raise
