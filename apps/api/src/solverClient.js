import { HttpError } from './errors.js';

const timeoutMs = () => {
  const value = Number(process.env.SOLVER_TIMEOUT_MS ?? 150000);
  return Number.isFinite(value) && value > 0 ? value : 150000;
};

export const solveWithSolver = async (requestPayload) => {
  const solverUrl = process.env.SOLVER_URL ?? 'http://127.0.0.1:8000/solve';
  let response;
  try {
    response = await fetch(solverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new HttpError(504, 'The solver took too long to respond. Try again, or reduce the number of sessions.');
    }
    console.error(`Solver unreachable at ${solverUrl}:`, error.message);
    throw new HttpError(502, 'The scheduling engine is not running. Start it with "npm run dev".');
  }

  if (!response.ok) {
    console.error(`Solver error ${response.status}:`, await response.text());
    throw new HttpError(response.status === 422 ? 400 : 502, response.status === 422
      ? 'The timetable data is incomplete or invalid. Check teachers, rooms and subjects.'
      : 'The scheduling engine failed. Check the server log for details.');
  }

  return response.json();
};
