import {
  addDays,
  addWeeks,
  addYears,
  format,
  isValid,
  parse,
  startOfDay,
} from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

export const SEARCH_TIME_ZONE = 'America/Toronto';

export interface ResolvedDateMatch {
  isoDate: string;
  label: string;
  source: string;
}

export interface CommandResolution {
  matched: string;
  destination: string;
}

interface CommandDefinition {
  command: string;
  path: string;
  aliases: string[];
  label: string;
}

const EXACT_COMMAND_MAP: Record<string, string> = {
  schedule: '/calendar',
  calendar: '/calendar',
  jobs: '/jobs',
  clients: '/clients',
  pipeline: '/pipeline',
  leads: '/pipeline',
  quotes: '/pipeline',
  today: '/calendar?date=today',
  tomorrow: '/calendar?date=tomorrow',
  insights: '/insights',
  dashboard: '/',
};

const COMMAND_DEFINITIONS: CommandDefinition[] = [
  { command: 'schedule', path: '/calendar', aliases: ['schedule', 'calendar'], label: 'Open calendar' },
  { command: 'jobs', path: '/jobs', aliases: ['jobs'], label: 'Open jobs' },
  { command: 'clients', path: '/clients', aliases: ['clients'], label: 'Open clients' },
  { command: 'pipeline', path: '/pipeline', aliases: ['pipeline', 'leads', 'quotes'], label: 'Open pipeline' },
  { command: 'today', path: '/calendar?date=today', aliases: ['today'], label: 'Open calendar today' },
  { command: 'tomorrow', path: '/calendar?date=tomorrow', aliases: ['tomorrow'], label: 'Open calendar tomorrow' },
  { command: 'insights', path: '/insights', aliases: ['insights'], label: 'Open insights' },
  { command: 'dashboard', path: '/', aliases: ['dashboard'], label: 'Go to dashboard' },
];

const WEEKDAY_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function normalizeSearchQuery(raw: string) {
  return raw.trim().replace(/\s+/g, ' ');
}

function formatIsoDate(date: Date, timeZone: string) {
  return formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
}

function zonedToday(now: Date, timeZone: string) {
  return startOfDay(toZonedTime(now, timeZone));
}

