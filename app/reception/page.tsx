import { requireUser } from "@/lib/server/requireUser";
import ReceptionClient from "./ReceptionClient";

export default async function ReceptionPage() {
  const user = await requireUser("RECEPTION");
  return <ReceptionClient user={user} />;
}
