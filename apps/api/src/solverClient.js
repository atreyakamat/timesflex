export const solveWithSolver = async (requestPayload) => {
  const solverUrl = process.env.SOLVER_URL ?? 'http://127.0.0.1:8000/solve';
  let response;
  try {
    response = await fetch(solverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });
  } catch (error) {
    throw new Error(`Solver service is not reachable at ${solverUrl}. Start it with "npm run dev". (${error.message})`);
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Solver request failed: ${response.status} ${message}`);
  }

  return response.json();
};
