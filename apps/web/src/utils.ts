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
