import { requireUser } from "@/lib/auth/server";
import { listDevices } from "@/lib/devices/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DevicesPanel } from "./devices-panel";

export const metadata = { title: "Devices · Settings · PSP" };

export default async function DevicesPage() {
  await requireUser();
  const devices = await listDevices();

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>Linked devices</CardTitle>
        <CardDescription>
          Pair your phone or tablet to use the warehouse scanner module
          and receive actions sent from this laptop. Each device gets
          its own bearer token — revoke any time to instantly sign that
          device out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DevicesPanel initial={devices} />
      </CardContent>
    </Card>
  );
}
