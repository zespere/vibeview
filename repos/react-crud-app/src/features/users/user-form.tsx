import { FormEvent, useEffect, useState } from "react";

import type { UserDraft, UserRecord } from "../../types";

const emptyDraft: UserDraft = {
  fullName: "",
  email: "",
  role: "viewer",
};

interface UserFormProps {
  activeUser: UserRecord | null;
  onCancel(): void;
  onSave(draft: UserDraft, userId?: string): Promise<void>;
}

export function UserForm({ activeUser, onCancel, onSave }: UserFormProps) {
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);

  useEffect(() => {
    if (!activeUser) {
      setDraft(emptyDraft);
      return;
    }
    setDraft({
      fullName: activeUser.fullName,
      email: activeUser.email,
      role: activeUser.role,
    });
  }, [activeUser]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave(draft, activeUser?.id);
    setDraft(emptyDraft);
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <div className="panel-header">
        <h2>{activeUser ? "Edit user" : "Create user"}</h2>
        {activeUser ? (
          <button className="ghost-button" onClick={onCancel} type="button">
            Clear
          </button>
        ) : null}
      </div>

      <label>
        <span>Full name</span>
        <input
          onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))}
          value={draft.fullName}
        />
      </label>

      <label>
        <span>Email</span>
        <input
          onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
          value={draft.email}
        />
      </label>

      <label>
        <span>Role</span>
        <select
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              role: event.target.value as UserDraft["role"],
            }))
          }
          value={draft.role}
        >
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>

      <button className="primary-button" type="submit">
        {activeUser ? "Save changes" : "Create user"}
      </button>
    </form>
  );
}
