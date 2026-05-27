from pydantic import BaseModel, Field


class SessionRequest(BaseModel):
    id: str
    subject_id: str
    teacher_id: str
    room_id: str
    division_id: str
    kind: str = Field(default="lecture")
    duration_slots: int = Field(default=1, ge=1)


class SolverRequest(BaseModel):
    days: list[str]
    slots: list[str]
    sessions: list[SessionRequest]


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