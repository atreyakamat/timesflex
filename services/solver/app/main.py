from fastapi import FastAPI

from .models import SolverRequest, SolverResponse
from .solver import solve_timetable

app = FastAPI(title="TimeFlex Solver", version="0.2.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/solve", response_model=SolverResponse)
def solve(request: SolverRequest) -> SolverResponse:
    result = solve_timetable(request)
    return SolverResponse(
        status="ok" if not result.unscheduled else "partial",
        scheduled_sessions=result.scheduled,
        unscheduled_sessions=result.unscheduled,
        diagnostics=result.diagnostics,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
