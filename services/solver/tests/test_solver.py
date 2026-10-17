from collections import Counter, defaultdict

from app.models import Room, SessionRequest, SolverRequest, TeacherConstraint, TimeRef, Unavailability
from app.solver import solve_timetable

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
# 09:00-12:00, break, 12:30-15:30, i.e. two blocks of three slots.
SLOTS = ["09:00-10:00", "10:00-11:00", "11:00-12:00", "12:30-13:30", "13:30-14:30", "14:30-15:30"]


def session(id, subject="math", teacher="t1", room="r1", division="A", **extra):
    return SessionRequest(
        id=id, subject_id=subject, teacher_id=teacher, room_id=room, division_id=division, **extra
    )


def cells(scheduled):
    """Expand each scheduled session into the (day, slot_index) cells it occupies."""
    for item in scheduled:
        start = SLOTS.index(item.slot)
        for offset in range(item.duration_slots):
            yield item, (item.day, start + offset)


def assert_no_overlaps(scheduled):
    seen = defaultdict(list)
    for item, cell in cells(scheduled):
        seen[("teacher", item.teacher_id, cell)].append(item.id)
        seen[("room", item.room_id, cell)].append(item.id)
    for key, ids in seen.items():
        assert len(ids) == 1, f"double booking {key}: {ids}"


def test_basic_schedule_has_no_overlaps_and_spreads_across_week():
    sessions = [session(f"m{i}") for i in range(5)] + [
        session(f"p{i}", subject="phys", teacher="t2", room="r2") for i in range(5)
    ]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions))
    assert not result.unscheduled
    assert_no_overlaps(result.scheduled)
    # Same division can't be in two places at once.
    division_cells = [cell for _, cell in cells(result.scheduled)]
    assert len(division_cells) == len(set(division_cells))
    # Soft constraint: 5 maths lectures over 5 days should land on 5 different days.
    math_days = Counter(item.day for item in result.scheduled if item.subject_id == "math")
    assert max(math_days.values()) == 1


def test_lab_blocks_never_straddle_a_break():
    sessions = [session(f"lab{i}", subject="lab", kind="lab", duration_slots=3) for i in range(4)]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions))
    assert not result.unscheduled
    for item in result.scheduled:
        assert SLOTS.index(item.slot) in (0, 3)


def test_session_longer_than_any_block_is_reported():
    result = solve_timetable(
        SolverRequest(days=DAYS, slots=SLOTS, sessions=[session("x", duration_slots=4)], names={"math": "Maths"})
    )
    assert [s.id for s in result.unscheduled] == ["x"]
    assert any("Maths needs 4 back-to-back slots" in d for d in result.diagnostics)


def test_teacher_limits_and_unavailability():
    sessions = [session(f"m{i}") for i in range(6)]
    constraint = TeacherConstraint(
        teacher_id="t1",
        max_lectures_per_day=1,
        max_lectures_per_week=4,
        unavailable=[Unavailability(day="Friday")],
    )
    result = solve_timetable(
        SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions, teacher_constraints=[constraint])
    )
    assert len(result.scheduled) == 4
    assert len(result.unscheduled) == 2
    assert all(item.day != "Friday" for item in result.scheduled)
    assert max(Counter(item.day for item in result.scheduled).values()) == 1
    assert any("can teach at most 4" in d for d in result.diagnostics)


def test_batches_can_run_labs_in_parallel_but_not_with_whole_division():
    sessions = [
        session("a1", subject="lab", teacher="t1", room="lab1", batch="A1", kind="lab", duration_slots=3),
        session("a2", subject="lab", teacher="t2", room="lab2", batch="A2", kind="lab", duration_slots=3),
    ] + [session(f"lec{i}", subject="math", teacher="t3", room="r1") for i in range(27)]
    # 30 cells per week: 27 lectures + one 3-slot lab block works only if A1 and A2 run in parallel.
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions))
    assert not result.unscheduled
    by_id = {item.id: item for item in result.scheduled}
    assert (by_id["a1"].day, by_id["a1"].slot) == (by_id["a2"].day, by_id["a2"].slot)
    lab_cells = {cell for item, cell in cells([by_id["a1"]])}
    lecture_cells = {cell for item, cell in cells(result.scheduled) if item.subject_id == "math"}
    assert not lab_cells & lecture_cells


def test_locked_sessions_stay_put():
    sessions = [session("m0", locked=True, day="Wednesday", slot="13:30-14:30")] + [
        session(f"m{i}") for i in range(1, 4)
    ]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions))
    locked = next(item for item in result.scheduled if item.id == "m0")
    assert (locked.day, locked.slot, locked.locked) == ("Wednesday", "13:30-14:30", True)


def test_infeasible_lock_is_released_with_a_diagnostic():
    sessions = [session("lab", duration_slots=2, locked=True, day="Monday", slot="11:00-12:00")]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions))
    assert len(result.scheduled) == 1
    assert result.scheduled[0].slot != "11:00-12:00"
    assert any("was released" in d for d in result.diagnostics)


