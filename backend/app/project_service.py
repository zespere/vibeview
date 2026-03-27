from __future__ import annotations

import json
import subprocess
from datetime import datetime, UTC
from pathlib import Path
from uuid import uuid4

from .models import (
    CommitCreateResponse,
    CommitStatusResponse,
    ConversationCreateRequest,
    ConversationDocument,
    ConversationMessage,
    ConversationRecord,
    ConversationSummary,
    ConversationUpdateRequest,
    ProjectProfile,
    ProjectProfileUpdateRequest,
    ProjectTreeItem,
    ProjectWorkspaceStatusResponse,
)


class ProjectStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> ProjectProfile:
        if not self.path.exists():
            return ProjectProfile()
        return ProjectProfile.model_validate(json.loads(self.path.read_text()))

    def save(self, project: ProjectProfile) -> ProjectProfile:
        self.path.write_text(json.dumps(project.model_dump(mode="json"), indent=2, sort_keys=True))
        return project


class ProjectService:
    def __init__(self, store: ProjectStore) -> None:
        self.store = store

    def get_project(self) -> ProjectProfile:
        return self.store.load()

    def update_project(self, request: ProjectProfileUpdateRequest) -> ProjectProfile:
        repo_path = request.repo_path.strip()
        derived_name = Path(repo_path).name if repo_path else ""
        current = self.store.load()
        recent_candidates = [*current.recent_projects, repo_path]
        recent_projects: list[str] = []
        seen: set[str] = set()
        for path in recent_candidates:
            if not path or path in seen:
                continue
            seen.add(path)
            recent_projects.append(path)
        project = ProjectProfile(
            name=request.name.strip() or derived_name,
            repo_path=repo_path,
            recent_projects=recent_projects[:8],
        )
        return self.store.save(project)

    def list_project_items(self) -> tuple[str | None, list[ProjectTreeItem]]:
        project = self.store.load()
        candidates = [*project.recent_projects]
        if project.repo_path and project.repo_path not in candidates:
            candidates.append(project.repo_path)
        projects: list[ProjectTreeItem] = []
        seen: set[str] = set()
        for repo_path in candidates:
            normalized = repo_path.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            conversations = self._list_conversation_summaries(normalized)
            projects.append(
                ProjectTreeItem(
                    name=Path(normalized).name or normalized,
                    repo_path=normalized,
                    conversations=conversations,
                )
            )
        return project.repo_path or None, projects

    def list_conversations(self, repo_path: str) -> list[ConversationSummary]:
        return self._list_conversation_summaries(repo_path)

    def get_conversation(self, repo_path: str, conversation_id: str) -> ConversationRecord:
        normalized_repo_path = self._normalize_repo_path(repo_path)
        document = self._load_conversation_document(normalized_repo_path)
        conversation = next((item for item in document.conversations if item.id == conversation_id), None)
        if conversation is None:
            raise ValueError(f"Conversation not found: {conversation_id}")
        return conversation

    def create_conversation(self, request: ConversationCreateRequest) -> ConversationRecord:
        normalized_repo_path = self._normalize_repo_path(request.repo_path)
        document = self._load_conversation_document(normalized_repo_path)
        now = datetime.now(UTC)
        conversation = ConversationRecord(
            id=f"conv_{uuid4().hex[:10]}",
            title=request.title.strip() or "New conversation",
            created_at=now,
            updated_at=now,
            messages=[],
        )
        document.conversations.insert(0, conversation)
        self._save_conversation_document(normalized_repo_path, document)
        return conversation

    def update_conversation(self, conversation_id: str, request: ConversationUpdateRequest) -> ConversationRecord:
        normalized_repo_path = self._normalize_repo_path(request.repo_path)
        document = self._load_conversation_document(normalized_repo_path)
        for index, conversation in enumerate(document.conversations):
            if conversation.id != conversation_id:
                continue
            updated = conversation.model_copy(
                update={
                    "title": request.title.strip() if request.title is not None and request.title.strip() else conversation.title,
                    "messages": request.messages if request.messages is not None else conversation.messages,
                    "updated_at": self._derive_updated_at(request.messages) if request.messages is not None else datetime.now(UTC),
                }
            )
            document.conversations[index] = updated
            document.conversations.sort(key=lambda item: item.updated_at, reverse=True)
            self._save_conversation_document(normalized_repo_path, document)
            return updated
        raise ValueError(f"Conversation not found: {conversation_id}")

    def read_agents_document(self, repo_path: str | None = None) -> tuple[str, Path, str]:
        project = self.store.load()
        resolved_repo_path = (repo_path or project.repo_path).strip()
        if not resolved_repo_path:
            raise ValueError("No project repository is configured.")

        repo_root = Path(resolved_repo_path)
        agents_path = repo_root / "AGENTS.md"
        if not agents_path.exists():
            return str(repo_root), agents_path, ""
        return str(repo_root), agents_path, agents_path.read_text()

    def write_agents_document(self, content: str, repo_path: str | None = None) -> tuple[str, Path, str]:
        project = self.store.load()
        resolved_repo_path = (repo_path or project.repo_path).strip()
        if not resolved_repo_path:
            raise ValueError("No project repository is configured.")

        repo_root = Path(resolved_repo_path)
        repo_root.mkdir(parents=True, exist_ok=True)
        agents_path = repo_root / "AGENTS.md"
        normalized = content.rstrip() + ("\n" if content.strip() else "")
        agents_path.write_text(normalized)
        return str(repo_root), agents_path, normalized

    def get_commit_status(self, repo_path: str) -> CommitStatusResponse:
        normalized_repo_path = self._normalize_repo_path(repo_path)
        repo_root = self._resolve_git_root(normalized_repo_path)
        if repo_root is None:
            return CommitStatusResponse(
                repo_path=normalized_repo_path,
                is_git_repo=False,
                has_changes=False,
                suggested_message=None,
                changed_files=[],
            )

        status_result = self._run_git(repo_root, ["status", "--porcelain"])
        changed_lines = [line for line in status_result.stdout.splitlines() if line.strip()]
        changed_files = [line[3:].strip() for line in changed_lines if len(line) >= 4]
        return CommitStatusResponse(
            repo_path=normalized_repo_path,
            is_git_repo=True,
            has_changes=bool(changed_files),
            changed_files=changed_files,
        )

    def create_commit(self, repo_path: str, message: str) -> CommitCreateResponse:
        normalized_repo_path = self._normalize_repo_path(repo_path)
        repo_root = self._resolve_git_root(normalized_repo_path)
        if repo_root is None:
            raise ValueError("Repository is not a git repository.")

        status = self.get_commit_status(normalized_repo_path)
        if not status.has_changes:
            raise ValueError("There is nothing to commit.")

        self._run_git(repo_root, ["add", "-A"])
        commit_result = self._run_git(repo_root, ["commit", "-m", message])
        sha_result = self._run_git(repo_root, ["rev-parse", "HEAD"])
        commit_sha = sha_result.stdout.strip()
        summary = commit_result.stdout.strip() or commit_result.stderr.strip() or f"Created commit {commit_sha[:7]}."
        return CommitCreateResponse(
            repo_path=normalized_repo_path,
            commit_sha=commit_sha,
            message=message,
            summary=summary,
        )

    def get_workspace_status(self, repo_path: str, has_canvas_nodes: bool) -> ProjectWorkspaceStatusResponse:
        normalized_repo_path = self._normalize_repo_path(repo_path)
        repo_root = Path(normalized_repo_path)
        visible_file_count = self._count_visible_project_files(repo_root)
        return ProjectWorkspaceStatusResponse(
            repo_path=normalized_repo_path,
            has_project_files=visible_file_count > 0,
            visible_file_count=visible_file_count,
            has_canvas_nodes=has_canvas_nodes,
        )

    def _normalize_repo_path(self, repo_path: str) -> str:
        normalized = repo_path.strip()
        if not normalized:
            raise ValueError("No project repository is configured.")
        return str(Path(normalized).resolve())

    def _konceptura_dir(self, repo_path: str) -> Path:
        return Path(repo_path) / ".konceptura"

    def _conversation_path(self, repo_path: str) -> Path:
        return self._konceptura_dir(repo_path) / "conversations.json"

    def _load_conversation_document(self, repo_path: str) -> ConversationDocument:
        path = self._conversation_path(repo_path)
        if not path.exists():
            return ConversationDocument(repo_path=repo_path)
        payload = json.loads(path.read_text())
        payload["repo_path"] = repo_path
        return ConversationDocument.model_validate(payload)

    def _save_conversation_document(self, repo_path: str, document: ConversationDocument) -> ConversationDocument:
        path = self._conversation_path(repo_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document.model_dump(mode="json"), indent=2, sort_keys=True))
        return document

    def _list_conversation_summaries(self, repo_path: str) -> list[ConversationSummary]:
        normalized_repo_path = self._normalize_repo_path(repo_path)
        document = self._load_conversation_document(normalized_repo_path)
        if not document.conversations:
            return [
                ConversationSummary(
                    id="default",
                    title="Main",
                    placeholder=True,
                    message_count=0,
                )
            ]
        return [
            ConversationSummary(
                id=item.id,
                title=item.title,
                updated_at=item.updated_at,
                message_count=len(item.messages),
            )
            for item in sorted(document.conversations, key=lambda current: current.updated_at, reverse=True)
        ]

    def _derive_updated_at(self, messages: list[ConversationMessage] | None) -> datetime:
        if not messages:
            return datetime.now(UTC)
        latest = next(
            (
                message.created_at
                for message in reversed(messages)
                if message.created_at is not None
            ),
            None,
        )
        return latest or datetime.now(UTC)

    def _run_git(self, repo_root: Path, args: list[str]) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["git", *args],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            message = result.stderr.strip() or result.stdout.strip() or f"git {' '.join(args)} failed."
            raise ValueError(message)
        return result

    def _resolve_git_root(self, repo_path: str) -> Path | None:
        repo_root = Path(repo_path)
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            return None
        resolved = result.stdout.strip()
        return Path(resolved) if resolved else None

    def _count_visible_project_files(self, repo_root: Path) -> int:
        ignored_dir_names = {".git", ".konceptura", "node_modules", ".next", "dist", "build", ".venv", "__pycache__"}
        count = 0
        for path in repo_root.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(repo_root)
            parts = relative.parts
            if any(part in ignored_dir_names for part in parts[:-1]):
                continue
            if parts and parts[0].startswith("."):
                continue
            count += 1
        return count
