from __future__ import annotations

import base64
import json
import logging
import os
import queue
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Literal

from .config import settings

logger = logging.getLogger(__name__)


@dataclass
class PiRunResult:
    events: list[dict[str, Any]]
    stderr: str


class PiClient:
    def __init__(self, models_path: Path | None = None) -> None:
        self.models_path = models_path or (Path.home() / ".pi" / "agent" / "models.json")

    def is_available(self) -> bool:
        return bool(settings.agent_binary and settings.agent_binary.exists())

    def custom_provider_ids(self) -> list[str]:
        providers = self._load_custom_providers()
        return sorted(provider_id for provider_id in providers.keys() if provider_id.strip())

    def get_available_models_by_provider(self, provider_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        if not self.is_available():
            return {}

        unique_provider_ids = [provider_id.strip() for provider_id in provider_ids if provider_id.strip()]
        if not unique_provider_ids:
            return {}

        node_binary = self._resolve_node_binary()
        registry_entry = self._resolve_model_registry_entry()
        if node_binary is None or registry_entry is None:
            raise RuntimeError("Pi model registry is not available.")

        script = """
import { getModels } from __REGISTRY_ENTRY__;

const requested = __PROVIDER_IDS__;
const result = Object.fromEntries(
  requested.map((provider) => {
    try {
      const models = getModels(provider).map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        reasoning: Boolean(model.reasoning),
        supports_images: Array.isArray(model.input) && model.input.includes("image"),
        context_window: typeof model.contextWindow === "number" ? model.contextWindow : null,
        max_tokens: typeof model.maxTokens === "number" ? model.maxTokens : null,
      }));
      return [provider, models];
    } catch {
      return [provider, []];
    }
  })
);

console.log(JSON.stringify(result));
"""
        script = script.replace("__REGISTRY_ENTRY__", json.dumps(registry_entry.as_uri()))
        script = script.replace("__PROVIDER_IDS__", json.dumps(unique_provider_ids))
        result = subprocess.run(
            [str(node_binary), "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
            env=self._build_env(),
            check=False,
        )
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip() or "Unknown Pi model registry failure."
            raise RuntimeError(detail)
        try:
            payload = json.loads(result.stdout.strip() or "{}")
        except json.JSONDecodeError as error:
            raise RuntimeError("Pi model registry returned invalid JSON.") from error
        built_in = payload if isinstance(payload, dict) else {}
        return self._merge_custom_models(unique_provider_ids, built_in)

    def run_prompt(
        self,
        repo_dir: Path,
        prompt: str,
        *,
        image_paths: list[str] | None = None,
        provider: str | None = None,
        model: str | None = None,
        reasoning_effort: Literal["low", "medium", "high", "xhigh"] | None = None,
        timeout_seconds: float | None = None,
        event_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> PiRunResult:
        if not self.is_available():
            raise RuntimeError("Pi CLI is not available. Check agent.binary in vibeview.toml.")

        command = self._build_command(provider=provider, model=model, reasoning_effort=reasoning_effort)
        env = self._build_env()
        logger.info("Starting Pi RPC run in %s", repo_dir)
        process = subprocess.Popen(
            command,
            cwd=repo_dir,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        stdout_queue: queue.Queue[str | None] = queue.Queue()
        stderr_chunks: list[str] = []
        stdout_thread = threading.Thread(
            target=self._read_stream_lines,
            args=(process.stdout, stdout_queue),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=self._read_stream_chunks,
            args=(process.stderr, stderr_chunks),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()

        payload: dict[str, Any] = {
            "id": "prompt-1",
            "type": "prompt",
            "message": prompt,
        }
        images = self._encode_images(image_paths)
        if images:
            payload["images"] = images

        try:
            if not process.stdin:
                raise RuntimeError("Pi RPC process did not provide stdin.")
            process.stdin.write(json.dumps(payload) + "\n")
            process.stdin.flush()
        except OSError as error:
            process.kill()
            raise RuntimeError(f"Could not send prompt to Pi: {error}") from error

        deadline = time.monotonic() + timeout_seconds if timeout_seconds is not None else None
        events: list[dict[str, Any]] = []
        prompt_accepted = False
        prompt_error: str | None = None

        try:
            while True:
                timeout = None if deadline is None else max(0, deadline - time.monotonic())
                if deadline is not None and timeout == 0:
                    raise TimeoutError("Pi run timed out.")
                try:
                    line = stdout_queue.get(timeout=timeout)
                except queue.Empty as error:
                    raise TimeoutError("Pi run timed out.") from error

                if line is None:
                    break
                parsed = self._parse_line(line)
                if parsed is None:
                    continue

                if parsed.get("type") == "response" and parsed.get("id") == "prompt-1":
                    if parsed.get("success") is True:
                        prompt_accepted = True
                    else:
                        prompt_error = str(parsed.get("error") or "Pi rejected the prompt.")
                        break
                    continue

                events.append(parsed)
                if event_callback is not None:
                    event_callback(parsed)
                if parsed.get("type") == "agent_end":
                    break
        finally:
            stderr = "".join(stderr_chunks).strip()
            self._shutdown_process(process, stdout_thread, stderr_thread)

        if prompt_error:
            raise RuntimeError(prompt_error)
        if not prompt_accepted:
            detail = stderr or "Pi did not acknowledge the prompt."
            raise RuntimeError(detail)

        return PiRunResult(events=events, stderr=stderr)

    def _build_command(
        self,
        *,
        provider: str | None = None,
        model: str | None = None,
        reasoning_effort: Literal["low", "medium", "high", "xhigh"] | None = None,
    ) -> list[str]:
        assert settings.agent_binary is not None
        command = [
            str(settings.agent_binary),
            "--mode",
            "rpc",
            "--no-session",
            "--tools",
            "read,bash,edit,write,grep,find,ls",
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-themes",
        ]
        effective_provider = provider or settings.agent_provider
        effective_model = model or settings.agent_model
        effective_reasoning = reasoning_effort or settings.agent_reasoning_default

        if effective_provider:
            command.extend(["--provider", effective_provider])
        if effective_model:
            command.extend(["--model", effective_model])
        if effective_reasoning:
            command.extend(["--thinking", effective_reasoning])
        return command

    def _build_env(self) -> dict[str, str]:
        env = dict(os.environ)
        if settings.agent_binary is not None:
            agent_bin_dir = str(settings.agent_binary.parent)
            env["PATH"] = f"{agent_bin_dir}:{env['PATH']}" if env.get("PATH") else agent_bin_dir
        return env

    def _resolve_node_binary(self) -> Path | None:
        if settings.agent_binary is not None:
            candidate = settings.agent_binary.parent / "node"
            if candidate.exists():
                return candidate
        direct = shutil.which("node")
        return Path(direct) if direct else None

    def _resolve_model_registry_entry(self) -> Path | None:
        if settings.agent_binary is None:
            return None
        package_root = settings.agent_binary.resolve().parents[1]
        candidate = package_root / "node_modules" / "@mariozechner" / "pi-ai" / "dist" / "index.js"
        return candidate if candidate.exists() else None

    def _load_custom_providers(self) -> dict[str, dict[str, Any]]:
        if not self.models_path.exists():
            return {}
        try:
            payload = json.loads(self.models_path.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
        providers = payload.get("providers") if isinstance(payload, dict) else None
        if not isinstance(providers, dict):
            return {}
        return {str(provider_id): provider for provider_id, provider in providers.items() if isinstance(provider, dict)}

    def _merge_custom_models(
        self,
        provider_ids: list[str],
        built_in: dict[str, Any],
    ) -> dict[str, list[dict[str, Any]]]:
        custom_providers = self._load_custom_providers()
        merged: dict[str, list[dict[str, Any]]] = {}
        for provider_id in provider_ids:
            base_models = built_in.get(provider_id, [])
            ordered_ids: list[str] = []
            by_id: dict[str, dict[str, Any]] = {}
            for model in base_models if isinstance(base_models, list) else []:
                if isinstance(model, dict) and isinstance(model.get("id"), str):
                    model_id = model["id"]
                    ordered_ids.append(model_id)
                    by_id[model_id] = dict(model)

            provider_config = custom_providers.get(provider_id, {})
            model_overrides = provider_config.get("modelOverrides")
            if isinstance(model_overrides, dict):
                for model_id, override in model_overrides.items():
                    if model_id in by_id and isinstance(override, dict):
                        by_id[model_id] = self._normalize_model_record(provider_id, {**by_id[model_id], **override})

            custom_models = provider_config.get("models")
            if isinstance(custom_models, list):
                for raw_model in custom_models:
                    normalized = self._normalize_model_record(provider_id, raw_model)
                    model_id = normalized.get("id")
                    if not isinstance(model_id, str):
                        continue
                    if model_id not in by_id:
                        ordered_ids.append(model_id)
                    by_id[model_id] = normalized

            merged[provider_id] = [self._normalize_model_record(provider_id, by_id[model_id]) for model_id in ordered_ids]
        return merged

    def _normalize_model_record(self, provider_id: str, raw_model: Any) -> dict[str, Any]:
        model = raw_model if isinstance(raw_model, dict) else {}
        input_types = model.get("input") if isinstance(model.get("input"), list) else None
        supports_images = (
            model.get("supports_images")
            if isinstance(model.get("supports_images"), bool)
            else "image" in input_types
            if input_types is not None
            else False
        )
        context_window = (
            model.get("context_window")
            if isinstance(model.get("context_window"), int)
            else model.get("contextWindow")
            if isinstance(model.get("contextWindow"), int)
            else 128000
        )
        max_tokens = (
            model.get("max_tokens")
            if isinstance(model.get("max_tokens"), int)
            else model.get("maxTokens")
            if isinstance(model.get("maxTokens"), int)
            else 16384
        )
        return {
            "id": str(model.get("id", "")).strip(),
            "name": str(model.get("name") or model.get("id") or "").strip(),
            "provider": provider_id,
            "reasoning": bool(model.get("reasoning", False)),
            "supports_images": supports_images,
            "context_window": context_window,
            "max_tokens": max_tokens,
        }

    def _encode_images(self, image_paths: list[str] | None) -> list[dict[str, str]]:
        encoded: list[dict[str, str]] = []
        for image_path in image_paths or []:
            candidate = Path(image_path)
            if not candidate.exists() or not candidate.is_file():
                continue
            try:
                mime_type = self._guess_mime_type(candidate)
                encoded.append(
                    {
                        "type": "image",
                        "data": base64.b64encode(candidate.read_bytes()).decode("ascii"),
                        "mimeType": mime_type,
                    }
                )
            except OSError:
                logger.exception("Failed to read image attachment %s", candidate)
        return encoded

    def _guess_mime_type(self, path: Path) -> str:
        suffix = path.suffix.lower()
        return {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }.get(suffix, "application/octet-stream")

    def _read_stream_lines(self, stream: Any, output: queue.Queue[str | None]) -> None:
        try:
            if stream is None:
                output.put(None)
                return
            for line in stream:
                output.put(line)
        finally:
            output.put(None)

    def _read_stream_chunks(self, stream: Any, output: list[str]) -> None:
        if stream is None:
            return
        try:
            while True:
                chunk = stream.read()
                if not chunk:
                    return
                output.append(chunk)
        except OSError:
            return

    def _parse_line(self, line: str) -> dict[str, Any] | None:
        value = line.strip()
        if not value:
            return None
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            logger.debug("Ignoring non-JSON Pi output line: %s", value)
            return None
        return parsed if isinstance(parsed, dict) else None

    def _shutdown_process(
        self,
        process: subprocess.Popen[str],
        stdout_thread: threading.Thread,
        stderr_thread: threading.Thread,
    ) -> None:
        if process.stdin and not process.stdin.closed:
            try:
                process.stdin.close()
            except OSError:
                pass

        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=1)

        stdout_thread.join(timeout=0.5)
        stderr_thread.join(timeout=0.5)
