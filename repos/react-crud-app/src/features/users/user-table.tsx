import type { UserRecord } from "../../types";

interface UserTableProps {
  isLoading: boolean;
  users: UserRecord[];
  onEdit(user: UserRecord): void;
  onDelete(userId: string): Promise<void>;
}

export function UserTable({ isLoading, users, onEdit, onDelete }: UserTableProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Users</h2>
        <span>{users.length} records</span>
      </div>

      {isLoading ? <p>Loading users...</p> : null}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.fullName}</td>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td className="actions-cell">
                <button className="ghost-button" onClick={() => onEdit(user)} type="button">
                  Edit
                </button>
                <button className="danger-button" onClick={() => void onDelete(user.id)} type="button">
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
