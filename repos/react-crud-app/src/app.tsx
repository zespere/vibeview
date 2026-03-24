import { useMemo, useState } from "react";

import { UserForm } from "./features/users/user-form";
import { UserTable } from "./features/users/user-table";
import { useUsers } from "./hooks/use-users";
import type { UserRecord } from "./types";

export function App() {
  const { users, isLoading, saveUser, removeUser } = useUsers();
  const [activeUser, setActiveUser] = useState<UserRecord | null>(null);

  const summary = useMemo(() => {
    return users.reduce<Record<string, number>>((counts, user) => {
      counts[user.role] = (counts[user.role] ?? 0) + 1;
      return counts;
    }, {});
  }, [users]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>User administration</h1>
          <p>React CRUD example with a local fake API and a typed form flow.</p>
        </div>
        <div className="summary-list">
          <span>Admins: {summary.admin ?? 0}</span>
          <span>Editors: {summary.editor ?? 0}</span>
          <span>Viewers: {summary.viewer ?? 0}</span>
        </div>
      </header>

      <main className="content-grid">
        <UserForm
          activeUser={activeUser}
          onCancel={() => setActiveUser(null)}
          onSave={async (draft, userId) => {
            await saveUser(draft, userId);
            setActiveUser(null);
          }}
        />
        <UserTable
          isLoading={isLoading}
          onDelete={removeUser}
          onEdit={setActiveUser}
          users={users}
        />
      </main>
    </div>
  );
}
