FROM python:3.11-slim-bookworm
WORKDIR /solver
COPY services/solver/pyproject.toml services/solver/constraints.txt ./
COPY services/solver/app app
RUN pip install --no-cache-dir -c constraints.txt .
RUN useradd --create-home solver
USER solver
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