def test_overloaded_week_is_partial_not_empty():
    sessions = [session(f"m{i}") for i in range(35)]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions))
    assert len(result.scheduled) == 30
    assert len(result.unscheduled) == 5
    assert any("needs 35 slots/week" in d for d in result.diagnostics)


def test_auto_room_respects_type_capacity_and_availability():
    rooms = [
        Room(id="small", type="classroom", capacity=30),
        Room(id="big", type="classroom", capacity=80, unavailable=[TimeRef(day="Monday")]),
        Room(id="lab1", type="lab", capacity=30),
    ]
    sessions = [session(f"m{i}", room="", size=60) for i in range(3)] + [
        session(f"l{i}", subject="lab", teacher="t2", room="", kind="lab", size=25, duration_slots=2)
        for i in range(2)
    ]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions, rooms=rooms))
    assert not result.unscheduled
    for item in result.scheduled:
        if item.kind == "lab":
            assert item.room_id == "lab1"
        else:
            # Only the 80-seat room fits 60 students, and it is closed on Mondays.
            assert item.room_id == "big" and item.day != "Monday"
    assert_no_overlaps(result.scheduled)


def test_auto_room_shares_rooms_without_double_booking():
    rooms = [Room(id="r1", capacity=60), Room(id="r2", capacity=60)]
    # 2 divisions x 30 lectures each = 60 cells: needs both rooms every slot.
    sessions = [
        session(f"{division}{i}", subject=f"s{i % 5}", teacher=f"{division}t{i % 5}", room="", division=division)
        for division in ("A", "B")
        for i in range(30)
    ]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions, rooms=rooms))
    assert not result.unscheduled
    assert_no_overlaps(result.scheduled)


def test_no_suitable_room_is_explained():
    rooms = [Room(id="r1", type="classroom", capacity=40)]
    request = SolverRequest(
        days=DAYS,
        slots=SLOTS,
        sessions=[session("l", subject="lab", room="", kind="lab", size=20)],
        rooms=rooms,
        names={"lab": "Physics Lab", "A": "FE-A"},
    )
    result = solve_timetable(request)
    assert [item.id for item in result.unscheduled] == ["l"]
    assert any("No lab seating 20 is available for Physics Lab (FE-A)" in d for d in result.diagnostics)


def test_room_unavailability_applies_to_fixed_rooms():
    rooms = [Room(id="r1", unavailable=[TimeRef(day=day) for day in DAYS[:4]])]
    sessions = [session(f"m{i}") for i in range(3)]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions, rooms=rooms))
    assert {item.day for item in result.scheduled} == {"Friday"}


def test_teacher_preferred_slots_are_honoured_when_possible():
    preferred = [TimeRef(day=day, slot=slot) for day in DAYS for slot in SLOTS[3:]]
    constraint = TeacherConstraint(teacher_id="t1", max_lectures_per_day=6, max_lectures_per_week=30, preferred=preferred)
    sessions = [session(f"m{i}", subject=f"s{i}") for i in range(5)]
    result = solve_timetable(
        SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions, teacher_constraints=[constraint])
    )
    assert all(SLOTS.index(item.slot) >= 3 for item in result.scheduled)


def test_difficult_subjects_are_spread_across_days():
    # Two heavy subjects, 5 sessions each, 10 heavy sessions over 5 days -> two per day at most.
    sessions = [session(f"h{i}", subject=f"heavy{i % 2}", teacher=f"t{i % 2}", room=f"r{i % 2}", difficult=True) for i in range(10)]
    sessions += [session(f"e{i}", subject="easy", teacher="t9", room="r9") for i in range(5)]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions))
    heavy_per_day = Counter(item.day for item in result.scheduled if item.difficult)
    assert max(heavy_per_day.values()) == 2


def test_clashing_locks_move_one_session_instead_of_dropping_it():
    sessions = [
        session("a", locked=True, day="Monday", slot="09:00-10:00"),
        session("b", subject="phys", room="r2", division="B", locked=True, day="Monday", slot="09:00-10:00"),
    ]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions))
    assert not result.unscheduled
    assert_no_overlaps(result.scheduled)
    assert sum(1 for item in result.scheduled if (item.day, item.slot) == ("Monday", "09:00-10:00")) == 1
    assert any("clashed with another session and was moved" in d for d in result.diagnostics)


def test_unplaced_sessions_are_named_even_when_other_warnings_exist():
    sessions = [session(f"m{i}") for i in range(31)] + [
        session("long", subject="chem", teacher="t2", room="r2", division="B", duration_slots=4)
    ]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions, names={"math": "Maths"}))
    assert any("could not be placed" in d and "Maths (A)" in d for d in result.diagnostics)


def test_lock_on_removed_slot_is_reported():
    sessions = [session("m0", locked=True, day="Saturday", slot="09:00-10:00")]
    result = solve_timetable(SolverRequest(days=DAYS, slots=SLOTS, sessions=sessions))
    assert len(result.scheduled) == 1
    assert any("no longer in the timetable" in d for d in result.diagnostics)


def test_negative_teacher_limit_is_rejected():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        TeacherConstraint(teacher_id="t1", max_lectures_per_day=-1, max_lectures_per_week=10)
