from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from .models import Room, ScheduledSession, SessionRequest, SolverRequest, TimeRef

# Objective weights. Placing sessions always dominates the soft preferences,
# so a feasible placement is never traded away for a "nicer" timetable.
PLACE_WEIGHT = 1000
LOCKED_PLACE_WEIGHT = 10 * PLACE_WEIGHT
# Keeping a locked session in its pinned cell beats every soft preference, but a
# clash between locks moves one of them instead of dropping it.
LOCK_KEEP_WEIGHT = 500
SAME_DAY_REPEAT_PENALTY = 30
DIFFICULT_PEAK_PENALTY = 12
DIVISION_PEAK_PENALTY = 8
TEACHER_PEAK_PENALTY = 5
PREFERENCE_MISS_PENALTY = 4
LATE_SLOT_PENALTY = 1

WHOLE_DIVISION = "__all__"


@dataclass
class SolveResult:
    scheduled: list[ScheduledSession] = field(default_factory=list)
    unscheduled: list[SessionRequest] = field(default_factory=list)
    diagnostics: list[str] = field(default_factory=list)


def _parse_time(value: str) -> int:
    hours, minutes = value.strip().split(":")
    return int(hours) * 60 + int(minutes)


def _valid_slot(label: str) -> bool:
    try:
        start, end = label.split("-")
        return _parse_time(start) < _parse_time(end)
    except ValueError:
        return False


def teacher_load(request: SolverRequest, session: SessionRequest) -> int:
    """How much of a teacher's daily/weekly limit one session uses."""
    if request.lab_counts_as_one and session.kind == "lab":
        return 1
    return session.duration_slots


def _breaks_after(slots: list[str]) -> set[int]:
    """Indices i where slot i and slot i+1 are not back to back (a break sits between them)."""
    breaks: set[int] = set()
    for index in range(len(slots) - 1):
        try:
            end_current = _parse_time(slots[index].split("-")[1])
            start_next = _parse_time(slots[index + 1].split("-")[0])
        except (IndexError, ValueError):
            continue
        if end_current != start_next:
            breaks.add(index)
    return breaks


def _longest_block(num_slots: int, breaks: set[int]) -> int:
    longest = current = 0
    for index in range(num_slots):
        current += 1
        longest = max(longest, current)
        if index in breaks:
            current = 0
    return longest


def _cells(refs: list[TimeRef], days: list[str], slots: list[str]) -> set[tuple[int, int]]:
    """Expand day / day+slot references into (day index, slot index) cells, ignoring unknown ones."""
    day_index = {day: i for i, day in enumerate(days)}
    slot_index = {slot: i for i, slot in enumerate(slots)}
    cells: set[tuple[int, int]] = set()
    for ref in refs:
        if ref.day not in day_index:
            continue
        d = day_index[ref.day]
        if ref.slot is None:
            cells.update((d, t) for t in range(len(slots)))
        elif ref.slot in slot_index:
            cells.add((d, slot_index[ref.slot]))
    return cells


def room_fits(session: SessionRequest, room: Room) -> bool:
    """Labs go in labs, everything else in classrooms or halls, and the room must seat the group."""
    if (room.type == "lab") != (session.kind == "lab"):
        return False
    return not (session.size and room.capacity and room.capacity < session.size)


def room_options(session: SessionRequest, rooms: list[Room]) -> list[str]:
    if session.room_id:
        return [session.room_id]
    return [room.id for room in rooms if room_fits(session, room)]


def _group_label(request: SolverRequest, session: SessionRequest) -> str:
    name = request.names.get
    label = f"{name(session.subject_id, session.subject_id)} ({name(session.division_id, session.division_id)}"
    return label + (f" {session.batch})" if session.batch else ")")


