from __future__ import annotations

import json
from pathlib import Path

from .models import ProjectProfile, ProjectProfileUpdateRequest


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
        recent_candidates = [repo_path, *current.recent_projects]
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
