import { redirect } from "next/navigation";

/**
 * /sales has no overview page yet — Customers is the first/only
 * surface, so the root just routes there. Once we ship a real Sales
 * dashboard (KPIs, pipeline funnel, etc.) this becomes the dashboard
 * and the redirect goes away.
 */
export default function SalesIndex() {
  redirect("/sales/customers");
}
