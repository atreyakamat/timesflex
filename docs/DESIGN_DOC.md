# TimeFlex Design Doc

## Overview
TimeFlex is an institutional scheduling platform for education organizations. The first build should focus on a college department timetable generator with support for divisions, teachers, subjects, rooms, labs, breaks, and exports. The design should make it easy to expand later into schools, exams, staff shifts, substitutions, and multi-campus scheduling.

## Product Principles
- Configure once, reuse many times.
- Constraint-first scheduling, not just visual timetable editing.
- Manual override must coexist with generated output.
- Natural language setup should produce a reviewable structured draft.
- The same institutional data should support many timetable views.

## Core Domain Model
### Institution
- Name
- Type
- Working days
- Working hours
- Break and lunch rules
- Academic structures
- Rooms
- Labs
- Teachers
- Staff
- Subjects

### Academic Hierarchy
For the first version:
- Department
- Year
- Semester
- Division
- Batch

### Teaching Resources
- Teachers
- Subjects
- Room assignments
- Lab eligibility
- Availability windows
- Load limits

### Physical Resources
- Classrooms
- Labs
- Seminar halls
- Capacity
- Allowed subjects
- Availability windows
- Equipment metadata

### Schedule Output
- Day
- Start time
- End time
- Resource assignment
- Teacher assignment
- Class or batch assignment
- Session type
- Lock state

## Architecture
### Frontend Application
The frontend should provide:
- Institution setup forms
- Timetable editor
- Drag-and-drop schedule grid
- Chat setup panel
- Conflict and constraint review
- Export actions

### API Layer
The API layer should:
- Authenticate users
- Store institution master data
- Normalize scheduling requests
- Trigger generation jobs
- Persist generated schedules
- Serve timetable views and exports

### Scheduling Service
The scheduler should:
- Accept a normalized schedule problem
- Apply hard constraints first
- Optimize against soft preferences
- Return a conflict-free schedule when possible
- Report unsatisfied constraints when not possible

## Solver Design
### Inputs
- Institution profile
- Academic structure
- Teacher availability
- Room and lab availability
- Subject requirements
- Slot definitions
- Break and lunch rules
- Locked timetable items

### Hard Constraints
- No teacher overlap
- No class overlap
- No room overlap
- No lab overlap
- Break and lunch preservation
- Fixed availability respect
- Lab block continuity

### Soft Constraints
- Spread workload across the week
- Limit daily overload per teacher
- Prefer longer blocks for practicals
- Avoid difficult subjects at the end of the day
- Keep subject distribution balanced

### Output
- Final timetable entries
- Conflict report if unsolved
- Metrics for utilization and load balance

## Data Modeling Approach
### Recommended Entities
- Institution
- Department
- Program or course
- Year
- Semester
- Division
- Batch
- Subject
- Teacher
- Staff member
- Room
- Lab
- Time slot
- Schedule version
- Schedule session
- Constraint rule
- Export artifact

### Important Relationships
- One institution has many departments, rooms, teachers, and subjects.
- One department has many years, semesters, divisions, and batches.
- Teachers can teach many subjects and be linked to many classes.
- Rooms and labs can be constrained by subject and capacity.
- A timetable version contains many sessions.

## UI Design Direction
### Primary Screens
- Institution onboarding
- Academic structure setup
- Teacher and room setup
- Generator configuration
- Timetable canvas
- Conflict panel
- Export screen

### Interaction Model
- Use forms for structured setup.
- Use drag-and-drop for post-generation adjustments.
- Use a confirmation step after chat-based input parsing.
- Allow locking sessions before regeneration.

### View Types
- Class timetable
- Teacher timetable
- Room timetable
- Lab timetable
- Batch timetable
- Staff timetable later

## Generation Workflow
1. User defines institution data.
2. User adds academic structure, teachers, subjects, rooms, and labs.
3. User defines slot rules and constraints.
4. User submits generation request.
5. System converts data into solver input.
6. Solver returns a schedule or conflict report.
7. User reviews and manually edits.
8. User exports the approved version.

## Versioning Strategy
- Store each generated timetable as a version.
- Preserve the institution master data separately.
- Track locks and manual changes as overlays.
- Allow regeneration from the same base profile with different parameters.

## Future Expansion
- School-specific standards and divisions
- Exam timetables
- Staff duty timetables
- Substitution workflows
- Multi-campus support
- Attendance integration
- Analytics and reports

## Open Design Questions
- How to model classes across both school and college hierarchies without duplicating schema.
- Whether chat parsing should be handled in the backend API or a dedicated AI service.
- How aggressive soft-constraint optimization should be during MVP generation.
- Whether timetable edits should be stored as patches or as a full regenerated version.