function nextWeekday(fromDate: Date, targetWeekday: number) {
  const current = fromDate.getDay();
  let delta = (targetWeekday - current + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(fromDate, delta);
}

function parseMonthDay(input: string, referenceDate: Date) {
  const formats = ['MMMM d, yyyy', 'MMM d, yyyy', 'MMMM d', 'MMM d'];

  for (const dateFormat of formats) {
    const parsed = parse(input, dateFormat, referenceDate);
    if (!isValid(parsed)) continue;

    const hasYear = dateFormat.includes('yyyy');
    if (hasYear) {
      if (format(parsed, dateFormat).toLowerCase() === input.toLowerCase()) return parsed;
      continue;
    }

    const normalizedInput = input.toLowerCase().replace(/,/g, '');
    const normalizedParsed = format(parsed, dateFormat).toLowerCase().replace(/,/g, '');
    if (normalizedInput !== normalizedParsed) continue;

    return parsed;
  }

  return null;
}

export function resolveDateInput(rawInput: string, now = new Date(), timeZone = SEARCH_TIME_ZONE): ResolvedDateMatch | null {
  const normalized = normalizeSearchQuery(rawInput).toLowerCase();
  if (!normalized) return null;

  const today = zonedToday(now, timeZone);

  if (normalized === 'today') {
    return {
      isoDate: formatIsoDate(today, timeZone),
      label: formatInTimeZone(today, timeZone, 'EEE, MMM d, yyyy'),
      source: 'today',
    };
  }

  if (normalized === 'tomorrow') {
    const tomorrow = addDays(today, 1);
    return {
      isoDate: formatIsoDate(tomorrow, timeZone),
      label: formatInTimeZone(tomorrow, timeZone, 'EEE, MMM d, yyyy'),
      source: 'tomorrow',
    };
  }

  if (normalized === 'next week') {
    const nextWeek = addWeeks(today, 1);
    return {
      isoDate: formatIsoDate(nextWeek, timeZone),
      label: formatInTimeZone(nextWeek, timeZone, 'EEE, MMM d, yyyy'),
      source: 'next week',
    };
  }

  const inDaysMatch = normalized.match(/^in\s+(\d{1,3})\s+days?$/);
  if (inDaysMatch) {
    const dayCount = Number(inDaysMatch[1]);
    const inDays = addDays(today, dayCount);
    return {
      isoDate: formatIsoDate(inDays, timeZone),
      label: formatInTimeZone(inDays, timeZone, 'EEE, MMM d, yyyy'),
      source: normalized,
    };
  }

  const nextWeekdayMatch = normalized.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (nextWeekdayMatch) {
    const weekdayLabel = nextWeekdayMatch[1];
    const targetDate = nextWeekday(today, WEEKDAY_TO_INDEX[weekdayLabel]);
    return {
      isoDate: formatIsoDate(targetDate, timeZone),
      label: formatInTimeZone(targetDate, timeZone, 'EEE, MMM d, yyyy'),
      source: normalized,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = parse(normalized, 'yyyy-MM-dd', today);
    if (isValid(parsed) && format(parsed, 'yyyy-MM-dd') === normalized) {
      return {
        isoDate: normalized,
        label: formatInTimeZone(parsed, timeZone, 'EEE, MMM d, yyyy'),
        source: rawInput,
      };
    }
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normalized)) {
    const formats = ['MM/dd/yyyy', 'M/d/yyyy'];
    for (const dateFormat of formats) {
      const parsed = parse(normalized, dateFormat, today);
      if (!isValid(parsed)) continue;
      if (format(parsed, dateFormat) !== normalized) continue;
      return {
        isoDate: format(parsed, 'yyyy-MM-dd'),
        label: formatInTimeZone(parsed, timeZone, 'EEE, MMM d, yyyy'),
        source: rawInput,
      };
    }
  }

  const parsedMonthDay = parseMonthDay(normalized, today);
  if (parsedMonthDay) {
    const hasExplicitYear = /\d{4}$/.test(normalized);
    const date = hasExplicitYear
      ? parsedMonthDay
      : parsedMonthDay < today
        ? addYears(parsedMonthDay, 1)
        : parsedMonthDay;

    return {
      isoDate: format(date, 'yyyy-MM-dd'),
      label: formatInTimeZone(date, timeZone, 'EEE, MMM d, yyyy'),
      source: rawInput,
    };
  }

  return null;
}

export function resolveCommand(rawInput: string, now = new Date(), timeZone = SEARCH_TIME_ZONE): CommandResolution | null {
  const normalized = normalizeSearchQuery(rawInput).toLowerCase();
  if (!normalized) return null;

  const exact = EXACT_COMMAND_MAP[normalized];
  if (exact) {
    return {
      matched: normalized,
      destination: exact,
    };
  }

  const commandWithArg = normalized.match(/^(schedule|calendar)\s+(.+)$/);
  if (commandWithArg) {
    const dateValue = commandWithArg[2]?.trim() || '';
    const parsed = resolveDateInput(dateValue, now, timeZone);
    if (parsed) {
      return {
        matched: commandWithArg[1],
        destination: `/calendar?date=${encodeURIComponent(parsed.isoDate)}`,
      };
    }
  }

  return null;
}

export function getCommandSuggestions(rawInput: string, limit = 5): CommandDefinition[] {
  const normalized = normalizeSearchQuery(rawInput).toLowerCase();
  if (!normalized) return COMMAND_DEFINITIONS.slice(0, limit);

  return COMMAND_DEFINITIONS.filter((command) =>
    command.aliases.some((alias) => alias.includes(normalized) || normalized.includes(alias))
  ).slice(0, limit);
}

export function resolveCalendarDateParam(
  rawDateParam: string | null,
  now = new Date(),
  timeZone = SEARCH_TIME_ZONE
): string | null {
  if (!rawDateParam) return null;
  const parsed = resolveDateInput(rawDateParam, now, timeZone);
  return parsed?.isoDate || null;
}
