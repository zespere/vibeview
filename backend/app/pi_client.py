from __future__ import annotations

import base64
import json
import logging
import os
import queue
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
    def is_available(self) -> bool:
        return bool(settings.agent_binary and settings.agent_binary.exists())

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
        env = dict(os.environ)
        if settings.agent_binary is not None:
            agent_bin_dir = str(settings.agent_binary.parent)
            env["PATH"] = (
                f"{agent_bin_dir}:{env['PATH']}"
                if env.get("PATH")
                else agent_bin_dir
            )
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
