import { requireUser } from "@/lib/server/requireUser";
import AdminClient from "./AdminClient";

export default async function AdminPage() {
  const user = await requireUser("ADMIN");
  return <AdminClient user={user} />;
}
