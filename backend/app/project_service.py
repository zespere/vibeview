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
        project = ProjectProfile(
            name=request.name.strip() or derived_name,
            description=request.description.strip(),
            repo_path=repo_path,
            stack=request.stack.strip(),
            goals=request.goals.strip(),
            constraints=request.constraints.strip(),
            design_direction=request.design_direction.strip(),
        )
        return self.store.save(project)
