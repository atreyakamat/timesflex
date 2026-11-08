"""A whole department must come back complete, even when the search has very little time."""

import time

from app.models import Room, SessionRequest, SolverRequest, TeacherConstraint
from app.solver import solve_timetable

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
SLOTS = ["09:00-10:00", "10:00-11:00", "11:00-12:00", "12:30-13:30", "13:30-14:30", "14:30-15:30"]


def department(classes: int, *, seed: int | None = None, limit: float = 1.0, style: str = "balanced") -> SolverRequest:
    """Six lectures three times a week and a lab per batch, for every class."""
    sessions: list[SessionRequest] = []
    teachers: set[str] = set()

    def add(subject: str, teacher: str, division: str, **extra) -> None:
        teachers.add(teacher)
        sessions.append(SessionRequest(id=f"s{len(sessions)}", subject_id=subject, teacher_id=teacher, division_id=division, **extra))

    subject_number = 0
    for c in range(classes):
        division = f"C{c}"
        for lecture in range(6):
            for _ in range(3):
                add(f"L{c}-{lecture}", f"T{subject_number // 3}", division, size=60)
            subject_number += 1
        for batch in ("A", "B"):
            add(f"Lab{c}", f"T{subject_number // 3}", division, batch=f"{division}{batch}", kind="lab", duration_slots=2, size=30)
        subject_number += 1
    rooms = [Room(id=f"R{i}", name=f"R{i}", type="classroom", capacity=60) for i in range(classes)]
    rooms += [Room(id=f"Lab{i}", name=f"Lab{i}", type="lab", capacity=30) for i in range(max(2, classes // 4))]
    constraints = [TeacherConstraint(teacher_id=t, max_lectures_per_day=4, max_lectures_per_week=18) for t in sorted(teachers)]
    return SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions, teacher_constraints=constraints, rooms=rooms, time_limit_seconds=limit, seed=seed, style=style)


def assert_no_clashes(request: SolverRequest, scheduled) -> None:
    durations = {s.id: s.duration_slots for s in request.sessions}
    taken: set[tuple] = set()
    for item in scheduled:
        start = SLOTS.index(item.slot)
        for offset in range(durations[item.id]):
            for key in (("teacher", item.teacher_id), ("room", item.room_id), ("group", item.division_id, item.batch or "all")):
                cell = (*key, item.day, start + offset)
                assert cell not in taken, f"clash at {cell}"
                taken.add(cell)
    by_group = {}
    for item in scheduled:
        for offset in range(durations[item.id]):
            by_group.setdefault((item.division_id, item.day, SLOTS.index(item.slot) + offset), []).append(item.batch)
    for batches in by_group.values():
        assert None not in batches or len(batches) == 1, "a batch was in a lab during a whole-class lecture"


def test_a_six_class_department_is_complete_with_a_very_short_search():
    request = department(6, limit=1.0)
    result = solve_timetable(request)
    assert not result.unscheduled
    assert len(result.scheduled) == len(request.sessions)
    assert_no_clashes(request, result.scheduled)


def test_a_large_college_is_complete_and_returns_in_reasonable_time():
    request = department(24, limit=6.0)
    started = time.monotonic()
    result = solve_timetable(request)
    assert not result.unscheduled
    assert_no_clashes(request, result.scheduled)
    assert time.monotonic() - started < 60


def test_styles_and_seeds_still_give_different_weeks_at_scale():
    balanced = solve_timetable(department(6, limit=1.0))
    compact = solve_timetable(department(6, limit=1.0, style="compact", seed=3))
    placed = lambda result: sorted((s.id, s.day, s.slot) for s in result.scheduled)  # noqa: E731
    assert placed(balanced) != placed(compact)


def test_what_cannot_fit_is_left_out_and_reported_rather_than_clashing():
    request = department(1, limit=1.0)
    request = request.model_copy(update={"teacher_constraints": [c.model_copy(update={"max_lectures_per_week": 2}) for c in request.teacher_constraints]})
    result = solve_timetable(request)
    assert result.unscheduled
    assert result.scheduled
    assert_no_clashes(request, result.scheduled)
    assert result.diagnostics
