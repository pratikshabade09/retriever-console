import { requirePatient } from "@/lib/server/requirePatient";
import PatientClient from "./PatientClient";

export default async function PatientPage() {
  const patient = await requirePatient("/patient");
  return <PatientClient patient={patient} />;
}
