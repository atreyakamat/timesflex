# TimeFlex Roadmap

## Phase 1: MVP College Department Generator
Goal: build one usable timetable generator for a single college department.

Scope:
- Institution profile
- Department, year, semester, division, and batch setup
- Subject setup
- Teacher setup
- Room and lab setup
- Time slot setup
- Constraint-based generation
- Manual timetable editing
- PDF and Excel export

Exit Criteria:
- One department timetable can be generated successfully.
- Hard constraints are respected.
- Timetable can be edited and exported.

## Phase 2: Smart Scheduling
Goal: improve timetable quality and make setup faster.

Scope:
- Teacher workload balancing
- Lab batch handling
- Multiple schedule variations
- Constraint editor
- Chat-based setup
- Chat-based updates and corrections

Exit Criteria:
- Natural language setup produces structured draft data.
- Users can compare schedule variants.
- Soft constraint quality is visibly improved.

## Phase 3: Attendance Layer
Goal: connect timetable generation to attendance workflows.

Scope:
- Teacher attendance
- Student attendance percentage
- Defaulter list
- Attendance reports
- Timetable-linked attendance marking

Exit Criteria:
- Attendance is derived from active timetables.
- Reports are usable for daily operations.

## Phase 4: Enterprise Features
Goal: expand from timetable maker to institutional operations.

Scope:
- Exam timetables
- Staff duty timetables
- Substitution management
- Room booking
- Department dashboards
- Multi-campus support

Exit Criteria:
- Multiple institution workflows can share the same master data model.
- The product supports larger institutional deployments.

## Recommended Build Order
1. Data model and institution profile.
2. Basic timetable generation for one department.
3. Manual editing and exports.
4. Chat intake and structured validation.
5. Smarter constraints and variant generation.
6. Attendance and enterprise modules.
