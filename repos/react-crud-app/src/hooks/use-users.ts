import { useEffect, useState } from "react";

import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from "../api/users-api";
import type { UserDraft, UserRecord } from "../types";

export function useUsers() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void refreshUsers();
  }, []);

  async function refreshUsers() {
    setIsLoading(true);
    const nextUsers = await listUsers();
    setUsers(nextUsers);
    setIsLoading(false);
  }

  async function saveUser(draft: UserDraft, userId?: string) {
    if (userId) {
      await updateUser(userId, draft);
    } else {
      await createUser(draft);
    }
    await refreshUsers();
  }

  async function removeUser(userId: string) {
    await deleteUser(userId);
    await refreshUsers();
  }

  return {
    users,
    isLoading,
    refreshUsers,
    saveUser,
    removeUser,
  };
}
