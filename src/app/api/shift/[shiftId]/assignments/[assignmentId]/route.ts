import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type AssignmentRow = {
  id: string;
  type: "task" | "message";
  delivered_shift_id: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  deleted_at: string | null;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ shiftId: string; assignmentId: string }> }
) {
  try {
    const { shiftId, assignmentId } = await params;
    if (!shiftId || !assignmentId) {
      return NextResponse.json({ error: "Missing ids." }, { status: 400 });
    }

    const body = (await req.json()) as { action?: "ack" | "complete" };
    if (body.action !== "ack" && body.action !== "complete") {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    const { data: assignment, error: assignErr } = await supabaseServer
      .from("shift_assignments")
      .select("id, type, delivered_shift_id, acknowledged_at, completed_at, deleted_at")
      .eq("id", assignmentId)
      .maybeSingle()
      .returns<AssignmentRow>();
    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });
    if (!assignment) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (assignment.deleted_at) return NextResponse.json({ error: "Assignment deleted." }, { status: 400 });

    if (assignment.delivered_shift_id !== shiftId) {
      return NextResponse.json({ error: "Not assigned to this shift." }, { status: 403 });
    }

    const nowIso = new Date().toISOString();
    const updateData: {
      acknowledged_at?: string;
      acknowledged_shift_id?: string;
      completed_at?: string;
      completed_shift_id?: string;
    } = {};

    if (body.action === "ack") {
      if (assignment.type !== "message") {
        return NextResponse.json({ error: "Not a message." }, { status: 400 });
      }
      if (!assignment.acknowledged_at) {
        updateData.acknowledged_at = nowIso;
        updateData.acknowledged_shift_id = shiftId;
      }
    }

    if (body.action === "complete") {
      if (assignment.type !== "task") {
        return NextResponse.json({ error: "Not a task." }, { status: 400 });
      }
      if (!assignment.completed_at) {
        updateData.completed_at = nowIso;
        updateData.completed_shift_id = shiftId;
      }
    }

    const { error: updateErr } = await supabaseServer
      .from("shift_assignments")
      .update(updateData)
      .eq("id", assignmentId)
      .is("deleted_at", null);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update assignment." }, { status: 500 });
  }
}
