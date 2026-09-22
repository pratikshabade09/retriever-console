import { requireUser } from "@/lib/server/requireUser";
import DoctorClient from "./DoctorClient";

export default async function DoctorPage() {
  const user = await requireUser("DOCTOR");
  return <DoctorClient user={user} />;
}
