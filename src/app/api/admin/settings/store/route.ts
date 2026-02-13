import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type Body = {
  storeId?: string;
  expectedDrawerCents?: number;
  payrollVarianceWarnHours?: number;
  payrollShiftDriftWarnHours?: number;
  salesRolloverEnabled?: boolean;
};

export async function PATCH(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = (await req.json()) as Body;
    const storeId = body.storeId || "";
    if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });

    const expected = body.expectedDrawerCents;
    if (!Number.isFinite(expected)) {
      return NextResponse.json({ error: "Invalid expected drawer amount." }, { status: 400 });
    }
    const payrollVarianceWarnHours = Number(body.payrollVarianceWarnHours ?? 2);
    const payrollShiftDriftWarnHours = Number(body.payrollShiftDriftWarnHours ?? 2);
    const salesRolloverEnabled = body.salesRolloverEnabled ?? true;
    if (!Number.isFinite(payrollVarianceWarnHours) || payrollVarianceWarnHours < 0) {
      return NextResponse.json({ error: "Invalid payroll variance threshold." }, { status: 400 });
    }
    if (!Number.isFinite(payrollShiftDriftWarnHours) || payrollShiftDriftWarnHours < 0) {
      return NextResponse.json({ error: "Invalid shift drift threshold." }, { status: 400 });
    }
    if (typeof salesRolloverEnabled !== "boolean") {
      return NextResponse.json({ error: "Invalid rollover setting." }, { status: 400 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (!managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { error: updateErr } = await supabaseServer
      .from("stores")
      .update({ expected_drawer_cents: Math.max(0, Math.round(expected ?? 0)) })
      .eq("id", storeId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    const { error: settingsErr } = await supabaseServer
      .from("store_settings")
      .upsert({
        store_id: storeId,
        payroll_variance_warn_hours: payrollVarianceWarnHours,
        payroll_shift_drift_warn_hours: payrollShiftDriftWarnHours,
        sales_rollover_enabled: salesRolloverEnabled,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      });
    if (settingsErr) return NextResponse.json({ error: settingsErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update store." }, { status: 500 });
  }
}
