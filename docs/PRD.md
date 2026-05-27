# TimeFlex PRD

## Product Vision
TimeFlex is an enterprise education scheduling platform that supports AI-assisted and manual timetable creation for institutions. The product should let an institution define its academic structure once and reuse that data across multiple schedule types, including class, teacher, student, lab, room, staff, exam, event, and substitution timetables.

## Problem Statement
Institutions spend significant time manually planning and maintaining schedules across classes, teachers, rooms, labs, events, and exams. Current timetable tools are often too simple, one-off, or student-focused. TimeFlex should become a reusable institutional scheduling system with constraint-based generation, manual editing, and chat-based setup.

## Target Users
- School administrators
- College administrators
- Department heads
- Timetable coordinators
- Teachers
- Lab assistants
- Staff supervisors
- Students

## Primary Use Case
Start with a college department timetable generator for one department, including divisions, teachers, subjects, rooms, labs, breaks, and PDF export. This is the first production-ready slice because it covers the hardest scheduling constraints without taking on every institution type at once.

## Goals
- Create and manage an institution profile once and reuse it for future schedules.
- Generate valid timetables using hard constraints and soft preferences.
- Support manual editing after generation.
- Support multiple timetable views from the same source data.
- Provide a chat flow that converts natural language into structured scheduling rules.

## Non-Goals for MVP
- Full multi-campus orchestration
- Attendance automation
- Advanced analytics and dashboards
- Exam logistics beyond basic exam timetable generation
- All school, college, and university flows at once

## MVP Scope
### Institution Setup
- Institution name and type
- Working days and working hours
- Breaks and lunch periods
- Departments or courses
- Divisions and batches
- Rooms and labs
- Teachers and staff
- Subjects

### Academic Structure
- One college department
- One or more years and semesters
- Divisions per year or semester
- Lab batches such as A1 and A2

### Teacher Setup
- Teacher name
- Subjects taught
- Assigned classes and divisions
- Daily and weekly lecture limits
- Availability and unavailable times
- Preferred slots
- Lab handling capability

### Room and Lab Setup
- Room capacity
- Room type
- Availability windows
- Subject eligibility
- Equipment or software metadata for labs

### Timetable Generation
- Class timetable generation
- Teacher timetable generation
- Room timetable generation
- Lab-aware scheduling
- Break and lunch enforcement
- Conflict detection
- Manual overrides after generation

### Export
- PDF export
- Excel export

## Functional Requirements
### Institution Profile
- The institution profile must be the reusable source of truth for all timetable generation.
- Users must not re-enter core institutional data for each schedule.

### Academic Structure
- The system must support hierarchical scheduling units.
- For the initial slice, the hierarchy should support Department -> Year -> Semester -> Division -> Batch.

### Constraint Management
Hard constraints:
- A teacher cannot be assigned to two sessions at the same time.
- A class cannot have two sessions at the same time.
- A room or lab cannot be double-booked.
- Break and lunch periods must be fixed.
- Lab sessions must respect availability and duration rules.

Soft constraints:
- Distribute lectures evenly across the week.
- Avoid overloading one teacher in a day.
- Prefer longer blocks for labs.
- Balance difficult subjects across the timetable.

### Chat Setup
- The system should accept natural language requirements.
- The system should parse the input into a structured draft.
- The system should present a summary for approval before generation.

### Manual Editing
- The user should be able to move sessions manually.
- The user should be able to lock sessions.
- The user should be able to rerun generation with the locked items preserved.

## Success Metrics
- A valid timetable can be generated for the initial college department slice.
- Users can complete setup without re-entering data repeatedly.
- Conflict rate after generation is near zero for hard constraints.
- Manual edits remain stable after regeneration.
- Exported schedules match the generated timetable.

## Key Risks
- Constraint explosion when combining teacher, room, lab, and batch rules.
- User data modeling becoming too rigid for both schools and colleges.
- Chat parsing producing incomplete or ambiguous structured rules.
- UI complexity if too many timetable types are exposed too early.

## Release Strategy
1. MVP: one college department timetable generator.
2. Smart scheduling: balancing, labs, and chat setup.
3. Attendance layer.
4. Enterprise features such as substitutions, room booking, and multi-campus support.
