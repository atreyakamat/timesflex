# TimeFlex Solver

Python service for timetable generation using FastAPI and OR-Tools.

## Setup
```bash
python -m venv .venv
.venv\Scripts\activate
pip install -e .
```

## Run
```bash
python -m app.main
```

The solver listens on `http://localhost:8000/solve` and accepts a JSON payload
containing `days`, `slots`, and `sessions`.
