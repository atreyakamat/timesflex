export const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const parseTime = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const formatTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mins = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${mins}`;
};

export const buildSlots = (
  startTime: string,
  endTime: string,
  durationMinutes: number,
  breakAfterSlots: number | null,
  breakDurationMinutes: number | null,
) => {
  const slots: string[] = [];
  if (!startTime || !endTime || durationMinutes <= 0) {
    return slots;
  }

  const endMinutes = parseTime(endTime);
  let cursor = parseTime(startTime);
  let slotIndex = 0;

  while (cursor + durationMinutes <= endMinutes) {
    slots.push(`${formatTime(cursor)}-${formatTime(cursor + durationMinutes)}`);
    cursor += durationMinutes;
    slotIndex += 1;

    if (breakAfterSlots && breakDurationMinutes && slotIndex === breakAfterSlots) {
      cursor += breakDurationMinutes;
    }
  }

  return slots;
};

export const exportToCsv = (
  workingDays: string[],
  slots: string[],
  timetableGrid: Record<string, Record<string, any[]>>,
  subjects: any[],
  teachers: any[],
  divisions: any[],
) => {
  const headers = ['Slot', ...workingDays];
  const rows = slots.map((slot) => {
    const row = [slot.replace('-', ' - ')];
    for (const day of workingDays) {
      const sessions = timetableGrid[day]?.[slot] ?? [];
      const cellContent = sessions
        .map((s) => {
          const sub = subjects.find((i) => i.id === s.subject_id)?.name ?? 'Unknown';
          const div = divisions.find((i) => i.id === s.division_id)?.name ?? 'Unknown';
          const tea = teachers.find((i) => i.id === s.teacher_id)?.name ?? 'Unknown';
          return `${sub} (${div}) - ${tea}`;
        })
        .join('; ');
      row.push(cellContent);
    }
    return row;
  });

  const csvContent = [headers, ...rows]
    .map((e) => e.map((val) => `"${val}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `timetable_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
