from __future__ import annotations

from collections import defaultdict

from .models import ScheduledSession, SessionRequest, SolverRequest


def solve_timetable(request: SolverRequest) -> tuple[list[ScheduledSession], list[SessionRequest]]:
    scheduled_sessions: list[ScheduledSession] = []
    unscheduled_sessions: list[SessionRequest] = []

    teacher_usage: dict[tuple[str, str], bool] = {}
    room_usage: dict[tuple[str, str], bool] = {}
    division_usage: dict[tuple[str, str], bool] = {}
    daily_load = defaultdict(int)

    for session in request.sessions:
        placed = False

        for day in request.days:
            if placed:
                break

            for slot in request.slots:
                key = (day, slot)
                if teacher_usage.get((session.teacher_id, day, slot)):
                    continue
                if room_usage.get((session.room_id, day, slot)):
                    continue
                if division_usage.get((session.division_id, day, slot)):
                    continue
                if daily_load[(session.teacher_id, day)] >= 6:
                    continue

                teacher_usage[(session.teacher_id, day, slot)] = True
                room_usage[(session.room_id, day, slot)] = True
                division_usage[(session.division_id, day, slot)] = True
                daily_load[(session.teacher_id, day)] += 1

                scheduled_sessions.append(
                    ScheduledSession(
                        subject_id=session.subject_id,
                        teacher_id=session.teacher_id,
                        room_id=session.room_id,
                        division_id=session.division_id,
                        kind=session.kind,
                        day=day,
                        slot=slot,
                        duration_slots=session.duration_slots,
                    )
                )
                placed = True
                break

        if not placed:
            unscheduled_sessions.append(session)

    return scheduled_sessions, unscheduled_sessions