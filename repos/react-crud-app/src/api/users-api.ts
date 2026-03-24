import type { UserDraft, UserRecord } from "../types";

const seedUsers: UserRecord[] = [
  {
    id: "usr_1",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    role: "admin",
  },
  {
    id: "usr_2",
    fullName: "Grace Hopper",
    email: "grace@example.com",
    role: "editor",
  },
];

let users = [...seedUsers];

function pause() {
  return new Promise((resolve) => setTimeout(resolve, 120));
}

export async function listUsers() {
  await pause();
  return [...users];
}

export async function createUser(draft: UserDraft) {
  await pause();
  const user: UserRecord = {
    id: `usr_${crypto.randomUUID().slice(0, 8)}`,
    ...draft,
  };
  users = [user, ...users];
  return user;
}

export async function updateUser(userId: string, draft: UserDraft) {
  await pause();
  users = users.map((user) => (user.id === userId ? { ...user, ...draft } : user));
  return users.find((user) => user.id === userId) ?? null;
}

export async function deleteUser(userId: string) {
  await pause();
  users = users.filter((user) => user.id !== userId);
}
