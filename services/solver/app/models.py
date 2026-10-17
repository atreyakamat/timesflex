from pydantic import BaseModel, Field


class SessionRequest(BaseModel):
    id: str
    subject_id: str
    teacher_id: str
    # A fixed room. Empty means the solver picks any suitable room from `rooms`.
    room_id: str = ""
    division_id: str
    # A lab batch (e.g. "A1"). None means the whole division attends.
    batch: str | None = None
    kind: str = Field(default="lecture")
    duration_slots: int = Field(default=1, ge=1)
    # Students attending; used to pick a room that seats them (0 = unknown).
    size: int = Field(default=0, ge=0)
    # Heavy subjects are spread so a class does not get several on one day.
    difficult: bool = False
    # Locked sessions are pinned to this day/slot when regenerating.
    locked: bool = False
    day: str | None = None
    slot: str | None = None


class TimeRef(BaseModel):
    day: str
    # None means the whole day.
    slot: str | None = None


# Kept for callers that still import the old name.
Unavailability = TimeRef


class TeacherConstraint(BaseModel):
    teacher_id: str
    max_lectures_per_day: int = Field(ge=0)
    max_lectures_per_week: int = Field(ge=0)
    unavailable: list[TimeRef] = Field(default_factory=list)
    # Soft: when set, sessions outside these slots are penalised.
    preferred: list[TimeRef] = Field(default_factory=list)


class Room(BaseModel):
    id: str
    type: str = "classroom"
    capacity: int = Field(default=0, ge=0)
    unavailable: list[TimeRef] = Field(default_factory=list)


class SolverRequest(BaseModel):
    days: list[str]
    slots: list[str]
    sessions: list[SessionRequest]
    teacher_constraints: list[TeacherConstraint] = Field(default_factory=list)
    rooms: list[Room] = Field(default_factory=list)
    # Optional id -> display name map, used only to make diagnostics readable.
    names: dict[str, str] = Field(default_factory=dict)
    time_limit_seconds: float = Field(default=10.0, gt=0, le=120)


class ScheduledSession(BaseModel):
    id: str
    subject_id: str
    teacher_id: str
    room_id: str
    division_id: str
    batch: str | None = None
    kind: str
    day: str
    slot: str
    duration_slots: int
    size: int = 0
    difficult: bool = False
    locked: bool = False


class SolverResponse(BaseModel):
    status: str
    scheduled_sessions: list[ScheduledSession]
    unscheduled_sessions: list[SessionRequest]
    diagnostics: list[str] = Field(default_factory=list)
