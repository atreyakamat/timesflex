/** Thrown when the solver refuses a request. Its details go to the server log, not the client. */
export class SolverRejectedError extends Error {}

export const solveWithSolver = async (requestPayload) => {
  const solverUrl = process.env.SOLVER_URL ?? 'http://127.0.0.1:8000/solve';
  const response = await fetch(solverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
    signal: AbortSignal.timeout(150000),
  });

  if (!response.ok) {
    const message = await response.text();
    if (response.status === 422) throw new SolverRejectedError(`Solver refused the request: ${message.slice(0, 500)}`);
    throw new Error(`Solver request failed: ${response.status} ${message.slice(0, 500)}`);
  }

  return response.json();
};
