from __future__ import annotations

from ortools.sat.python import cp_model

from .models import ScheduledSession, SessionRequest, SolverRequest


def solve_timetable(request: SolverRequest) -> tuple[list[ScheduledSession], list[SessionRequest]]:
    if not request.sessions:
        return [], []

    num_days = len(request.days)
    num_slots = len(request.slots)

    def parse_time(time_str: str) -> int:
        h, m = time_str.split(':')
        return int(h) * 60 + int(m)

    breaks_after_slot = set()
    for i in range(num_slots - 1):
        end_time_current = parse_time(request.slots[i].split('-')[1])
        start_time_next = parse_time(request.slots[i + 1].split('-')[0])
        if end_time_current != start_time_next:
            breaks_after_slot.add(i)

    def is_valid_start(start_idx: int, duration: int) -> bool:
        for i in range(start_idx, start_idx + duration - 1):
            if i in breaks_after_slot:
                return False
        return True

    model = cp_model.CpModel()
    assignment: dict[tuple[int, int, int], cp_model.IntVar] = {}

    for session_index, session in enumerate(request.sessions):
        possible_starts: list[cp_model.IntVar] = []
        latest_start = num_slots - session.duration_slots
        if latest_start < 0:
            return [], request.sessions

        for day_index in range(num_days):
            for slot_index in range(latest_start + 1):
                if not is_valid_start(slot_index, session.duration_slots):
                    continue
                var = model.NewBoolVar(f"s{session_index}_d{day_index}_t{slot_index}")
                assignment[(session_index, day_index, slot_index)] = var
                possible_starts.append(var)

        if not possible_starts:
            return [], request.sessions
        
        model.Add(sum(possible_starts) == 1)

    # Overlap constraints (Resource constraints)
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

    # Teacher Workload Constraints
    teacher_constraints_map = {c.teacher_id: c for c in request.teacher_constraints}
    teachers_in_sessions = sorted({s.teacher_id for s in request.sessions})

    for teacher_id in teachers_in_sessions:
        constraint = teacher_constraints_map.get(teacher_id)
        if not constraint:
            continue

        # Max per week
        teacher_sessions_vars = []
        for session_index, session in enumerate(request.sessions):
            if session.teacher_id == teacher_id:
                for day_index in range(num_days):
                    latest_start = num_slots - session.duration_slots
                    for start in range(latest_start + 1):
                        var = assignment.get((session_index, day_index, start))
                        if var is not None:
                            # Each session counts for its duration_slots lectures? 
                            # PRD says "Daily and weekly lecture limits"
                            # Usually, sessions are lectures. If a session is 2 slots, it's 2 lectures.
                            teacher_sessions_vars.append(var * session.duration_slots)
        
        if teacher_sessions_vars:
            model.Add(sum(teacher_sessions_vars) <= constraint.max_lectures_per_week)

        # Max per day
        for day_index in range(num_days):
            daily_vars = []
            for session_index, session in enumerate(request.sessions):
                if session.teacher_id == teacher_id:
                    latest_start = num_slots - session.duration_slots
                    for start in range(latest_start + 1):
                        var = assignment.get((session_index, day_index, start))
                        if var is not None:
                            daily_vars.append(var * session.duration_slots)
            if daily_vars:
                model.Add(sum(daily_vars) <= constraint.max_lectures_per_day)

    # Objective: Spread workload (Minimize late slots)
    objective_terms = []
    for (session_index, day_index, slot_index), var in assignment.items():
        # Base weight: prefer earlier slots and earlier days
        weight = slot_index + (day_index * num_slots)
        
        # Soft constraint: prefer morning slots (first 4 slots) for labs
        session = request.sessions[session_index]
        if session.kind == 'lab' and slot_index >= 4:
            weight += 10 # Penalty for late lab slots
            
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
