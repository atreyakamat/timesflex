# TimeFlex Tech Stack

## Product Direction
TimeFlex should use a split architecture: a web application for administration and editing, a scheduling service for constraint solving, and a relational database for institution data. The scheduling engine should be isolated from the main app so it can evolve independently.

## Recommended Stack
### Frontend
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Drag-and-drop library for timetable editing
- FullCalendar or a custom timetable grid for schedule visualization

### Backend
- Node.js
- Express or NestJS
- REST API for CRUD and generation workflows
- Job queue for longer timetable generation requests

### Scheduling Engine
- Python
- OR-Tools for constraint solving
- Service boundary between the backend API and the solver
- Structured JSON input and output for solver runs

### Database
- PostgreSQL
- Use relational modeling for institutions, departments, classes, teachers, rooms, subjects, and generated sessions

### Files and Export
- PDF export library for timetable output
- Spreadsheet export for Excel downloads
- Optional file storage for generated artifacts

### AI Chat Layer
- Natural language intake UI
- JSON schema-based extraction from user prompts
- Validation and missing-field confirmation before generation
- Rules editor that can be updated from chat or manual forms

## Why This Stack
### React + TypeScript
This gives a strong UI foundation for complex scheduling views and editable grids.

### Node.js Backend
The main app needs to handle authentication, CRUD, institutions, permissions, exports, and generation orchestration. Node.js keeps the product layer consistent with the frontend.

### Python + OR-Tools
Timetabling is a constraint problem. OR-Tools is a strong fit for hard constraints, soft preferences, lab blocks, and room assignment.

### PostgreSQL
The domain is relational by nature. Timetables, resources, and institutional hierarchies map cleanly to tables and foreign keys.

## Suggested Services
- Web app: user interface and admin workflows
- API server: authentication, institution CRUD, timetable orchestration
- Scheduler service: receives a normalized problem definition and returns a solved schedule
- Export worker: generates PDF and Excel files asynchronously

## Data Flow
1. User configures institution data.
2. User enters timetable requirements manually or through chat.
3. Backend validates the request and builds a scheduling payload.
4. Scheduler service solves the constraints.
5. Backend stores the generated timetable.
6. UI renders the timetable and enables manual edits.
7. Export worker generates PDF or Excel output.

## Key Implementation Notes
- Keep the solver stateless.
- Treat the institution profile as the reusable source of truth.
- Store generated schedules separately from master data.
- Design the APIs so multiple timetable types can reuse the same base entities.
- Prefer explicit schemas for chat output so the system can validate before solving.

## Recommended Libraries
- Validation: Zod or class-validator
- API docs: OpenAPI
- ORM: Prisma or TypeORM
- State management: lightweight client state plus server state queries
- Background jobs: BullMQ or similar

## Deployment Shape
- Frontend deployed separately from backend
- Backend and solver containerized independently
- PostgreSQL managed as a separate persistent service
- Object storage for exports and attachments
