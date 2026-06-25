import type { TimeDuration } from '@algoux/standard-ranklist';
import { formatTimeDuration } from '@algoux/standard-ranklist-utils';

export interface RanklistContestTime {
  startAt?: string;
  duration?: TimeDuration;
}

export function formatContestTime(contest: RanklistContestTime): string {
  const start = new Date(contest.startAt || '');
  if (Number.isNaN(start.getTime())) {
    return '';
  }

  const timezoneText = formatTimezone(start);
  let endText = '';
  if (contest.duration) {
    try {
      const end = new Date(start.getTime() + formatTimeDuration(contest.duration, 'ms'));
      endText = ` ~ ${formatDateTime(end)}`;
    } catch {
      endText = '';
    }
  }
  return `${formatDateTime(start)}${endText} ${timezoneText}`;
}

function formatDateTime(date: Date): string {
  const dateText = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const timeText = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join(':');
  return `${dateText} ${timeText}`;
}

function formatTimezone(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offsetHoursText = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
  const offsetMinutesText = String(absoluteMinutes % 60).padStart(2, '0');
  return `${sign}${offsetHoursText}:${offsetMinutesText}`;
}
