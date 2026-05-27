export const solveWithSolver = async (requestPayload) => {
  const solverUrl = process.env.SOLVER_URL ?? 'http://localhost:8000/solve';
  const response = await fetch(solverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Solver request failed: ${response.status} ${message}`);
  }

  return response.json();
};
