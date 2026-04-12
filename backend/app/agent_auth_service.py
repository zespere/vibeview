from __future__ import annotations

import json
import os
from pathlib import Path

from .models import AgentAuthStatusResponse, AgentProviderOption

PROVIDER_OPTIONS: tuple[AgentProviderOption, ...] = (
    AgentProviderOption(id="openrouter", label="OpenRouter", env_var="OPENROUTER_API_KEY"),
    AgentProviderOption(id="openai", label="OpenAI", env_var="OPENAI_API_KEY"),
    AgentProviderOption(id="anthropic", label="Anthropic", env_var="ANTHROPIC_API_KEY"),
    AgentProviderOption(id="google", label="Google Gemini", env_var="GEMINI_API_KEY"),
    AgentProviderOption(id="groq", label="Groq", env_var="GROQ_API_KEY"),
    AgentProviderOption(id="mistral", label="Mistral", env_var="MISTRAL_API_KEY"),
    AgentProviderOption(id="xai", label="xAI", env_var="XAI_API_KEY"),
    AgentProviderOption(id="cerebras", label="Cerebras", env_var="CEREBRAS_API_KEY"),
    AgentProviderOption(id="vercel-ai-gateway", label="Vercel AI Gateway", env_var="AI_GATEWAY_API_KEY"),
    AgentProviderOption(id="zai", label="ZAI", env_var="ZAI_API_KEY"),
    AgentProviderOption(id="opencode", label="OpenCode Zen", env_var="OPENCODE_API_KEY"),
    AgentProviderOption(id="opencode-go", label="OpenCode Go", env_var="OPENCODE_API_KEY"),
    AgentProviderOption(id="huggingface", label="Hugging Face", env_var="HF_TOKEN"),
    AgentProviderOption(id="kimi-coding", label="Kimi For Coding", env_var="KIMI_API_KEY"),
    AgentProviderOption(id="minimax", label="MiniMax", env_var="MINIMAX_API_KEY"),
    AgentProviderOption(id="minimax-cn", label="MiniMax China", env_var="MINIMAX_CN_API_KEY"),
)


class AgentAuthService:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or (Path.home() / ".pi" / "agent" / "auth.json")

    def get_status(self, active_provider: str | None) -> AgentAuthStatusResponse:
        configured = self.configured_providers()
        auth_required = not active_provider or active_provider not in configured
        return AgentAuthStatusResponse(
            active_provider=active_provider,
            auth_required=auth_required,
            configured_providers=configured,
            providers=list(PROVIDER_OPTIONS),
        )

    def configured_providers(self) -> list[str]:
        auth_entries = self._load_auth_entries()
        configured: list[str] = []
        for option in PROVIDER_OPTIONS:
            if option.id in auth_entries or os.getenv(option.env_var):
                configured.append(option.id)
        return configured

    def save_api_key(self, provider: str, api_key: str) -> None:
        normalized_provider = provider.strip()
        if not normalized_provider:
            raise ValueError("Provider is required.")
        if not any(option.id == normalized_provider for option in PROVIDER_OPTIONS):
            raise ValueError(f"Unsupported provider: {normalized_provider}")
        normalized_key = api_key.strip()
        if not normalized_key:
            raise ValueError("API key is required.")

        entries = self._load_auth_entries()
        entries[normalized_provider] = {"type": "api_key", "key": normalized_key}

        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(entries, indent=2, sort_keys=True))
        self.path.chmod(0o600)

    def _load_auth_entries(self) -> dict[str, dict[str, str]]:
        if not self.path.exists():
            return {}
        try:
            payload = json.loads(self.path.read_text())
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}
