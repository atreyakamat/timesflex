from __future__ import annotations

from ortools.sat.python import cp_model

from .models import ScheduledSession, SessionRequest, SolverRequest


def solve_timetable(request: SolverRequest) -> tuple[list[ScheduledSession], list[SessionRequest]]:
    if not request.sessions:
        return [], []

    num_days = len(request.days)
    num_slots = len(request.slots)

    model = cp_model.CpModel()
    assignment: dict[tuple[int, int, int], cp_model.IntVar] = {}

    for session_index, session in enumerate(request.sessions):
        possible_starts: list[cp_model.IntVar] = []
        latest_start = num_slots - session.duration_slots
        if latest_start < 0:
            return [], request.sessions

        for day_index in range(num_days):
            for slot_index in range(latest_start + 1):
                var = model.NewBoolVar(f"s{session_index}_d{day_index}_t{slot_index}")
                assignment[(session_index, day_index, slot_index)] = var
                possible_starts.append(var)

        model.Add(sum(possible_starts) == 1)

    def add_resource_constraints(resource_key):
        resource_ids = sorted({resource_key(session) for session in request.sessions})
        for resource_id in resource_ids:
            for day_index in range(num_days):
                for slot_index in range(num_slots):
                    overlapping: list[cp_model.IntVar] = []
                    for session_index, session in enumerate(request.sessions):
                        if resource_key(session) != resource_id:
                            continue
                        latest_start = num_slots - session.duration_slots
                        for start in range(latest_start + 1):
                            if start <= slot_index < start + session.duration_slots:
                                var = assignment.get((session_index, day_index, start))
                                if var is not None:
                                    overlapping.append(var)
                    if overlapping:
                        model.Add(sum(overlapping) <= 1)

    add_resource_constraints(lambda session: session.teacher_id)
    add_resource_constraints(lambda session: session.room_id)
    add_resource_constraints(lambda session: session.division_id)

    objective_terms = []
    for (session_index, day_index, slot_index), var in assignment.items():
        weight = slot_index + (day_index * num_slots)
        objective_terms.append(weight * var)

    model.Minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return [], request.sessions

    scheduled_sessions: list[ScheduledSession] = []
    for session_index, session in enumerate(request.sessions):
        assigned = False
        latest_start = num_slots - session.duration_slots
        for day_index in range(num_days):
            for slot_index in range(latest_start + 1):
                var = assignment[(session_index, day_index, slot_index)]
                if solver.BooleanValue(var):
                    scheduled_sessions.append(
                        ScheduledSession(
                            id=session.id,
                            subject_id=session.subject_id,
                            teacher_id=session.teacher_id,
                            room_id=session.room_id,
                            division_id=session.division_id,
                            kind=session.kind,
                            day=request.days[day_index],
                            slot=request.slots[slot_index],
                            duration_slots=session.duration_slots,
                        )
                    )
                    assigned = True
                    break
            if assigned:
                break

    return scheduled_sessions, []