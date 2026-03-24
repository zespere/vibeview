export interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  role: "admin" | "editor" | "viewer";
}

export interface UserDraft {
  fullName: string;
  email: string;
  role: UserRecord["role"];
}
