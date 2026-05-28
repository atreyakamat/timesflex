from pydantic import BaseModel, Field


class SessionRequest(BaseModel):
    id: str
    subject_id: str
    teacher_id: str
    room_id: str
    division_id: str
    kind: str = Field(default="lecture")
    duration_slots: int = Field(default=1, ge=1)


class TeacherConstraint(BaseModel):
    teacher_id: str
    max_lectures_per_day: int
    max_lectures_per_week: int


class SolverRequest(BaseModel):
    days: list[str]
    slots: list[str]
    sessions: list[SessionRequest]
    teacher_constraints: list[TeacherConstraint] = Field(default_factory=list)


class ScheduledSession(BaseModel):
    id: str
    subject_id: str
    teacher_id: str
    room_id: str
    division_id: str
    kind: str
    day: str
    slot: str
    duration_slots: int


class SolverResponse(BaseModel):
    status: str
    scheduled_sessions: list[ScheduledSession]
    unscheduled_sessions: list[SessionRequest]
