# TimeFlex

TimeFlex is an enterprise education scheduling platform for AI-assisted and manual timetable generation.

## Workspace Layout
- `apps/web`: React frontend for setup, generation, and editing
- `apps/api`: Node.js API for institutions, scheduling jobs, and exports
- `services/solver`: Python scheduling engine using OR-Tools
- `packages/shared`: Shared types and schemas
- `docs`: Product, stack, design, and roadmap docs

## MVP Scope
The first build focuses on one college department timetable generator with:
- divisions and batches
- teachers and subjects
- rooms and labs
- break and lunch rules
- hard-constraint scheduling
- manual timetable edits
- PDF and Excel export

## Next Steps
1. Install dependencies for each workspace.
2. Implement the shared schema package.
3. Connect the API to the solver service.
4. Build the timetable editor UI.