def preflight(request: SolverRequest) -> list[str]:
    """Cheap capacity checks that explain *why* a timetable cannot be complete."""
    name = lambda key: request.names.get(key, key)  # noqa: E731
    num_days, num_slots = len(request.days), len(request.slots)
    issues: list[str] = []

    if num_days == 0 or num_slots == 0:
        return ["No working days or time slots are defined."]

    bad_slots = [slot for slot in request.slots if not _valid_slot(slot)]
    if bad_slots:
        issues.append(
            f"Time slots must look like 09:00-10:00 (got {', '.join(bad_slots[:3])}), "
            "so breaks cannot be detected and labs may run across them."
        )
    starts = [_parse_time(slot.split("-")[0]) for slot in request.slots if _valid_slot(slot)]
    if not bad_slots and starts != sorted(starts):
        issues.append("Time slots are not in time order, so breaks may be detected wrongly.")

    longest = _longest_block(num_slots, _breaks_after(request.slots))
    too_long = {(s.subject_id, s.duration_slots) for s in request.sessions if s.duration_slots > longest}
    for subject_id, duration in sorted(too_long):
        issues.append(
            f"{name(subject_id)} needs {duration} back-to-back slots but the longest block between breaks is {longest}."
        )

    homeless = []
    for session in request.sessions:
        if not session.room_id and not room_options(session, request.rooms):
            kind = "lab" if session.kind == "lab" else "classroom"
            seats = f" seating {session.size}" if session.size else ""
            message = f"No {kind}{seats} is available for {_group_label(request, session)}."
            if message not in homeless:
                homeless.append(message)
    issues.extend(homeless)

    # A fixed room bypasses the automatic type and capacity match, so check it here.
    rooms_by_id = {room.id: room for room in request.rooms}
    misfits = []
    for session in request.sessions:
        room = rooms_by_id.get(session.room_id) if session.room_id else None
        if room and not room_fits(session, room):
            reason = (
                f"seats only {room.capacity}" if (room.type == "lab") == (session.kind == "lab") else f"is a {room.type}"
            )
            message = f"{_group_label(request, session)} is fixed to room {name(room.id)}, which {reason}."
            if message not in misfits:
                misfits.append(message)
    issues.extend(misfits)

    load_by_teacher: dict[str, int] = defaultdict(int)
    for session in request.sessions:
        load_by_teacher[session.teacher_id] += teacher_load(request, session)

    for constraint in request.teacher_constraints:
        load = load_by_teacher.get(constraint.teacher_id, 0)
        blocked_days = {u.day for u in constraint.unavailable if u.slot is None}
        open_days = len([d for d in request.days if d not in blocked_days])
        capacity = min(constraint.max_lectures_per_week, constraint.max_lectures_per_day * open_days)
        if load > capacity:
            issues.append(
                f"{name(constraint.teacher_id)} is assigned {load} slots/week but can teach at most {capacity} "
                f"({constraint.max_lectures_per_day}/day over {open_days} available days, {constraint.max_lectures_per_week}/week cap)."
            )

    group_load: dict[tuple[str, str], int] = defaultdict(int)
    batches_by_division: dict[str, set[str]] = defaultdict(set)
    for session in request.sessions:
        if session.batch:
            batches_by_division[session.division_id].add(session.batch)
    for session in request.sessions:
        targets = [session.batch] if session.batch else (sorted(batches_by_division[session.division_id]) or [WHOLE_DIVISION])
        for batch in targets:
            group_load[(session.division_id, batch)] += session.duration_slots
    week_capacity = num_days * num_slots
    for (division_id, batch), load in sorted(group_load.items()):
        if load > week_capacity:
            label = name(division_id) if batch == WHOLE_DIVISION else f"{name(division_id)} batch {batch}"
            issues.append(f"{label} needs {load} slots/week but the week only has {week_capacity}.")

    # Fixed rooms: each one has only so many open cells per week.
    rooms = {room.id: room for room in request.rooms}
    open_cells = {
        room.id: week_capacity - len(_cells(room.unavailable, request.days, request.slots)) for room in request.rooms
    }
    room_load: dict[str, int] = defaultdict(int)
    for session in request.sessions:
        if session.room_id:
            room_load[session.room_id] += session.duration_slots
    for room_id, load in sorted(room_load.items()):
        available = open_cells.get(room_id, week_capacity)
        if load > available:
            issues.append(f"Room {name(room_id)} is booked for {load} slots/week but is open for only {available}.")

    # Room pools (labs vs. classrooms): total demand against total open time.
    for is_lab, label in ((True, "Lab rooms"), (False, "Classrooms")):
        pool = [room_id for room_id, room in rooms.items() if (room.type == "lab") == is_lab]
        demand = sum(
            s.duration_slots
            for s in request.sessions
            if (s.room_id in pool) or (not s.room_id and (s.kind == "lab") == is_lab)
        )
        supply = sum(open_cells[room_id] for room_id in pool)
        if pool and demand > supply:
            issues.append(f"{label} are needed for {demand} slots/week but together are open for only {supply}.")

    return issues


