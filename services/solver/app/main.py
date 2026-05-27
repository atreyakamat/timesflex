from fastapi import FastAPI

from .models import SolverRequest, SolverResponse
from .solver import solve_timetable

app = FastAPI(title="TimeFlex Solver", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/solve", response_model=SolverResponse)
def solve(request: SolverRequest) -> SolverResponse:
    scheduled_sessions, unscheduled_sessions = solve_timetable(request)
    return SolverResponse(
        status="ok" if not unscheduled_sessions else "partial",
        scheduled_sessions=scheduled_sessions,
        unscheduled_sessions=unscheduled_sessions,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