def solve_timetable(request: SolverRequest) -> SolveResult:
    result = SolveResult(diagnostics=preflight(request))
    if not request.sessions:
        return result

    days, slots = request.days, request.slots
    num_days, num_slots = len(days), len(slots)
    if num_days == 0 or num_slots == 0:
        result.unscheduled = list(request.sessions)
        return result

    breaks = _breaks_after(slots)
    day_index = {day: i for i, day in enumerate(days)}
    slot_index = {slot: i for i, slot in enumerate(slots)}
    constraints = {c.teacher_id: c for c in request.teacher_constraints}
    teacher_blocked = {c.teacher_id: _cells(c.unavailable, days, slots) for c in request.teacher_constraints}
    teacher_preferred = {c.teacher_id: _cells(c.preferred, days, slots) for c in request.teacher_constraints}
    room_blocked = {room.id: _cells(room.unavailable, days, slots) for room in request.rooms}

    def span(session: SessionRequest, t: int) -> range:
        return range(t, t + session.duration_slots)

    def valid_start(session: SessionRequest, d: int, t: int) -> bool:
        if t + session.duration_slots > num_slots:
            return False
        if any(i in breaks for i in range(t, t + session.duration_slots - 1)):
            return False
        blocked = teacher_blocked.get(session.teacher_id, set())
        return not any((d, i) in blocked for i in span(session, t))

    def room_free(room_id: str, session: SessionRequest, d: int, t: int) -> bool:
        blocked = room_blocked.get(room_id, set())
        return not any((d, i) in blocked for i in span(session, t))

    batches_by_division: dict[str, set[str]] = defaultdict(set)
    for session in request.sessions:
        if session.batch:
            batches_by_division[session.division_id].add(session.batch)

    model = cp_model.CpModel()
    # starts[s][(d, t, room_id)] -> BoolVar: session s starts at day d, slot t in that room.
    starts: dict[int, dict[tuple[int, int, str], cp_model.IntVar]] = {}
    placed: dict[int, cp_model.IntVar] = {}
    occupancy: dict[tuple, list[cp_model.IntVar]] = defaultdict(list)
    teacher_day_load: dict[tuple[str, int], list] = defaultdict(list)
    group_day_load: dict[tuple[str, str, int], list] = defaultdict(list)
    difficult_day_count: dict[tuple[str, str, int], list] = defaultdict(list)
    subject_day_count: dict[tuple[str, str, str, int], list] = defaultdict(list)
    soft_terms = []

    pinned_keys: dict[int, set[tuple[int, int, str]]] = {}
    for s, session in enumerate(request.sessions):
        options = room_options(session, request.rooms)
        candidates = [
            (d, t, r)
            for d in range(num_days)
            for t in range(num_slots)
            if valid_start(session, d, t)
            for r in options
            if room_free(r, session, d, t)
        ]
        if session.locked:
            if session.day in day_index and session.slot in slot_index:
                d, t = day_index[session.day], slot_index[session.slot]
                pinned_rooms = {session.room_id} if session.room_id else set(options)
                pinned_keys[s] = {key for key in candidates if key[0] == d and key[1] == t and key[2] in pinned_rooms}
                if not pinned_keys[s]:
                    result.diagnostics.append(
                        f"Locked {_group_label(request, session)} on {session.day} {session.slot} "
                        "breaks a hard rule (break, day end, teacher or room unavailability) and was released."
                    )
            else:
                result.diagnostics.append(
                    f"Locked {_group_label(request, session)} points at {session.day} {session.slot}, "
                    "which is no longer in the timetable, and was released."
                )

        groups = (
            [session.batch] if session.batch else sorted(batches_by_division[session.division_id]) + [WHOLE_DIVISION]
        )
        preferred = teacher_preferred.get(session.teacher_id, set())
        starts[s] = {}
        for d, t, r in candidates:
            var = model.NewBoolVar(f"s{s}_d{d}_t{t}_{r}")
            starts[s][(d, t, r)] = var
            for covered in span(session, t):
                occupancy[("teacher", session.teacher_id, d, covered)].append(var)
                occupancy[("room", r, d, covered)].append(var)
                for group in groups:
                    occupancy[("group", session.division_id, group, d, covered)].append(var)
            teacher_day_load[(session.teacher_id, d)].append(var * teacher_load(request, session))
            for group in groups:
                group_day_load[(session.division_id, group, d)].append(var * session.duration_slots)
                subject_day_count[(session.division_id, group, session.subject_id, d)].append(var)
                if session.difficult:
                    difficult_day_count[(session.division_id, group, d)].append(var)
            misses = sum(1 for i in span(session, t) if preferred and (d, i) not in preferred)
            soft_terms.append(var * (LATE_SLOT_PENALTY * t + PREFERENCE_MISS_PENALTY * misses))

        placed[s] = model.NewBoolVar(f"placed{s}")
        model.Add(sum(starts[s].values()) == placed[s])

    # Hard: no teacher, room, division or batch is in two places at once.
    for variables in occupancy.values():
        if len(variables) > 1:
            model.AddAtMostOne(variables)

    # Hard: teacher daily and weekly lecture limits.
    for teacher_id, constraint in constraints.items():
        weekly = []
        for d in range(num_days):
            daily = teacher_day_load.get((teacher_id, d), [])
            if daily:
                model.Add(sum(daily) <= constraint.max_lectures_per_day)
                weekly.extend(daily)
        if weekly:
            model.Add(sum(weekly) <= constraint.max_lectures_per_week)

    # Soft: spread each subject across the week and balance daily load.
    penalties = list(soft_terms)
    for variables in subject_day_count.values():
        if len(variables) > 1:
            excess = model.NewIntVar(0, len(variables), "")
            model.Add(excess >= sum(variables) - 1)
            penalties.append(SAME_DAY_REPEAT_PENALTY * excess)

    def peak(loads: dict, key_of, weight: int):
        grouped: dict = defaultdict(list)
        for key, terms in loads.items():
            grouped[key_of(key)].append(terms)
        for per_day in grouped.values():
            top = model.NewIntVar(0, num_slots, "")
            for terms in per_day:
                model.Add(top >= sum(terms))
            penalties.append(weight * top)

    peak(group_day_load, lambda key: key[:2], DIVISION_PEAK_PENALTY)
    peak(teacher_day_load, lambda key: key[0], TEACHER_PEAK_PENALTY)
    peak(difficult_day_count, lambda key: key[:2], DIFFICULT_PEAK_PENALTY)

    reward = [
        (LOCKED_PLACE_WEIGHT if session.locked else PLACE_WEIGHT) * session.duration_slots * placed[s]
        for s, session in enumerate(request.sessions)
    ]
    for s, keys in pinned_keys.items():
        reward.extend(LOCK_KEEP_WEIGHT * starts[s][key] for key in keys)
    model.Maximize(sum(reward) - sum(penalties))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = request.time_limit_seconds
    solver.parameters.num_workers = 8
    # Same input, same timetable: regenerating should not reshuffle everything.
    solver.parameters.random_seed = 0
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        result.unscheduled = list(request.sessions)
        if status == cp_model.UNKNOWN:
            result.diagnostics.append(
                f"The solver found no placement within the {request.time_limit_seconds:g}s time limit. "
                "Try again with a longer limit or fewer sessions."
            )
        else:
            result.diagnostics.append("The solver input is contradictory, so nothing could be placed.")
        return result

    for s, session in enumerate(request.sessions):
        chosen = next((key for key, var in starts[s].items() if solver.BooleanValue(var)), None)
        if chosen is None:
            result.unscheduled.append(session)
            continue
        d, t, room_id = chosen
        if chosen not in pinned_keys.get(s, {chosen}):
            result.diagnostics.append(
                f"Locked {_group_label(request, session)} on {session.day} {session.slot} clashed with another "
                f"session and was moved to {days[d]} {slots[t]}."
            )
        result.scheduled.append(
            ScheduledSession(
                **session.model_dump(exclude={"day", "slot", "room_id"}),
                room_id=room_id,
                day=days[d],
                slot=slots[t],
            )
        )

    if result.unscheduled:
        labels = sorted({_group_label(request, session) for session in result.unscheduled})
        shown = ", ".join(labels[:10]) + (f" and {len(labels) - 10} more" if len(labels) > 10 else "")
        result.diagnostics.append(
            f"{len(result.unscheduled)} session(s) could not be placed without breaking a hard constraint: {shown}. "
            "Add slots or rooms, raise teacher limits, or reduce sessions per week."
        )
    return result
